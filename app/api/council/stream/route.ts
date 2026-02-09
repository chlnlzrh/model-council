/**
 * SSE streaming endpoint for the 3-stage council pipeline.
 *
 * POST /api/council/stream
 *
 * Emits 9 SSE event types in order:
 *   stage1_start → stage1_complete →
 *   stage2_start → stage2_complete →
 *   stage3_start → stage3_complete →
 *   title_complete → complete
 *   (error on failure)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  stage1Collect,
  stage2Rank,
  stage3Synthesize,
  generateTitle,
} from "@/lib/council/orchestrator";
import type { CouncilConfig, SSEEvent } from "@/lib/council/types";
import { DEFAULT_COUNCIL_CONFIG } from "@/lib/council/types";

const RequestSchema = z.object({
  question: z.string().min(1, "Question is required"),
  councilModels: z.array(z.string()).optional(),
  chairmanModel: z.string().optional(),
});

function sseEncode(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = RequestSchema.safeParse(body);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const { question, councilModels, chairmanModel } = parsed.data;

  const config: CouncilConfig = {
    councilModels: councilModels ?? DEFAULT_COUNCIL_CONFIG.councilModels,
    chairmanModel: chairmanModel ?? DEFAULT_COUNCIL_CONFIG.chairmanModel,
    timeoutMs: DEFAULT_COUNCIL_CONFIG.timeoutMs,
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // --- Stage 1: Collect responses ---
        controller.enqueue(
          encoder.encode(sseEncode({ type: "stage1_start" }))
        );

        const stage1Results = await stage1Collect(question, config);

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

        // --- Stage 2: Rank responses ---
        controller.enqueue(
          encoder.encode(sseEncode({ type: "stage2_start" }))
        );

        const { rankings: stage2Results, metadata: stage2Metadata } =
          await stage2Rank(question, stage1Results, config);

        controller.enqueue(
          encoder.encode(
            sseEncode({
              type: "stage2_complete",
              data: stage2Results,
              metadata: stage2Metadata,
            })
          )
        );

        // --- Stage 3: Synthesize ---
        controller.enqueue(
          encoder.encode(sseEncode({ type: "stage3_start" }))
        );

        const stage3Result = await stage3Synthesize(
          question,
          stage1Results,
          stage2Results,
          config
        );

        controller.enqueue(
          encoder.encode(
            sseEncode({ type: "stage3_complete", data: stage3Result })
          )
        );

        // --- Title generation (non-blocking) ---
        const title = await generateTitle(question);
        controller.enqueue(
          encoder.encode(
            sseEncode({ type: "title_complete", data: { title } })
          )
        );

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
