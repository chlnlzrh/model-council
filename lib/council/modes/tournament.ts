/**
 * Tournament Mode — Single-Elimination Bracket with Pairwise Judging
 *
 * Contestant models answer a question in parallel, then are paired for
 * head-to-head judging by a dedicated judge model until one champion
 * remains. The champion's UNMODIFIED original response is the final answer.
 *
 * See docs/modes/11-tournament.md for full specification.
 */

import type {
  Stage1Response,
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TournamentConfig {
  contestantModels: string[];
  judgeModel: string;
  timeoutMs: number;
}

export const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  contestantModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
    "perplexity/sonar-pro",
  ],
  judgeModel: "anthropic/claude-sonnet-4",
  timeoutMs: 120_000,
};

export interface Contestant {
  model: string;
  response: string;
  responseTimeMs: number;
}

export interface BracketMatchup {
  roundNumber: number;
  matchIndex: number;
  contestantA: Contestant;
  contestantB: Contestant | null;
  isBye: boolean;
}

export interface MatchupResult {
  roundNumber: number;
  matchIndex: number;
  contestantAModel: string;
  contestantBModel: string | null;
  winner: "A" | "B";
  winnerModel: string;
  loserModel: string | null;
  judgeReasoning: string;
  judgeResponseText: string;
  responseTimeMs: number;
  isBye: boolean;
  wasRetry: boolean;
  wasDefault: boolean;
}

export interface TournamentRound {
  roundNumber: number;
  matchups: MatchupResult[];
  winners: string[];
  eliminated: string[];
}

export interface BracketPathEntry {
  round: number;
  opponent: string | null;
  result: "won" | "bye";
}

export interface TournamentChampion {
  model: string;
  response: string;
  bracketPath: BracketPathEntry[];
  totalMatchupsWon: number;
  totalRounds: number;
}

export interface TournamentResult {
  responses: Stage1Response[];
  rounds: TournamentRound[];
  champion: TournamentChampion;
  title?: string;
}

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Parse the winner ("A" or "B") from judge response text.
 * Primary: last match of `WINNER: Response [A|B]`
 * Fallback: last match of `Response [A|B]`
 */
export function parseMatchupWinner(text: string): "A" | "B" | null {
  const primary = [...text.matchAll(/WINNER:\s*Response\s+([AB])/gi)];
  if (primary.length > 0) {
    return primary[primary.length - 1][1].toUpperCase() as "A" | "B";
  }

  const fallback = [...text.matchAll(/\bResponse\s+([AB])\b/gi)];
  if (fallback.length > 0) {
    return fallback[fallback.length - 1][1].toUpperCase() as "A" | "B";
  }

  return null;
}

/**
 * Extract the judge's reasoning from response text.
 * Looks for `REASONING: ...` before `WINNER:` or end of text.
 * Falls back to the full text if no marker found.
 */
export function parseJudgeReasoning(text: string): string {
  const match = text.match(/REASONING:\s*([\s\S]+?)(?=\s*WINNER:|$)/i);
  return match ? match[1].trim() : text.trim();
}

/**
 * Build the primary judge prompt for a head-to-head matchup.
 */
export function buildJudgePrompt(
  userQuery: string,
  responseA: string,
  responseB: string
): string {
  return `You are judging a head-to-head matchup between two responses to the same question. Pick the better response.

QUESTION:
${userQuery}

--- Response A ---
${responseA}

--- Response B ---
${responseB}

Evaluate on: accuracy, completeness, clarity, practical value, and overall quality.

Provide brief reasoning (2-3 sentences), then declare the winner:

REASONING: [your analysis]
WINNER: Response [A|B]`;
}

/**
 * Build the strict retry prompt used when the initial judge response
 * could not be parsed.
 */
export function buildStrictRetryPrompt(
  userQuery: string,
  responseA: string,
  responseB: string
): string {
  return `Your previous response could not be parsed. You MUST declare a winner.

QUESTION:
${userQuery}

--- Response A ---
${responseA}

--- Response B ---
${responseB}

Reply with EXACTLY this format and nothing else:

REASONING: [one sentence]
WINNER: Response A

or

REASONING: [one sentence]
WINNER: Response B`;
}

/**
 * Calculate the total number of rounds for a given contestant count.
 */
export function calculateTotalRounds(contestantCount: number): number {
  return Math.ceil(Math.log2(contestantCount));
}

/**
 * Pair contestants into bracket matchups. Last contestant gets a bye
 * if the count is odd.
 */
function pairContestants(
  contestants: Contestant[],
  roundNumber: number
): BracketMatchup[] {
  const matchups: BracketMatchup[] = [];
  for (let i = 0; i < contestants.length; i += 2) {
    const a = contestants[i];
    const b = i + 1 < contestants.length ? contestants[i + 1] : null;
    matchups.push({
      roundNumber,
      matchIndex: matchups.length,
      contestantA: a,
      contestantB: b,
      isBye: b === null,
    });
  }
  return matchups;
}

/**
 * Generate Round 1 matchups from an array of contestants.
 */
export function generateRound1Matchups(
  contestants: Contestant[]
): BracketMatchup[] {
  return pairContestants(contestants, 1);
}

/**
 * Generate matchups for subsequent rounds from the list of winning contestants.
 */
export function generateNextRoundMatchups(
  winners: Contestant[],
  roundNumber: number
): BracketMatchup[] {
  return pairContestants(winners, roundNumber);
}

// ---------------------------------------------------------------------------
// Async Functions
// ---------------------------------------------------------------------------

/**
 * Judge a single matchup. Handles byes, retries on failure, and default
 * winners when all else fails.
 */
export async function judgeMatchup(
  matchup: BracketMatchup,
  userQuery: string,
  judgeModel: string,
  timeoutMs: number
): Promise<MatchupResult> {
  // Bye: instant result
  if (matchup.isBye || !matchup.contestantB) {
    return {
      roundNumber: matchup.roundNumber,
      matchIndex: matchup.matchIndex,
      contestantAModel: matchup.contestantA.model,
      contestantBModel: null,
      winner: "A",
      winnerModel: matchup.contestantA.model,
      loserModel: null,
      judgeReasoning: "Bye \u2014 auto-advance",
      judgeResponseText: "Bye \u2014 auto-advance",
      responseTimeMs: 0,
      isBye: true,
      wasRetry: false,
      wasDefault: false,
    };
  }

  const responseA = matchup.contestantA.response;
  const responseB = matchup.contestantB.response;
  const prompt = buildJudgePrompt(userQuery, responseA, responseB);

  // Attempt 1: query judge
  let result = await queryModel(judgeModel, prompt, timeoutMs);

  // Query failure: retry once with same prompt
  if (!result || !result.content.trim()) {
    result = await queryModel(judgeModel, prompt, timeoutMs);

    // Still fails: contestant A wins by default
    if (!result || !result.content.trim()) {
      return {
        roundNumber: matchup.roundNumber,
        matchIndex: matchup.matchIndex,
        contestantAModel: matchup.contestantA.model,
        contestantBModel: matchup.contestantB.model,
        winner: "A",
        winnerModel: matchup.contestantA.model,
        loserModel: matchup.contestantB.model,
        judgeReasoning: "Judge failed to respond. Contestant A wins by default.",
        judgeResponseText: "",
        responseTimeMs: 0,
        isBye: false,
        wasRetry: false,
        wasDefault: true,
      };
    }
  }

  // Parse winner from judge response
  let winner = parseMatchupWinner(result.content);

  if (winner) {
    const reasoning = parseJudgeReasoning(result.content);
    const winnerModel =
      winner === "A"
        ? matchup.contestantA.model
        : matchup.contestantB.model;
    const loserModel =
      winner === "A"
        ? matchup.contestantB.model
        : matchup.contestantA.model;
    return {
      roundNumber: matchup.roundNumber,
      matchIndex: matchup.matchIndex,
      contestantAModel: matchup.contestantA.model,
      contestantBModel: matchup.contestantB.model,
      winner,
      winnerModel,
      loserModel,
      judgeReasoning: reasoning,
      judgeResponseText: result.content,
      responseTimeMs: result.responseTimeMs,
      isBye: false,
      wasRetry: false,
      wasDefault: false,
    };
  }

  // Parse failure: retry with strict prompt
  const strictPrompt = buildStrictRetryPrompt(userQuery, responseA, responseB);
  const retryResult = await queryModel(judgeModel, strictPrompt, timeoutMs);

  if (retryResult && retryResult.content.trim()) {
    winner = parseMatchupWinner(retryResult.content);
    if (winner) {
      const reasoning = parseJudgeReasoning(retryResult.content);
      const winnerModel =
        winner === "A"
          ? matchup.contestantA.model
          : matchup.contestantB.model;
      const loserModel =
        winner === "A"
          ? matchup.contestantB.model
          : matchup.contestantA.model;
      return {
        roundNumber: matchup.roundNumber,
        matchIndex: matchup.matchIndex,
        contestantAModel: matchup.contestantA.model,
        contestantBModel: matchup.contestantB.model,
        winner,
        winnerModel,
        loserModel,
        judgeReasoning: reasoning,
        judgeResponseText: retryResult.content,
        responseTimeMs: retryResult.responseTimeMs,
        isBye: false,
        wasRetry: true,
        wasDefault: false,
      };
    }
  }

  // Both parse attempts failed: random A/B
  const randomWinner: "A" | "B" = Math.random() < 0.5 ? "A" : "B";
  const winnerModel =
    randomWinner === "A"
      ? matchup.contestantA.model
      : matchup.contestantB.model;
  const loserModel =
    randomWinner === "A"
      ? matchup.contestantB.model
      : matchup.contestantA.model;
  return {
    roundNumber: matchup.roundNumber,
    matchIndex: matchup.matchIndex,
    contestantAModel: matchup.contestantA.model,
    contestantBModel: matchup.contestantB.model,
    winner: randomWinner,
    winnerModel,
    loserModel,
    judgeReasoning: "Judge response could not be parsed. Winner selected randomly.",
    judgeResponseText: retryResult?.content ?? result.content,
    responseTimeMs: retryResult?.responseTimeMs ?? result.responseTimeMs,
    isBye: false,
    wasRetry: true,
    wasDefault: true,
  };
}

/**
 * Execute all matchups in a round in parallel.
 * Emits `matchup_complete` per result.
 */
export async function executeRound(
  matchups: BracketMatchup[],
  userQuery: string,
  judgeModel: string,
  timeoutMs: number,
  emit: (event: SSEEvent) => void
): Promise<{ results: MatchupResult[]; winners: Contestant[] }> {
  const settled = await Promise.allSettled(
    matchups.map((m) => judgeMatchup(m, userQuery, judgeModel, timeoutMs))
  );

  const results: MatchupResult[] = [];
  const winners: Contestant[] = [];

  settled.forEach((outcome, index) => {
    const matchup = matchups[index];

    if (outcome.status === "fulfilled") {
      const mr = outcome.value;
      results.push(mr);

      emit({
        type: "matchup_complete",
        data: {
          round: mr.roundNumber,
          matchIndex: mr.matchIndex,
          winner: `Response ${mr.winner}`,
          winnerModel: mr.winnerModel,
          loserModel: mr.loserModel,
          reasoning: mr.judgeReasoning,
          responseTimeMs: mr.responseTimeMs,
          isBye: mr.isBye,
          wasRetry: mr.wasRetry,
          wasDefault: mr.wasDefault,
        },
      });

      // The winning contestant preserves its original response
      const winningContestant =
        mr.winner === "A" ? matchup.contestantA : (matchup.contestantB ?? matchup.contestantA);
      winners.push(winningContestant);
    } else {
      // Promise rejected (shouldn't happen since judgeMatchup handles errors)
      // Default: contestant A advances
      const fallbackResult: MatchupResult = {
        roundNumber: matchup.roundNumber,
        matchIndex: matchup.matchIndex,
        contestantAModel: matchup.contestantA.model,
        contestantBModel: matchup.contestantB?.model ?? null,
        winner: "A",
        winnerModel: matchup.contestantA.model,
        loserModel: matchup.contestantB?.model ?? null,
        judgeReasoning: "Matchup failed unexpectedly. Contestant A advances by default.",
        judgeResponseText: "",
        responseTimeMs: 0,
        isBye: matchup.isBye,
        wasRetry: false,
        wasDefault: true,
      };
      results.push(fallbackResult);
      winners.push(matchup.contestantA);

      emit({
        type: "matchup_complete",
        data: {
          round: fallbackResult.roundNumber,
          matchIndex: fallbackResult.matchIndex,
          winner: "Response A",
          winnerModel: fallbackResult.winnerModel,
          loserModel: fallbackResult.loserModel,
          reasoning: fallbackResult.judgeReasoning,
          responseTimeMs: 0,
          isBye: matchup.isBye,
          wasRetry: false,
          wasDefault: true,
        },
      });
    }
  });

  return { results, winners };
}

/**
 * Run the full tournament pipeline (non-streaming, for testing).
 */
export async function runFullTournament(
  userQuery: string,
  config: TournamentConfig
): Promise<TournamentResult> {
  const noopEmit = () => {};

  // Stage 1: Collect
  const resultMap = await queryModelsParallel(
    config.contestantModels,
    userQuery,
    config.timeoutMs
  );

  const responses: Stage1Response[] = [];
  const contestants: Contestant[] = [];
  for (const [model, qr] of resultMap.entries()) {
    responses.push({
      model,
      response: qr.content,
      responseTimeMs: qr.responseTimeMs,
    });
    contestants.push({
      model,
      response: qr.content,
      responseTimeMs: qr.responseTimeMs,
    });
  }

  if (contestants.length < 2) {
    throw new Error(
      `Tournament requires at least 2 successful responses, got ${contestants.length}.`
    );
  }

  // Bracket rounds
  const rounds: TournamentRound[] = [];
  let currentMatchups = generateRound1Matchups(contestants);
  let roundNumber = 1;

  while (true) {
    const { results, winners } = await executeRound(
      currentMatchups,
      userQuery,
      config.judgeModel,
      config.timeoutMs,
      noopEmit
    );

    const eliminated = results
      .filter((r) => r.loserModel !== null)
      .map((r) => r.loserModel!);

    rounds.push({
      roundNumber,
      matchups: results,
      winners: winners.map((w) => w.model),
      eliminated,
    });

    if (winners.length <= 1) break;

    roundNumber++;
    currentMatchups = generateNextRoundMatchups(winners, roundNumber);
  }

  // Build champion
  const championModel = rounds[rounds.length - 1].winners[0];
  const championResponse =
    contestants.find((c) => c.model === championModel)?.response ?? "";

  const bracketPath = buildBracketPath(championModel, rounds);

  const champion: TournamentChampion = {
    model: championModel,
    response: championResponse,
    bracketPath,
    totalMatchupsWon: bracketPath.filter((e) => e.result === "won").length,
    totalRounds: rounds.length,
  };

  return { responses, rounds, champion };
}

// ---------------------------------------------------------------------------
// Bracket Path Builder
// ---------------------------------------------------------------------------

/**
 * Build the bracket path for the champion by tracing their matchups
 * through each round.
 */
export function buildBracketPath(
  championModel: string,
  rounds: TournamentRound[]
): BracketPathEntry[] {
  const path: BracketPathEntry[] = [];

  for (const round of rounds) {
    const matchup = round.matchups.find(
      (m) =>
        m.winnerModel === championModel &&
        (m.contestantAModel === championModel ||
          m.contestantBModel === championModel)
    );

    if (!matchup) continue;

    if (matchup.isBye) {
      path.push({
        round: round.roundNumber,
        opponent: null,
        result: "bye",
      });
    } else {
      const opponent =
        matchup.contestantAModel === championModel
          ? matchup.contestantBModel
          : matchup.contestantAModel;
      path.push({
        round: round.roundNumber,
        opponent,
        result: "won",
      });
    }
  }

  return path;
}

// ---------------------------------------------------------------------------
// SSE Stream Handler
// ---------------------------------------------------------------------------

export async function handleTournamentStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: TournamentConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  const totalRounds = calculateTotalRounds(config.contestantModels.length);

  // 1. tournament_start
  emit({
    type: "tournament_start",
    data: {
      conversationId,
      messageId,
      config: {
        contestantModels: config.contestantModels,
        judgeModel: config.judgeModel,
        totalRounds,
      },
    },
  });

  // 2. collect_start
  emit({ type: "collect_start" });

  // Stage 1: Collect responses
  const resultMap = await queryModelsParallel(
    config.contestantModels,
    question,
    config.timeoutMs
  );

  const responses: Stage1Response[] = [];
  const contestants: Contestant[] = [];
  for (const [model, qr] of resultMap.entries()) {
    if (qr.content.trim()) {
      responses.push({
        model,
        response: qr.content,
        responseTimeMs: qr.responseTimeMs,
      });
      contestants.push({
        model,
        response: qr.content,
        responseTimeMs: qr.responseTimeMs,
      });
    }
  }

  // 3. collect_complete
  emit({ type: "collect_complete", data: responses });

  // Push collect stages
  for (const r of responses) {
    stages.push({
      stageType: "collect",
      stageOrder: 0,
      model: r.model,
      role: "contestant",
      content: r.response,
      parsedData: { responseTimeMs: r.responseTimeMs },
      responseTimeMs: r.responseTimeMs,
    });
  }

  // 4. Validate minimum contestants
  if (contestants.length < 2) {
    emit({
      type: "error",
      message: `Tournament requires at least 2 successful responses, got ${contestants.length}.`,
    });
    return stages;
  }

  // 5. Bracket seeding
  const actualTotalRounds = calculateTotalRounds(contestants.length);
  const round1Matchups = generateRound1Matchups(contestants);
  const byes = round1Matchups
    .filter((m) => m.isBye)
    .map((m) => m.contestantA.model);

  emit({
    type: "bracket_seeded",
    data: {
      totalRounds: actualTotalRounds,
      contestants: contestants.map((c) => c.model),
      byes,
      matchups: round1Matchups.map((m) => ({
        roundNumber: m.roundNumber,
        matchIndex: m.matchIndex,
        contestantA: m.contestantA.model,
        contestantB: m.contestantB?.model ?? null,
      })),
    },
  });

  // Push bracket_seed stage
  stages.push({
    stageType: "bracket_seed",
    stageOrder: 1,
    model: null,
    role: null,
    content: `Tournament bracket: ${contestants.length} contestants, ${actualTotalRounds} rounds. ${byes.length > 0 ? `Byes: ${byes.join(", ")}.` : "No byes."}`,
    parsedData: {
      type: "bracket",
      totalRounds: actualTotalRounds,
      contestants: contestants.map((c) => c.model),
      byes,
      round1Matchups: round1Matchups.map((m) => ({
        matchIndex: m.matchIndex,
        a: m.contestantA.model,
        b: m.contestantB?.model ?? null,
      })),
    },
    responseTimeMs: null,
  });

  // 6. Round loop
  const allRounds: TournamentRound[] = [];
  let currentMatchups = round1Matchups;
  let roundNumber = 1;

  while (true) {
    // round_start
    emit({
      type: "round_start",
      data: {
        round: roundNumber,
        matchups: currentMatchups.map((m) => ({
          matchIndex: m.matchIndex,
          contestantA: { model: m.contestantA.model, label: "Response A" },
          contestantB: m.contestantB
            ? { model: m.contestantB.model, label: "Response B" }
            : null,
        })),
      },
    });

    // Execute round (parallel matchups, emits matchup_complete per result)
    const { results, winners } = await executeRound(
      currentMatchups,
      question,
      config.judgeModel,
      config.timeoutMs,
      emit
    );

    // Push matchup stages
    for (const mr of results) {
      stages.push({
        stageType: `round_${mr.roundNumber}_match_${mr.matchIndex}`,
        stageOrder: mr.roundNumber + 1,
        model: mr.isBye ? null : config.judgeModel,
        role: mr.isBye ? null : "judge",
        content: mr.judgeResponseText,
        parsedData: {
          round: mr.roundNumber,
          matchIndex: mr.matchIndex,
          contestantA: mr.contestantAModel,
          contestantB: mr.contestantBModel,
          labelA: "Response A",
          labelB: mr.contestantBModel ? "Response B" : null,
          winner: `Response ${mr.winner}`,
          winnerModel: mr.winnerModel,
          loserModel: mr.loserModel,
          reasoning: mr.judgeReasoning,
          isBye: mr.isBye,
        },
        responseTimeMs: mr.isBye ? null : mr.responseTimeMs,
      });
    }

    const eliminated = results
      .filter((r) => r.loserModel !== null)
      .map((r) => r.loserModel!);

    const round: TournamentRound = {
      roundNumber,
      matchups: results,
      winners: winners.map((w) => w.model),
      eliminated,
    };
    allRounds.push(round);

    // round_complete
    emit({
      type: "round_complete",
      data: {
        round: roundNumber,
        winners: winners.map((w) => w.model),
        eliminated,
      },
    });

    if (winners.length <= 1) break;

    roundNumber++;
    currentMatchups = generateNextRoundMatchups(winners, roundNumber);
  }

  // 7. Winner declaration
  const championModel = allRounds[allRounds.length - 1].winners[0];
  const championResponse =
    contestants.find((c) => c.model === championModel)?.response ?? "";
  const bracketPath = buildBracketPath(championModel, allRounds);
  const totalMatchupsWon = bracketPath.filter((e) => e.result === "won").length;

  emit({
    type: "winner_declared",
    data: {
      model: championModel,
      response: championResponse,
      bracketPath,
      totalMatchupsWon,
      totalRounds: allRounds.length,
    },
  });

  // Push winner stage
  stages.push({
    stageType: "winner",
    stageOrder: 99,
    model: championModel,
    role: "champion",
    content: championResponse,
    parsedData: {
      winnerModel: championModel,
      totalMatchupsWon,
      totalRounds: allRounds.length,
      bracketPath,
    },
    responseTimeMs: null,
  });

  return stages;
}
