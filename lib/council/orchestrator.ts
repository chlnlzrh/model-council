/**
 * 3-stage council orchestrator.
 *
 * Stage 1: Collect — query each council model in parallel
 * Stage 2: Rank   — anonymize responses, have each model rank them
 * Stage 3: Synthesize — chairman model produces final answer
 *
 * Supports multi-turn conversations by accepting conversation history
 * and including it as context for Stage 1 and Stage 3.
 */

import type {
  CouncilConfig,
  ConversationTurn,
  Stage1Response,
  Stage2Response,
  Stage3Response,
  Stage2Metadata,
  CouncilResult,
} from "./types";
import { DEFAULT_COUNCIL_CONFIG } from "./types";
import {
  queryModel,
  queryModelsParallel,
  queryModelsParallelWithMessages,
  queryModelWithMessages,
} from "./openrouter";
import {
  parseRanking,
  calculateAggregateRankings,
  createLabelMap,
} from "./ranking-parser";
import {
  buildRankingPrompt,
  buildSynthesisPrompt,
  buildTitlePrompt,
} from "./prompts";

// ---------------------------------------------------------------------------
// Helpers — build messages array from conversation history
// ---------------------------------------------------------------------------

function buildMessagesWithHistory(
  history: ConversationTurn[],
  currentPrompt: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  // Add history as alternating user/assistant turns
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  // Add current query as the latest user message
  messages.push({ role: "user", content: currentPrompt });

  return messages;
}

// ---------------------------------------------------------------------------
// Stage 1 — Collect individual responses
// ---------------------------------------------------------------------------

export async function stage1Collect(
  userQuery: string,
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG,
  history: ConversationTurn[] = []
): Promise<Stage1Response[]> {
  let results: Map<string, { content: string; responseTimeMs: number }>;

  if (history.length > 0) {
    const messages = buildMessagesWithHistory(history, userQuery);
    results = await queryModelsParallelWithMessages(
      config.councilModels,
      messages,
      config.timeoutMs
    );
  } else {
    results = await queryModelsParallel(
      config.councilModels,
      userQuery,
      config.timeoutMs
    );
  }

  const responses: Stage1Response[] = [];
  for (const [model, result] of results) {
    responses.push({
      model,
      response: result.content,
      responseTimeMs: result.responseTimeMs,
    });
  }

  return responses;
}

// ---------------------------------------------------------------------------
// Stage 2 — Anonymize and rank
// ---------------------------------------------------------------------------

export async function stage2Rank(
  userQuery: string,
  stage1Results: Stage1Response[],
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG
): Promise<{ rankings: Stage2Response[]; metadata: Stage2Metadata }> {
  // Create anonymous labels
  const models = stage1Results.map((r) => r.model);
  const labelToModel = createLabelMap(models);

  // Build labeled responses for the ranking prompt
  const labels = Object.keys(labelToModel);
  const labeledResponses = labels.map((label, i) => ({
    label,
    response: stage1Results[i].response,
  }));

  const rankingPrompt = buildRankingPrompt({
    userQuery,
    labeledResponses,
  });

  // Have each council model evaluate and rank (no history needed — ranking is context-free)
  const results = await queryModelsParallel(
    config.councilModels,
    rankingPrompt,
    config.timeoutMs
  );

  const rankings: Stage2Response[] = [];
  const allParsedRankings = [];

  for (const [model, result] of results) {
    const parsed = parseRanking(result.content);
    rankings.push({
      model,
      rankingText: result.content,
      parsedRanking: parsed,
    });
    allParsedRankings.push(parsed);
  }

  const aggregateRankings = calculateAggregateRankings(
    allParsedRankings,
    labelToModel
  );

  return {
    rankings,
    metadata: {
      labelToModel,
      aggregateRankings,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 3 — Chairman synthesis
// ---------------------------------------------------------------------------

export async function stage3Synthesize(
  userQuery: string,
  stage1Results: Stage1Response[],
  stage2Results: Stage2Response[],
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG,
  history: ConversationTurn[] = []
): Promise<Stage3Response> {
  const synthesisPrompt = buildSynthesisPrompt({
    userQuery,
    stage1Results,
    stage2Results,
  });

  let result;
  if (history.length > 0) {
    // Include conversation history so the chairman has full context
    const messages = buildMessagesWithHistory(history, synthesisPrompt);
    result = await queryModelWithMessages(
      config.chairmanModel,
      messages,
      config.timeoutMs
    );
  } else {
    result = await queryModel(
      config.chairmanModel,
      synthesisPrompt,
      config.timeoutMs
    );
  }

  if (!result) {
    return {
      model: config.chairmanModel,
      response: "Error: Chairman model failed to generate a synthesis.",
      responseTimeMs: 0,
    };
  }

  return {
    model: config.chairmanModel,
    response: result.content,
    responseTimeMs: result.responseTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Title generation
// ---------------------------------------------------------------------------

export async function generateTitle(userQuery: string): Promise<string> {
  const titlePrompt = buildTitlePrompt(userQuery);
  const result = await queryModel("google/gemini-2.5-flash", titlePrompt, 30_000);

  if (!result) return "New Conversation";

  let title = result.content.trim().replace(/^["']|["']$/g, "");
  if (title.length > 50) title = title.slice(0, 47) + "...";

  return title;
}

// ---------------------------------------------------------------------------
// Full pipeline (non-streaming)
// ---------------------------------------------------------------------------

export async function runFullCouncil(
  userQuery: string,
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG,
  history: ConversationTurn[] = []
): Promise<CouncilResult> {
  // Stage 1
  const stage1 = await stage1Collect(userQuery, config, history);

  if (stage1.length === 0) {
    return {
      stage1: [],
      stage2: [],
      stage2Metadata: { labelToModel: {}, aggregateRankings: [] },
      stage3: {
        model: config.chairmanModel,
        response: "All models failed to respond. Please try again.",
        responseTimeMs: 0,
      },
    };
  }

  // Stage 2 (no history — ranking is context-free)
  const { rankings: stage2, metadata: stage2Metadata } = await stage2Rank(
    userQuery,
    stage1,
    config
  );

  // Stage 3
  const stage3 = await stage3Synthesize(userQuery, stage1, stage2, config, history);

  return { stage1, stage2, stage2Metadata, stage3 };
}
