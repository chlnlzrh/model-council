/**
 * SSE streaming endpoint for the multi-mode deliberation pipeline.
 *
 * POST /api/council/stream
 *
 * Accepts: { question, mode?, conversationId?, councilModels?, chairmanModel?, modeConfig? }
 *
 * The `mode` field (default: "council") determines which orchestrator pipeline runs.
 * Council mode retains full backward compatibility.
 *
 * Supports multi-turn for modes that declare supportsMultiTurn: true.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import {
  stage1Collect,
  stage2Rank,
  stage3Synthesize,
  generateTitle,
} from "@/lib/council/orchestrator";
import type {
  CouncilConfig,
  SSEEvent,
  ConversationTurn,
  DeliberationMode,
} from "@/lib/council/types";
import { DEFAULT_COUNCIL_CONFIG } from "@/lib/council/types";
import { getModeDefinition, isValidMode } from "@/lib/council/modes";
import {
  createConversation,
  createMessage,
  getMessagesByConversation,
  getStage3ByMessage,
  saveStage1Responses,
  saveStage2Rankings,
  saveStage2LabelMapEntries,
  saveStage3Synthesis,
  updateConversationTitle,
  getConversationMode,
} from "@/lib/db/queries";

const RequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  mode: z.string().default("council"),
  conversationId: z.string().optional(),
  councilModels: z.array(z.string()).optional(),
  chairmanModel: z.string().optional(),
  modeConfig: z.record(z.string(), z.unknown()).optional(),
});

function sseEncode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Build conversation history from existing messages.
 * For each user message, include its content.
 * For each assistant message, include the Stage 3 synthesis (the final answer).
 */
async function loadConversationHistory(
  conversationId: string
): Promise<ConversationTurn[]> {
  const messages = await getMessagesByConversation(conversationId);
  const history: ConversationTurn[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      history.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      // Load the Stage 3 synthesis for this assistant message
      const synthesis = await getStage3ByMessage(msg.id);
      if (synthesis) {
        history.push({ role: "assistant", content: synthesis.response });
      }
    }
  }

  return history;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const {
    question,
    mode: modeStr,
    conversationId,
    councilModels,
    chairmanModel,
    modeConfig,
  } = parsed.data;

  // Validate mode
  if (!isValidMode(modeStr)) {
    return new Response(
      JSON.stringify({ error: `Unknown mode: ${modeStr}` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }
  const mode = modeStr as DeliberationMode;

  // If continuing a conversation, verify mode matches
  if (conversationId) {
    const existingMode = await getConversationMode(conversationId);
    if (existingMode && existingMode !== mode) {
      return new Response(
        JSON.stringify({
          error: `Conversation uses "${existingMode}" mode, but request specified "${mode}".`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Non-council modes are not yet implemented — return 501
  if (mode !== "council") {
    const modeDef = getModeDefinition(mode);
    return new Response(
      JSON.stringify({
        error: `Mode "${modeDef?.name ?? mode}" is not yet implemented. Coming soon.`,
      }),
      { status: 501, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Council mode (existing implementation) ---

  const config: CouncilConfig = {
    councilModels: councilModels ?? DEFAULT_COUNCIL_CONFIG.councilModels,
    chairmanModel: chairmanModel ?? DEFAULT_COUNCIL_CONFIG.chairmanModel,
    timeoutMs: DEFAULT_COUNCIL_CONFIG.timeoutMs,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Create or use existing conversation
        let convId = conversationId;
        let isNewConversation = false;
        if (!convId) {
          const conv = await createConversation({
            userId: session.user!.id!,
            mode,
          });
          convId = conv.id;
          isNewConversation = true;
        }

        // Load conversation history for multi-turn context
        const history = isNewConversation
          ? []
          : await loadConversationHistory(convId);

        // Save user message
        await createMessage({
          conversationId: convId,
          role: "user",
          content: question,
        });

        // Create placeholder assistant message
        const assistantMsg = await createMessage({
          conversationId: convId,
          role: "assistant",
          content: "",
        });

        // Send conversation metadata
        controller.enqueue(
          encoder.encode(
            sseEncode({
              type: "stage1_start",
              data: { conversationId: convId, messageId: assistantMsg.id },
            })
          )
        );

        // --- Stage 1: Collect responses (with history for multi-turn) ---
        const stage1Results = await stage1Collect(question, config, history);

        await saveStage1Responses(assistantMsg.id, stage1Results);

        controller.enqueue(
          encoder.encode(
            sseEncode({ type: "stage1_complete", data: stage1Results })
          )
        );

        if (stage1Results.length === 0) {
          controller.enqueue(
            encoder.encode(
              sseEncode({
                type: "error",
                message: "All models failed to respond. Please try again.",
              })
            )
          );
          controller.close();
          return;
        }

        // --- Stage 2: Rank responses (no history — ranking is context-free) ---
        controller.enqueue(
          encoder.encode(sseEncode({ type: "stage2_start" }))
        );

        const { rankings: stage2Results, metadata: stage2Metadata } =
          await stage2Rank(question, stage1Results, config);

        await Promise.all([
          saveStage2Rankings(assistantMsg.id, stage2Results),
          saveStage2LabelMapEntries(
            assistantMsg.id,
            stage2Metadata.labelToModel
          ),
        ]);

        controller.enqueue(
          encoder.encode(
            sseEncode({
              type: "stage2_complete",
              data: stage2Results,
              metadata: stage2Metadata,
            })
          )
        );

        // --- Stage 3: Synthesize (with history for multi-turn) ---
        controller.enqueue(
          encoder.encode(sseEncode({ type: "stage3_start" }))
        );

        const stage3Result = await stage3Synthesize(
          question,
          stage1Results,
          stage2Results,
          config,
          history
        );

        await saveStage3Synthesis(assistantMsg.id, stage3Result);

        controller.enqueue(
          encoder.encode(
            sseEncode({ type: "stage3_complete", data: stage3Result })
          )
        );

        // --- Title generation (only for new conversations) ---
        if (isNewConversation) {
          const title = await generateTitle(question);
          await updateConversationTitle(convId, title);
          controller.enqueue(
            encoder.encode(
              sseEncode({ type: "title_complete", data: { title } })
            )
          );
        }

        // --- Complete ---
        controller.enqueue(
          encoder.encode(sseEncode({ type: "complete" }))
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(sseEncode({ type: "error", message }))
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
