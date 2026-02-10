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
import { handleVoteStream } from "@/lib/council/modes/vote";
import type { VoteConfig } from "@/lib/council/modes/vote";
import { DEFAULT_VOTE_CONFIG } from "@/lib/council/modes/vote";
import { handleChainStream } from "@/lib/council/modes/chain";
import type { ChainConfig, ChainStepConfig } from "@/lib/council/modes/chain";
import { DEFAULT_CHAIN_CONFIG } from "@/lib/council/modes/chain";
import { handleSpecialistPanelStream } from "@/lib/council/modes/specialist-panel";
import type { PanelConfig, SpecialistAssignment } from "@/lib/council/modes/specialist-panel";
import { DEFAULT_PANEL_CONFIG } from "@/lib/council/modes/specialist-panel";
import { handleJuryStream } from "@/lib/council/modes/jury";
import type { JuryConfig } from "@/lib/council/modes/jury";
import { DEFAULT_JURY_CONFIG } from "@/lib/council/modes/jury";
import { handleDebateStream } from "@/lib/council/modes/debate";
import type { DebateConfig } from "@/lib/council/modes/debate";
import { DEFAULT_DEBATE_CONFIG } from "@/lib/council/modes/debate";
import { handleDelphiStream } from "@/lib/council/modes/delphi";
import type { DelphiConfig } from "@/lib/council/modes/delphi";
import { DEFAULT_DELPHI_CONFIG } from "@/lib/council/modes/delphi";
import { handleRedTeamStream } from "@/lib/council/modes/red-team";
import type { RedTeamConfig } from "@/lib/council/modes/red-team";
import { DEFAULT_RED_TEAM_CONFIG } from "@/lib/council/modes/red-team";
import { handleBlueprintStream } from "@/lib/council/modes/blueprint";
import type { BlueprintConfig, DocumentType } from "@/lib/council/modes/blueprint";
import { DEFAULT_BLUEPRINT_CONFIG } from "@/lib/council/modes/blueprint";
import { handlePeerReviewStream } from "@/lib/council/modes/peer-review";
import type { PeerReviewConfig, ReviewType } from "@/lib/council/modes/peer-review";
import { DEFAULT_PEER_REVIEW_CONFIG } from "@/lib/council/modes/peer-review";
import { handleTournamentStream } from "@/lib/council/modes/tournament";
import type { TournamentConfig } from "@/lib/council/modes/tournament";
import { DEFAULT_TOURNAMENT_CONFIG } from "@/lib/council/modes/tournament";
import {
  createConversation,
  createMessage,
  getMessagesByConversation,
  getStage3ByMessage,
  getDeliberationStagesByMessage,
  saveStage1Responses,
  saveStage2Rankings,
  saveStage2LabelMapEntries,
  saveStage3Synthesis,
  saveDeliberationStages,
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
 * For each assistant message, include the final answer:
 * - Council mode: Stage 3 synthesis
 * - Vote mode: winner's original response from deliberation_stages
 */
async function loadConversationHistory(
  conversationId: string,
  mode: DeliberationMode = "council"
): Promise<ConversationTurn[]> {
  const messages = await getMessagesByConversation(conversationId);
  const history: ConversationTurn[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      history.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      if (mode === "council") {
        const synthesis = await getStage3ByMessage(msg.id);
        if (synthesis) {
          history.push({ role: "assistant", content: synthesis.response });
        }
      } else {
        // Non-council modes: look for "winner" stage in deliberation_stages
        const stages = await getDeliberationStagesByMessage(msg.id);
        const winnerStage = stages.find((s) => s.stageType === "winner");
        if (winnerStage) {
          history.push({ role: "assistant", content: winnerStage.content });
        } else if (stages.length > 0) {
          // Fallback: use last stage's content
          history.push({ role: "assistant", content: stages[stages.length - 1].content });
        }
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

  // Modes that are not yet implemented — return 501
  const IMPLEMENTED_MODES: DeliberationMode[] = ["council", "vote", "chain", "specialist_panel", "jury", "debate", "delphi", "red_team", "blueprint", "peer_review", "tournament"];
  if (!IMPLEMENTED_MODES.includes(mode)) {
    const modeDef = getModeDefinition(mode);
    return new Response(
      JSON.stringify({
        error: `Mode "${modeDef?.name ?? mode}" is not yet implemented. Coming soon.`,
      }),
      { status: 501, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(sseEncode(event)));
      };

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
          : await loadConversationHistory(convId, mode);

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

        // --- Dispatch by mode ---
        if (mode === "vote") {
          const voteConfig: VoteConfig = {
            councilModels: councilModels ?? DEFAULT_VOTE_CONFIG.councilModels,
            chairmanModel: chairmanModel ?? DEFAULT_VOTE_CONFIG.chairmanModel,
            timeoutMs: DEFAULT_VOTE_CONFIG.timeoutMs,
          };

          const stages = await handleVoteStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: voteConfig,
            history,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "chain") {
          // --- Chain mode ---
          // Parse chain-specific config from modeConfig
          const chainSteps: ChainStepConfig[] =
            (modeConfig?.steps as ChainStepConfig[] | undefined) ??
            DEFAULT_CHAIN_CONFIG.steps;
          const chainTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_CHAIN_CONFIG.timeoutMs;

          const chainConfig: ChainConfig = {
            steps: chainSteps,
            timeoutMs: chainTimeoutMs,
          };

          const stages = await handleChainStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: chainConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "specialist_panel") {
          // --- Specialist Panel mode ---
          const specialists: SpecialistAssignment[] =
            (modeConfig?.specialists as SpecialistAssignment[] | undefined) ??
            DEFAULT_PANEL_CONFIG.specialists;
          const synthesizerModel =
            (modeConfig?.synthesizerModel as string | undefined) ??
            DEFAULT_PANEL_CONFIG.synthesizerModel;
          const panelTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_PANEL_CONFIG.timeoutMs;

          const panelConfig: PanelConfig = {
            specialists,
            synthesizerModel,
            timeoutMs: panelTimeoutMs,
          };

          const stages = await handleSpecialistPanelStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: panelConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "jury") {
          // --- Jury mode ---
          const jurorModels =
            (modeConfig?.jurorModels as string[] | undefined) ??
            DEFAULT_JURY_CONFIG.jurorModels;
          const foremanModel =
            (modeConfig?.foremanModel as string | undefined) ??
            DEFAULT_JURY_CONFIG.foremanModel;
          const juryTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_JURY_CONFIG.timeoutMs;
          const juryContent = modeConfig?.content as string | undefined;
          const originalQuestion = modeConfig?.originalQuestion as string | undefined;

          // Content to evaluate is required
          if (!juryContent) {
            emit({
              type: "error",
              message: "Jury mode requires modeConfig.content (the content to evaluate).",
            });
            controller.close();
            return;
          }

          // Foreman must not be in juror list
          if (jurorModels.includes(foremanModel)) {
            emit({
              type: "error",
              message: "Foreman model must not be one of the juror models.",
            });
            controller.close();
            return;
          }

          const juryConfig: JuryConfig = {
            jurorModels,
            foremanModel,
            timeoutMs: juryTimeoutMs,
          };

          const stages = await handleJuryStream(controller, encoder, emit, {
            content: juryContent,
            originalQuestion,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: juryConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "debate") {
          // --- Debate mode ---
          const debateModels =
            (modeConfig?.models as string[] | undefined) ??
            DEFAULT_DEBATE_CONFIG.models;
          const debateTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_DEBATE_CONFIG.timeoutMs;

          const debateConfig: DebateConfig = {
            models: debateModels,
            timeoutMs: debateTimeoutMs,
          };

          const stages = await handleDebateStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: debateConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "delphi") {
          // --- Delphi mode ---
          const panelistModels =
            (modeConfig?.panelistModels as string[] | undefined) ??
            DEFAULT_DELPHI_CONFIG.panelistModels;
          const facilitatorModel =
            (modeConfig?.facilitatorModel as string | undefined) ??
            DEFAULT_DELPHI_CONFIG.facilitatorModel;
          const delphiMaxRounds =
            (modeConfig?.maxRounds as number | undefined) ??
            DEFAULT_DELPHI_CONFIG.maxRounds;
          const numericThreshold =
            (modeConfig?.numericConvergenceThreshold as number | undefined) ??
            DEFAULT_DELPHI_CONFIG.numericConvergenceThreshold;
          const qualitativeThreshold =
            (modeConfig?.qualitativeConvergenceThreshold as number | undefined) ??
            DEFAULT_DELPHI_CONFIG.qualitativeConvergenceThreshold;
          const delphiTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_DELPHI_CONFIG.timeoutMs;

          // Facilitator must not be in panelist list
          if (panelistModels.includes(facilitatorModel)) {
            emit({
              type: "error",
              message: "Facilitator model must not be one of the panelist models.",
            });
            controller.close();
            return;
          }

          const delphiConfig: DelphiConfig = {
            panelistModels,
            facilitatorModel,
            maxRounds: delphiMaxRounds,
            numericConvergenceThreshold: numericThreshold,
            qualitativeConvergenceThreshold: qualitativeThreshold,
            timeoutMs: delphiTimeoutMs,
          };

          const stages = await handleDelphiStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: delphiConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "red_team") {
          // --- Red Team mode ---
          const generatorModel =
            (modeConfig?.generatorModel as string | undefined) ??
            DEFAULT_RED_TEAM_CONFIG.generatorModel;
          const attackerModel =
            (modeConfig?.attackerModel as string | undefined) ??
            DEFAULT_RED_TEAM_CONFIG.attackerModel;
          const synthesizerModel =
            (modeConfig?.synthesizerModel as string | undefined) ??
            generatorModel;
          const redTeamRounds =
            (modeConfig?.rounds as number | undefined) ??
            DEFAULT_RED_TEAM_CONFIG.rounds;
          const redTeamTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_RED_TEAM_CONFIG.timeoutMs;
          const maxInputLength =
            (modeConfig?.maxInputLength as number | undefined) ??
            DEFAULT_RED_TEAM_CONFIG.maxInputLength;

          // Validate: generator and attacker must differ
          if (generatorModel === attackerModel) {
            emit({
              type: "error",
              message: "Generator and attacker must be different models for adversarial integrity.",
            });
            controller.close();
            return;
          }

          const redTeamConfig: RedTeamConfig = {
            generatorModel,
            attackerModel,
            synthesizerModel,
            rounds: Math.max(1, Math.min(3, redTeamRounds)),
            timeoutMs: redTeamTimeoutMs,
            maxInputLength,
          };

          const stages = await handleRedTeamStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: redTeamConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "blueprint") {
          // --- Blueprint mode ---
          const documentType =
            (modeConfig?.documentType as DocumentType | undefined) ??
            DEFAULT_BLUEPRINT_CONFIG.documentType;
          const architectModel =
            (modeConfig?.architectModel as string | undefined) ??
            DEFAULT_BLUEPRINT_CONFIG.architectModel;
          const authorModels =
            (modeConfig?.authorModels as string[] | undefined) ??
            DEFAULT_BLUEPRINT_CONFIG.authorModels;
          const assemblerModel =
            (modeConfig?.assemblerModel as string | undefined) ??
            DEFAULT_BLUEPRINT_CONFIG.assemblerModel;
          const blueprintTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_BLUEPRINT_CONFIG.timeoutMs;

          // Validate author models count
          if (authorModels.length < 1 || authorModels.length > 6) {
            emit({
              type: "error",
              message: "Blueprint mode requires 1-6 author models.",
            });
            controller.close();
            return;
          }

          // Validate document type
          const validDocTypes: DocumentType[] = [
            "architecture_blueprint",
            "technical_design_document",
            "implementation_roadmap",
            "cost_analysis_report",
            "security_assessment",
            "custom",
          ];
          if (!validDocTypes.includes(documentType)) {
            emit({
              type: "error",
              message: `Invalid document type: "${documentType}".`,
            });
            controller.close();
            return;
          }

          // Validate source material length
          if (question.length > 200_000) {
            emit({
              type: "error",
              message: "Source material must be under 200,000 characters.",
            });
            controller.close();
            return;
          }

          const blueprintConfig: BlueprintConfig = {
            documentType,
            architectModel,
            authorModels,
            assemblerModel,
            timeoutMs: blueprintTimeoutMs,
          };

          const stages = await handleBlueprintStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: blueprintConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "peer_review") {
          // --- Peer Review mode ---
          const reviewType =
            (modeConfig?.reviewType as ReviewType | undefined) ??
            DEFAULT_PEER_REVIEW_CONFIG.reviewType;
          const reviewerModels =
            (modeConfig?.reviewerModels as string[] | undefined) ??
            DEFAULT_PEER_REVIEW_CONFIG.reviewerModels;
          const consolidatorModel =
            (modeConfig?.consolidatorModel as string | undefined) ??
            DEFAULT_PEER_REVIEW_CONFIG.consolidatorModel;
          const customRubric = modeConfig?.customRubric as PeerReviewConfig["customRubric"] | undefined;
          const peerReviewTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_PEER_REVIEW_CONFIG.timeoutMs;

          // Validate reviewer count (2-6)
          if (reviewerModels.length < 2 || reviewerModels.length > 6) {
            emit({
              type: "error",
              message: "Peer Review requires 2-6 reviewer models.",
            });
            controller.close();
            return;
          }

          // Validate custom rubric requirement
          if (reviewType === "custom" && !customRubric) {
            emit({
              type: "error",
              message: "customRubric is required when reviewType is 'custom'.",
            });
            controller.close();
            return;
          }

          // Validate work length
          if (question.length > 200_000) {
            emit({
              type: "error",
              message: "Work under review must be under 200,000 characters.",
            });
            controller.close();
            return;
          }

          const peerReviewConfig: PeerReviewConfig = {
            reviewType,
            reviewerModels,
            consolidatorModel,
            customRubric,
            timeoutMs: peerReviewTimeoutMs,
          };

          const stages = await handlePeerReviewStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: peerReviewConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else if (mode === "tournament") {
          // --- Tournament mode ---
          const contestantModels =
            (modeConfig?.contestantModels as string[] | undefined) ??
            DEFAULT_TOURNAMENT_CONFIG.contestantModels;
          const judgeModel =
            (modeConfig?.judgeModel as string | undefined) ??
            DEFAULT_TOURNAMENT_CONFIG.judgeModel;
          const tournamentTimeoutMs =
            (modeConfig?.timeoutMs as number | undefined) ??
            DEFAULT_TOURNAMENT_CONFIG.timeoutMs;

          // Validate contestant count (4-8)
          if (contestantModels.length < 4 || contestantModels.length > 8) {
            emit({
              type: "error",
              message: "Tournament mode requires 4-8 contestant models.",
            });
            controller.close();
            return;
          }

          // Validate judge not in contestant list
          if (contestantModels.includes(judgeModel)) {
            emit({
              type: "error",
              message: "Judge model must not be in the contestant list.",
            });
            controller.close();
            return;
          }

          const tournamentConfig: TournamentConfig = {
            contestantModels,
            judgeModel,
            timeoutMs: tournamentTimeoutMs,
          };

          const stages = await handleTournamentStream(controller, encoder, emit, {
            question,
            conversationId: convId,
            messageId: assistantMsg.id,
            config: tournamentConfig,
          });

          // Persist deliberation stages
          await saveDeliberationStages(assistantMsg.id, stages);

          // Title generation (only for new conversations)
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // Complete
          emit({ type: "complete" });
        } else {
          // --- Council mode (existing implementation) ---
          const config: CouncilConfig = {
            councilModels: councilModels ?? DEFAULT_COUNCIL_CONFIG.councilModels,
            chairmanModel: chairmanModel ?? DEFAULT_COUNCIL_CONFIG.chairmanModel,
            timeoutMs: DEFAULT_COUNCIL_CONFIG.timeoutMs,
          };

          emit({
            type: "stage1_start",
            data: { conversationId: convId, messageId: assistantMsg.id },
          });

          // --- Stage 1: Collect responses (with history for multi-turn) ---
          const stage1Results = await stage1Collect(question, config, history);

          await saveStage1Responses(assistantMsg.id, stage1Results);

          emit({ type: "stage1_complete", data: stage1Results });

          if (stage1Results.length === 0) {
            emit({
              type: "error",
              message: "All models failed to respond. Please try again.",
            });
            controller.close();
            return;
          }

          // --- Stage 2: Rank responses (no history — ranking is context-free) ---
          emit({ type: "stage2_start" });

          const { rankings: stage2Results, metadata: stage2Metadata } =
            await stage2Rank(question, stage1Results, config);

          await Promise.all([
            saveStage2Rankings(assistantMsg.id, stage2Results),
            saveStage2LabelMapEntries(
              assistantMsg.id,
              stage2Metadata.labelToModel
            ),
          ]);

          emit({
            type: "stage2_complete",
            data: stage2Results,
            metadata: stage2Metadata,
          });

          // --- Stage 3: Synthesize (with history for multi-turn) ---
          emit({ type: "stage3_start" });

          const stage3Result = await stage3Synthesize(
            question,
            stage1Results,
            stage2Results,
            config,
            history
          );

          await saveStage3Synthesis(assistantMsg.id, stage3Result);

          emit({ type: "stage3_complete", data: stage3Result });

          // --- Title generation (only for new conversations) ---
          if (isNewConversation) {
            const title = await generateTitle(question);
            await updateConversationTitle(convId, title);
            emit({ type: "title_complete", data: { title } });
          }

          // --- Complete ---
          emit({ type: "complete" });
        }
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
