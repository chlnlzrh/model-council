/**
 * 3-stage council orchestrator.
 *
 * Stage 1: Collect — query each council model in parallel
 * Stage 2: Rank   — anonymize responses, have each model rank them
 * Stage 3: Synthesize — chairman model produces final answer
 */

import type {
  CouncilConfig,
  Stage1Response,
  Stage2Response,
  Stage3Response,
  Stage2Metadata,
  CouncilResult,
} from "./types";
import { DEFAULT_COUNCIL_CONFIG } from "./types";
import { queryModel, queryModelsParallel } from "./openrouter";
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
// Stage 1 — Collect individual responses
// ---------------------------------------------------------------------------

export async function stage1Collect(
  userQuery: string,
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG
): Promise<Stage1Response[]> {
  const results = await queryModelsParallel(
    config.councilModels,
    userQuery,
    config.timeoutMs
  );

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

  // Have each council model evaluate and rank
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
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG
): Promise<Stage3Response> {
  const synthesisPrompt = buildSynthesisPrompt({
    userQuery,
    stage1Results,
    stage2Results,
  });

  const result = await queryModel(
    config.chairmanModel,
    synthesisPrompt,
    config.timeoutMs
  );

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
  config: CouncilConfig = DEFAULT_COUNCIL_CONFIG
): Promise<CouncilResult> {
  // Stage 1
  const stage1 = await stage1Collect(userQuery, config);

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

  // Stage 2
  const { rankings: stage2, metadata: stage2Metadata } = await stage2Rank(
    userQuery,
    stage1,
    config
  );

  // Stage 3
  const stage3 = await stage3Synthesize(userQuery, stage1, stage2, config);

  return { stage1, stage2, stage2Metadata, stage3 };
}
