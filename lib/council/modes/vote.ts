/**
 * Vote Mode — Answer → Vote → Declare Winner
 *
 * Lightweight sibling of Council. Models answer in parallel, then each
 * votes for the best anonymized response. Plurality wins. If tied, a
 * chairman model breaks the tie.
 *
 * Output is the winning model's UNMODIFIED original response.
 *
 * See docs/modes/02-vote.md for full specification.
 */

import type {
  Stage1Response,
  LabelMap,
  ConversationTurn,
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { DEFAULT_COUNCIL_CONFIG } from "../types";
import { queryModel, queryModelsParallel, queryModelsParallelWithMessages } from "../openrouter";
import { createLabelMap } from "../ranking-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VoteConfig {
  councilModels: string[];
  chairmanModel: string;
  timeoutMs: number;
}

export const DEFAULT_VOTE_CONFIG: VoteConfig = {
  councilModels: DEFAULT_COUNCIL_CONFIG.councilModels,
  chairmanModel: DEFAULT_COUNCIL_CONFIG.chairmanModel!,
  timeoutMs: DEFAULT_COUNCIL_CONFIG.timeoutMs ?? 120_000,
};

export interface VoteResponse {
  model: string;
  voteText: string;
  votedFor: string | null;
  responseTimeMs: number;
}

export interface VoteTally {
  tallies: Record<string, number>;
  validVotes: VoteResponse[];
  invalidVotes: VoteResponse[];
  winners: string[];
  isTie: boolean;
  totalValidVotes: number;
}

export interface VoteRoundResult {
  votes: VoteResponse[];
  tallies: Record<string, number>;
  labelToModel: LabelMap;
  validVoteCount: number;
  invalidVoteCount: number;
  isTie: boolean;
  tiedLabels: string[];
}

export interface TiebreakerResult {
  model: string;
  voteText: string;
  votedFor: string;
  responseTimeMs: number;
}

export interface VoteWinnerResult {
  winnerLabel: string;
  winnerModel: string;
  winnerResponse: string;
  voteCount: number;
  totalVotes: number;
  tiebroken: boolean;
  tiebreakerModel?: string;
}

export interface VoteResult {
  stage1: Stage1Response[];
  voteRound: VoteRoundResult;
  tiebreaker?: TiebreakerResult;
  winner: VoteWinnerResult;
  title?: string;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

export function buildVotePrompt(
  userQuery: string,
  labeledResponses: Array<{ label: string; response: string }>
): string {
  const responsesText = labeledResponses
    .map((r) => `--- ${r.label} ---\n${r.response}`)
    .join("\n\n");

  return `You are voting for the single best response to a question. Read all responses carefully, then cast exactly ONE vote.

Question: ${userQuery}

${responsesText}

Consider: accuracy, completeness, clarity, helpfulness, and practical value.

You MUST end your response with your vote in this exact format:
VOTE: Response X

where X is the letter of your chosen response. You may provide brief reasoning before the vote, but the last line MUST be your vote.`;
}

export function buildTiebreakerPrompt(
  userQuery: string,
  tiedResponses: Array<{ label: string; response: string; voteCount: number }>
): string {
  const responsesText = tiedResponses
    .map((r) => `--- ${r.label} (${r.voteCount} votes) ---\n${r.response}`)
    .join("\n\n");

  return `There is a tie in the voting. The following responses received equal votes:

${responsesText}

Original question: ${userQuery}

Choose the single best response. Reply with ONLY:
VOTE: Response X`;
}

// ---------------------------------------------------------------------------
// Vote Parser
// ---------------------------------------------------------------------------

/**
 * Parse a vote from model response text.
 * Returns the voted-for label (e.g. "Response A") or null if unparseable.
 */
export function parseVote(text: string): string | null {
  // Primary: extract last "VOTE: Response X" match
  const voteMatches = [...text.matchAll(/VOTE:\s*Response\s+([A-Z])/gi)];
  if (voteMatches.length > 0) {
    return `Response ${voteMatches[voteMatches.length - 1][1].toUpperCase()}`;
  }

  // Fallback: last "Response X" in the text
  const fallbackMatches = [...text.matchAll(/Response\s+([A-Z])\b/gi)];
  if (fallbackMatches.length > 0) {
    return `Response ${fallbackMatches[fallbackMatches.length - 1][1].toUpperCase()}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Vote Tally
// ---------------------------------------------------------------------------

/**
 * Count votes and determine if there's a plurality winner or tie.
 */
export function tallyVotes(
  votes: VoteResponse[],
  labelMap: LabelMap
): VoteTally {
  const tallies: Record<string, number> = {};
  const validVotes: VoteResponse[] = [];
  const invalidVotes: VoteResponse[] = [];

  for (const vote of votes) {
    if (vote.votedFor && labelMap[vote.votedFor]) {
      tallies[vote.votedFor] = (tallies[vote.votedFor] ?? 0) + 1;
      validVotes.push(vote);
    } else {
      invalidVotes.push(vote);
    }
  }

  const maxVotes = Math.max(...Object.values(tallies), 0);
  const winners = Object.entries(tallies)
    .filter(([, count]) => count === maxVotes)
    .map(([label]) => label);

  return {
    tallies,
    validVotes,
    invalidVotes,
    winners,
    isTie: winners.length > 1,
    totalValidVotes: validVotes.length,
  };
}

// ---------------------------------------------------------------------------
// Pipeline Stages
// ---------------------------------------------------------------------------

/**
 * Stage 1: Collect individual responses (identical to Council).
 */
export async function voteStage1Collect(
  userQuery: string,
  config: VoteConfig,
  history: ConversationTurn[] = []
): Promise<Stage1Response[]> {
  let results: Map<string, { content: string; responseTimeMs: number }>;

  if (history.length > 0) {
    const messages = [
      ...history.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      })),
      { role: "user" as const, content: userQuery },
    ];
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

  return Array.from(results.entries()).map(([model, result]) => ({
    model,
    response: result.content,
    responseTimeMs: result.responseTimeMs,
  }));
}

/**
 * Stage 2: Anonymize responses and have all models vote.
 */
export async function voteStage2Vote(
  userQuery: string,
  stage1Results: Stage1Response[],
  config: VoteConfig
): Promise<{ votes: VoteResponse[]; labelMap: LabelMap; tally: VoteTally }> {
  const models = stage1Results.map((r) => r.model);
  const labelMap = createLabelMap(models);
  const labelToResponse = new Map<string, string>();

  // Build labeled responses for the prompt
  const labeledResponses: Array<{ label: string; response: string }> = [];
  for (const [label, model] of Object.entries(labelMap)) {
    const result = stage1Results.find((r) => r.model === model);
    if (result) {
      labeledResponses.push({ label, response: result.response });
      labelToResponse.set(label, result.response);
    }
  }

  const votePrompt = buildVotePrompt(userQuery, labeledResponses);
  const voteResults = await queryModelsParallel(
    config.councilModels,
    votePrompt,
    config.timeoutMs
  );

  const votes: VoteResponse[] = Array.from(voteResults.entries()).map(
    ([model, result]) => ({
      model,
      voteText: result.content,
      votedFor: parseVote(result.content),
      responseTimeMs: result.responseTimeMs,
    })
  );

  const tally = tallyVotes(votes, labelMap);

  return { votes, labelMap, tally };
}

/**
 * Stage 3: Break tie with chairman model (only called when needed).
 */
export async function voteStage3Tiebreaker(
  userQuery: string,
  tiedLabels: string[],
  stage1Results: Stage1Response[],
  labelMap: LabelMap,
  tally: VoteTally,
  config: VoteConfig
): Promise<TiebreakerResult | null> {
  const tiedResponses = tiedLabels.map((label) => {
    const model = labelMap[label];
    const result = stage1Results.find((r) => r.model === model);
    return {
      label,
      response: result?.response ?? "",
      voteCount: tally.tallies[label] ?? 0,
    };
  });

  const prompt = buildTiebreakerPrompt(userQuery, tiedResponses);

  // Try up to 2 times
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await queryModel(config.chairmanModel, prompt, config.timeoutMs);
    if (!result) continue;

    const votedFor = parseVote(result.content);
    if (votedFor && tiedLabels.includes(votedFor)) {
      return {
        model: config.chairmanModel,
        voteText: result.content,
        votedFor,
        responseTimeMs: result.responseTimeMs,
      };
    }
  }

  // Fallback: pick first tied label alphabetically
  const fallbackLabel = [...tiedLabels].sort()[0];
  return {
    model: config.chairmanModel,
    voteText: `[Tiebreaker parse failed — defaulting to ${fallbackLabel}]`,
    votedFor: fallbackLabel,
    responseTimeMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Full Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full Vote pipeline and return the result.
 * Used for non-streaming testing. The SSE handler calls individual stages.
 */
export async function runFullVote(
  userQuery: string,
  config: VoteConfig = DEFAULT_VOTE_CONFIG,
  history: ConversationTurn[] = []
): Promise<VoteResult> {
  // Stage 1: Collect
  const stage1Results = await voteStage1Collect(userQuery, config, history);
  if (stage1Results.length < 2) {
    throw new Error(
      `Vote mode requires at least 2 successful responses, got ${stage1Results.length}.`
    );
  }

  // Stage 2: Vote
  const { votes, labelMap, tally } = await voteStage2Vote(
    userQuery,
    stage1Results,
    config
  );
  if (tally.totalValidVotes === 0) {
    throw new Error("All votes failed to parse.");
  }

  // Stage 3: Tiebreaker (if needed)
  let tiebreaker: TiebreakerResult | undefined;
  let winnerLabel: string;

  if (tally.isTie) {
    const tbResult = await voteStage3Tiebreaker(
      userQuery,
      tally.winners,
      stage1Results,
      labelMap,
      tally,
      config
    );
    if (tbResult) {
      tiebreaker = tbResult;
      winnerLabel = tbResult.votedFor;
    } else {
      winnerLabel = tally.winners[0];
    }
  } else {
    winnerLabel = tally.winners[0];
  }

  // Resolve winner
  const winnerModel = labelMap[winnerLabel];
  const winnerResponse =
    stage1Results.find((r) => r.model === winnerModel)?.response ?? "";

  const voteRound: VoteRoundResult = {
    votes,
    tallies: tally.tallies,
    labelToModel: labelMap,
    validVoteCount: tally.totalValidVotes,
    invalidVoteCount: tally.invalidVotes.length,
    isTie: tally.isTie,
    tiedLabels: tally.isTie ? tally.winners : [],
  };

  const winner: VoteWinnerResult = {
    winnerLabel,
    winnerModel,
    winnerResponse,
    voteCount: tally.tallies[winnerLabel] ?? 0,
    totalVotes: tally.totalValidVotes,
    tiebroken: !!tiebreaker,
    tiebreakerModel: tiebreaker?.model,
  };

  return { stage1: stage1Results, voteRound, tiebreaker, winner };
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Vote pipeline, emitting SSE events via the controller.
 * Saves all data to deliberation_stages.
 */
export async function handleVoteStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: VoteConfig;
    history: ConversationTurn[];
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config, history } = params;
  const stages: DeliberationStageData[] = [];

  // --- Emit start ---
  emit({
    type: "vote_start",
    data: { conversationId, messageId, mode: "vote" },
  });

  // --- Stage 1: Collect ---
  emit({ type: "stage1_start" });

  const stage1Results = await voteStage1Collect(question, config, history);

  emit({ type: "stage1_complete", data: stage1Results });

  if (stage1Results.length < 2) {
    emit({
      type: "error",
      message: `Vote mode requires at least 2 responses, got ${stage1Results.length}.`,
    });
    return stages;
  }

  // Save collect stages
  const models = stage1Results.map((r) => r.model);
  const labelMap = createLabelMap(models);

  // Save label map
  stages.push({
    stageType: "label_map",
    stageOrder: 0,
    model: null,
    role: null,
    content: JSON.stringify(labelMap),
    parsedData: labelMap,
    responseTimeMs: null,
  });

  // Save Stage 1 responses
  for (const r of stage1Results) {
    stages.push({
      stageType: "collect",
      stageOrder: 1,
      model: r.model,
      role: "respondent",
      content: r.response,
      parsedData: { responseTimeMs: r.responseTimeMs },
      responseTimeMs: r.responseTimeMs,
    });
  }

  // --- Stage 2: Vote ---
  emit({ type: "vote_round_start" });

  const { votes, tally } = await voteStage2Vote(question, stage1Results, config);

  const voteRound: VoteRoundResult = {
    votes,
    tallies: tally.tallies,
    labelToModel: labelMap,
    validVoteCount: tally.totalValidVotes,
    invalidVoteCount: tally.invalidVotes.length,
    isTie: tally.isTie,
    tiedLabels: tally.isTie ? tally.winners : [],
  };

  emit({ type: "vote_round_complete", data: voteRound });

  // Save vote stages
  for (const v of votes) {
    stages.push({
      stageType: "vote",
      stageOrder: 2,
      model: v.model,
      role: "voter",
      content: v.voteText,
      parsedData: { votedFor: v.votedFor },
      responseTimeMs: v.responseTimeMs,
    });
  }

  // Save tally
  stages.push({
    stageType: "vote_tally",
    stageOrder: 3,
    model: null,
    role: null,
    content: JSON.stringify({
      tallies: tally.tallies,
      isTie: tally.isTie,
      winners: tally.winners,
    }),
    parsedData: {
      tallies: tally.tallies,
      validVoteCount: tally.totalValidVotes,
      invalidVoteCount: tally.invalidVotes.length,
      isTie: tally.isTie,
      winners: tally.winners,
      tiedLabels: tally.isTie ? tally.winners : [],
    },
    responseTimeMs: null,
  });

  if (tally.totalValidVotes === 0) {
    emit({ type: "error", message: "All votes failed to parse." });
    return stages;
  }

  // --- Stage 3: Tiebreaker (if needed) ---
  let winnerLabel: string;
  let tiebreaker: TiebreakerResult | undefined;

  if (tally.isTie) {
    emit({ type: "tiebreaker_start" });

    const tbResult = await voteStage3Tiebreaker(
      question,
      tally.winners,
      stage1Results,
      labelMap,
      tally,
      config
    );

    if (tbResult) {
      tiebreaker = tbResult;
      winnerLabel = tbResult.votedFor;

      emit({ type: "tiebreaker_complete", data: tbResult });

      stages.push({
        stageType: "tiebreaker",
        stageOrder: 4,
        model: tbResult.model,
        role: "chairman",
        content: tbResult.voteText,
        parsedData: {
          votedFor: tbResult.votedFor,
          tiedLabels: tally.winners,
          tiedVoteCount: tally.tallies[tally.winners[0]] ?? 0,
        },
        responseTimeMs: tbResult.responseTimeMs,
      });
    } else {
      winnerLabel = tally.winners[0];
    }
  } else {
    winnerLabel = tally.winners[0];
  }

  // --- Declare Winner ---
  const winnerModel = labelMap[winnerLabel];
  const winnerResponse =
    stage1Results.find((r) => r.model === winnerModel)?.response ?? "";

  const winner: VoteWinnerResult = {
    winnerLabel,
    winnerModel,
    winnerResponse,
    voteCount: tally.tallies[winnerLabel] ?? 0,
    totalVotes: tally.totalValidVotes,
    tiebroken: !!tiebreaker,
    tiebreakerModel: tiebreaker?.model,
  };

  emit({ type: "winner_declared", data: winner });

  stages.push({
    stageType: "winner",
    stageOrder: 5,
    model: winnerModel,
    role: "winner",
    content: winnerResponse,
    parsedData: {
      winnerLabel,
      winnerModel,
      voteCount: winner.voteCount,
      totalVotes: winner.totalVotes,
      tiebroken: winner.tiebroken,
    },
    responseTimeMs: null,
  });

  // Note: title generation and "complete" event are handled by the route dispatcher.

  return stages;
}
