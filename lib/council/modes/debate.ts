/**
 * Debate Mode — Answer -> Revise -> Vote -> Declare Winner
 *
 * Multi-round deliberation with peer influence. Models answer in parallel,
 * then see each other's anonymized responses and can REVISE, STAND, or MERGE.
 * Finally, all models vote on revised responses and a winner is declared.
 *
 * No chairman — all models are equal peers. Ties broken alphabetically.
 * Output is the winning model's REVISED response.
 *
 * See docs/modes/04-debate.md for full specification.
 */

import type {
  Stage1Response,
  LabelMap,
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel } from "../openrouter";
import { createLabelMap } from "../ranking-parser";
import { parseVote, tallyVotes } from "./vote";
import type { VoteResponse, VoteTally } from "./vote";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DebateConfig {
  models: string[];
  timeoutMs: number;
}

export const DEFAULT_DEBATE_CONFIG: DebateConfig = {
  models: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  timeoutMs: 120_000,
};

export interface ParsedRevision {
  decision: "REVISE" | "STAND" | "MERGE" | null;
  reasoning: string | null;
  revisedResponse: string | null;
}

export interface RevisionResponse {
  model: string;
  decision: "REVISE" | "STAND" | "MERGE" | null;
  reasoning: string | null;
  originalResponse: string;
  revisedResponse: string;
  originalWordCount: number;
  revisedWordCount: number;
  responseTimeMs: number;
  parseSuccess: boolean;
}

export interface RevisionSummary {
  totalModels: number;
  revised: number;
  stood: number;
  merged: number;
  parseFailed: number;
}

export interface DebateVoteResult {
  votes: VoteResponse[];
  tallies: Record<string, number>;
  revisedLabelToModel: LabelMap;
  validVoteCount: number;
  invalidVoteCount: number;
  isTie: boolean;
  tiedLabels: string[];
}

export interface DebateWinnerResult {
  winnerLabel: string;
  winnerModel: string;
  winnerResponse: string;
  winnerDecision: "REVISE" | "STAND" | "MERGE" | null;
  voteCount: number;
  totalVotes: number;
  tiebroken: boolean;
  tiebreakerMethod?: "alphabetical";
}

export interface DebateResult {
  round1: Stage1Response[];
  round1LabelMap: LabelMap;
  revisions: RevisionResponse[];
  revisionSummary: RevisionSummary;
  revisedLabelMap: LabelMap;
  votes: DebateVoteResult;
  winner: DebateWinnerResult;
  title?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple word count — splits on whitespace. */
export function wordCount(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Create a shuffled label map — randomizes model order before assigning
 * "Response A", "Response B", etc. to prevent position bias.
 */
export function createShuffledLabelMap(models: string[]): LabelMap {
  const shuffled = [...models];
  // Fisher-Yates shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return createLabelMap(shuffled);
}

// ---------------------------------------------------------------------------
// Revision Parser
// ---------------------------------------------------------------------------

/**
 * Parse a revision response from model text.
 * Extracts DECISION, REASONING, and REVISED RESPONSE sections.
 */
export function parseRevision(text: string): ParsedRevision {
  if (!text || !text.trim()) {
    return { decision: null, reasoning: null, revisedResponse: null };
  }

  // Extract decision — handle markdown bold formatting (e.g. **REVISE**)
  const decisionMatch = text.match(
    /DECISION:\s*\**\s*(REVISE|STAND|MERGE)\s*\**/i
  );
  const decision = decisionMatch
    ? (decisionMatch[1].toUpperCase() as "REVISE" | "STAND" | "MERGE")
    : null;

  // Extract reasoning (use [\s\S] instead of . with s-flag for cross-line matching)
  const reasoningMatch = text.match(
    /REASONING:\s*([\s\S]+?)(?:\n\n|\nREVISED RESPONSE:)/i
  );
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : null;

  // Extract revised response (everything after "REVISED RESPONSE:")
  const responseMatch = text.match(/REVISED RESPONSE:\s*\n?([\s\S]+)$/i);
  const revisedResponse = responseMatch ? responseMatch[1].trim() : null;

  // Fallback: if no REVISED RESPONSE marker but we have a decision,
  // use text after the reasoning block
  if (!revisedResponse && decision) {
    const afterReasoning = text.split(/REASONING:[\s\S]*?\n/i);
    if (afterReasoning.length > 1) {
      const remainder = afterReasoning[afterReasoning.length - 1].trim();
      if (remainder) {
        return { decision, reasoning, revisedResponse: remainder };
      }
    }
  }

  return { decision, reasoning, revisedResponse };
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the revision prompt — unique per model.
 * Shows the model its own response + anonymized others.
 */
export function buildRevisionPrompt(params: {
  userQuery: string;
  yourOriginalResponse: string;
  otherResponses: Array<{ label: string; response: string }>;
}): string {
  const { userQuery, yourOriginalResponse, otherResponses } = params;

  const othersText = otherResponses
    .map((r) => `--- ${r.label} ---\n${r.response}`)
    .join("\n\n");

  return `You previously answered a question. Now you will see how other respondents answered the same question (anonymously). You may revise your response or stand by your original if you believe it was superior.

ORIGINAL QUESTION:
${userQuery}

YOUR ORIGINAL RESPONSE:
${yourOriginalResponse}

OTHER RESPONSES:
${othersText}

Instructions:
1. Carefully consider the other responses. What insights do they offer that yours missed?
2. Identify any errors or omissions in your original response.
3. You have three options:
   a) REVISE: Produce an improved response incorporating insights from others
   b) STAND: Keep your original response unchanged (explain why)
   c) MERGE: Substantially rewrite by combining the best elements of all responses

State your choice, then provide the response:

DECISION: [REVISE|STAND|MERGE]
REASONING: [1-2 sentences on why]

REVISED RESPONSE:
[Your final response — if STAND, repeat your original]`;
}

/**
 * Build the vote prompt for revised responses.
 * Uses the same voting format as Vote mode.
 */
export function buildDebateVotePrompt(
  userQuery: string,
  revisedLabeledResponses: Array<{ label: string; response: string }>
): string {
  const responsesText = revisedLabeledResponses
    .map((r) => `--- ${r.label} ---\n${r.response}`)
    .join("\n\n");

  return `After a round of deliberation, all respondents have finalized their answers. Vote for the single best response.

Question: ${userQuery}

${responsesText}

Consider: accuracy, completeness, clarity, helpfulness, and practical value.

You MUST end your response with your vote in this exact format:
VOTE: Response X

where X is the letter of your chosen response. You may provide brief reasoning before the vote, but the last line MUST be your vote.`;
}

/**
 * Build title generation prompt.
 */
export function buildDebateTitlePrompt(userQuery: string): string {
  return `Generate a brief title (3-5 words) for a conversation that starts with this question:

"${userQuery}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.`;
}

// ---------------------------------------------------------------------------
// Pipeline — Revision Stage
// ---------------------------------------------------------------------------

/**
 * Build unique revision prompts for each model.
 * Each model sees its own response + all others anonymized.
 */
function buildRevisionPrompts(
  stage1Results: Stage1Response[],
  labelMap: LabelMap,
  userQuery: string
): Map<string, string> {
  const prompts = new Map<string, string>();

  for (const result of stage1Results) {
    // Get all OTHER responses (anonymized)
    const otherResponses = stage1Results
      .filter((r) => r.model !== result.model)
      .map((r) => {
        const label = Object.entries(labelMap).find(
          ([, model]) => model === r.model
        )?.[0];
        return { label: label!, response: r.response };
      });

    const prompt = buildRevisionPrompt({
      userQuery,
      yourOriginalResponse: result.response,
      otherResponses,
    });

    prompts.set(result.model, prompt);
  }

  return prompts;
}

/**
 * Execute revision stage — each model gets a unique prompt, run in parallel.
 */
async function executeRevisions(
  stage1Results: Stage1Response[],
  labelMap: LabelMap,
  userQuery: string,
  timeoutMs: number
): Promise<RevisionResponse[]> {
  const prompts = buildRevisionPrompts(stage1Results, labelMap, userQuery);

  // Query each model with its unique prompt in parallel
  const entries = Array.from(prompts.entries());
  const results = await Promise.allSettled(
    entries.map(([model, prompt]) =>
      queryModel(model, prompt, timeoutMs).then((result) => ({ model, result }))
    )
  );

  const revisions: RevisionResponse[] = [];

  for (let i = 0; i < results.length; i++) {
    const settled = results[i];
    const model = entries[i][0];
    const originalResult = stage1Results.find((r) => r.model === model)!;

    if (settled.status === "fulfilled" && settled.value.result) {
      const { result: queryResult } = settled.value;
      const parsed = parseRevision(queryResult.content);

      // Determine the revised response
      let revisedResponse: string;
      if (parsed.revisedResponse) {
        revisedResponse = parsed.revisedResponse;
      } else {
        // Fallback: use original response
        revisedResponse = originalResult.response;
      }

      revisions.push({
        model,
        decision: parsed.decision,
        reasoning: parsed.reasoning,
        originalResponse: originalResult.response,
        revisedResponse,
        originalWordCount: wordCount(originalResult.response),
        revisedWordCount: wordCount(revisedResponse),
        responseTimeMs: queryResult.responseTimeMs,
        parseSuccess: parsed.decision !== null,
      });
    } else {
      // Model failed — use original response
      revisions.push({
        model,
        decision: null,
        reasoning: null,
        originalResponse: originalResult.response,
        revisedResponse: originalResult.response,
        originalWordCount: wordCount(originalResult.response),
        revisedWordCount: wordCount(originalResult.response),
        responseTimeMs: 0,
        parseSuccess: false,
      });
    }
  }

  return revisions;
}

/**
 * Compute a summary of revision decisions.
 */
function computeRevisionSummary(revisions: RevisionResponse[]): RevisionSummary {
  return {
    totalModels: revisions.length,
    revised: revisions.filter((r) => r.decision === "REVISE").length,
    stood: revisions.filter((r) => r.decision === "STAND").length,
    merged: revisions.filter((r) => r.decision === "MERGE").length,
    parseFailed: revisions.filter((r) => r.decision === null).length,
  };
}

// ---------------------------------------------------------------------------
// Pipeline — Vote Stage
// ---------------------------------------------------------------------------

/**
 * Execute the voting round on revised responses.
 */
async function executeDebateVote(
  userQuery: string,
  revisions: RevisionResponse[],
  revisedLabelMap: LabelMap,
  models: string[],
  timeoutMs: number
): Promise<{ votes: VoteResponse[]; tally: VoteTally }> {
  // Build labeled responses from revised outputs
  const labeledResponses: Array<{ label: string; response: string }> = [];
  for (const [label, model] of Object.entries(revisedLabelMap)) {
    const revision = revisions.find((r) => r.model === model);
    if (revision) {
      labeledResponses.push({ label, response: revision.revisedResponse });
    }
  }

  const votePrompt = buildDebateVotePrompt(userQuery, labeledResponses);
  const voteResults = await queryModelsParallel(models, votePrompt, timeoutMs);

  const votes: VoteResponse[] = Array.from(voteResults.entries()).map(
    ([model, result]) => ({
      model,
      voteText: result.content,
      votedFor: parseVote(result.content),
      responseTimeMs: result.responseTimeMs,
    })
  );

  const tally = tallyVotes(votes, revisedLabelMap);

  return { votes, tally };
}

/**
 * Determine the winner from vote tallies.
 * No chairman tiebreaker — ties broken alphabetically by label.
 */
function determineWinner(
  tally: VoteTally,
  revisedLabelMap: LabelMap,
  revisions: RevisionResponse[]
): DebateWinnerResult {
  const isTie = tally.isTie;
  let winnerLabel: string;

  if (isTie && tally.winners.length > 0) {
    // Alphabetical tiebreaker — sort labels and pick first
    winnerLabel = [...tally.winners].sort()[0];
  } else if (tally.winners.length > 0) {
    winnerLabel = tally.winners[0];
  } else {
    // All votes invalid — fall back to first label alphabetically
    const allLabels = Object.keys(revisedLabelMap).sort();
    winnerLabel = allLabels[0];
  }

  const winnerModel = revisedLabelMap[winnerLabel];
  const winnerRevision = revisions.find((r) => r.model === winnerModel);

  return {
    winnerLabel,
    winnerModel,
    winnerResponse: winnerRevision?.revisedResponse ?? "",
    winnerDecision: winnerRevision?.decision ?? null,
    voteCount: tally.tallies[winnerLabel] ?? 0,
    totalVotes: tally.totalValidVotes,
    tiebroken: isTie,
    ...(isTie ? { tiebreakerMethod: "alphabetical" as const } : {}),
  };
}

// ---------------------------------------------------------------------------
// Full Pipeline (non-streaming)
// ---------------------------------------------------------------------------

/**
 * Run the full Debate pipeline and return the result.
 * Used for non-streaming testing. The SSE handler calls individual stages.
 */
export async function runFullDebate(
  userQuery: string,
  config: DebateConfig = DEFAULT_DEBATE_CONFIG
): Promise<DebateResult> {
  // Stage 1: Initial answers
  const stage1Results = await collectInitialAnswers(userQuery, config);
  if (stage1Results.length < 2) {
    throw new Error(
      `Debate mode requires at least 2 successful responses, got ${stage1Results.length}.`
    );
  }

  // Create Round 1 label map
  const round1LabelMap = createLabelMap(stage1Results.map((r) => r.model));

  // Stage 2: Revision
  const revisions = await executeRevisions(
    stage1Results,
    round1LabelMap,
    userQuery,
    config.timeoutMs
  );
  const revisionSummary = computeRevisionSummary(revisions);

  // Create shuffled Round 2 label map for voting
  const revisedLabelMap = createShuffledLabelMap(
    revisions.map((r) => r.model)
  );

  // Stage 3: Vote on revised responses
  const { votes, tally } = await executeDebateVote(
    userQuery,
    revisions,
    revisedLabelMap,
    config.models,
    config.timeoutMs
  );
  if (tally.totalValidVotes === 0) {
    throw new Error("All votes failed to parse.");
  }

  // Stage 4: Determine winner
  const winner = determineWinner(tally, revisedLabelMap, revisions);

  const voteResult: DebateVoteResult = {
    votes,
    tallies: tally.tallies,
    revisedLabelToModel: revisedLabelMap,
    validVoteCount: tally.totalValidVotes,
    invalidVoteCount: tally.invalidVotes.length,
    isTie: tally.isTie,
    tiedLabels: tally.isTie ? tally.winners : [],
  };

  return {
    round1: stage1Results,
    round1LabelMap,
    revisions,
    revisionSummary,
    revisedLabelMap,
    votes: voteResult,
    winner,
  };
}

/**
 * Stage 1: Collect initial answers (identical to Council/Vote Stage 1).
 */
async function collectInitialAnswers(
  userQuery: string,
  config: DebateConfig
): Promise<Stage1Response[]> {
  const results = await queryModelsParallel(
    config.models,
    userQuery,
    config.timeoutMs
  );

  return Array.from(results.entries()).map(([model, result]) => ({
    model,
    response: result.content,
    responseTimeMs: result.responseTimeMs,
  }));
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Debate pipeline, emitting SSE events via the controller.
 * Returns stage data for persistence to deliberation_stages.
 */
export async function handleDebateStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: DebateConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // --- Emit start ---
  emit({
    type: "debate_start",
    data: { conversationId, messageId, mode: "debate" },
  });

  // --- Stage 1: Initial answers ---
  emit({ type: "round1_start" });

  const stage1Results = await collectInitialAnswers(question, config);

  emit({ type: "round1_complete", data: stage1Results });

  if (stage1Results.length < 2) {
    emit({
      type: "error",
      message: `Debate mode requires at least 2 responses, got ${stage1Results.length}.`,
    });
    return stages;
  }

  // Create Round 1 label map
  const round1LabelMap = createLabelMap(stage1Results.map((r) => r.model));

  // Save Round 1 label map
  stages.push({
    stageType: "round1_label_map",
    stageOrder: 0,
    model: null,
    role: null,
    content: JSON.stringify(round1LabelMap),
    parsedData: round1LabelMap,
    responseTimeMs: null,
  });

  // Save initial answers
  for (const r of stage1Results) {
    stages.push({
      stageType: "initial_answer",
      stageOrder: 1,
      model: r.model,
      role: "respondent",
      content: r.response,
      parsedData: { responseTimeMs: r.responseTimeMs },
      responseTimeMs: r.responseTimeMs,
    });
  }

  // --- Stage 2: Revision ---
  emit({ type: "revision_start", data: { labelMap: round1LabelMap } });

  const revisions = await executeRevisions(
    stage1Results,
    round1LabelMap,
    question,
    config.timeoutMs
  );
  const revisionSummary = computeRevisionSummary(revisions);

  emit({
    type: "revision_complete",
    data: { revisions, summary: revisionSummary },
  });

  // Save revision stages
  for (const rev of revisions) {
    // Reconstruct the full revision text for storage
    const revisionText = rev.parseSuccess
      ? `DECISION: ${rev.decision}\nREASONING: ${rev.reasoning ?? ""}\n\nREVISED RESPONSE:\n${rev.revisedResponse}`
      : rev.revisedResponse;

    stages.push({
      stageType: "revision",
      stageOrder: 2,
      model: rev.model,
      role: "debater",
      content: revisionText,
      parsedData: {
        decision: rev.decision,
        reasoning: rev.reasoning,
        originalWordCount: rev.originalWordCount,
        revisedWordCount: rev.revisedWordCount,
        parseSuccess: rev.parseSuccess,
      },
      responseTimeMs: rev.responseTimeMs,
    });
  }

  // Save revision summary
  stages.push({
    stageType: "revision_summary",
    stageOrder: 3,
    model: null,
    role: null,
    content: JSON.stringify(revisionSummary),
    parsedData: revisionSummary,
    responseTimeMs: null,
  });

  // --- Stage 3: Vote on revised responses ---
  // Create shuffled label map for revised round
  const revisedLabelMap = createShuffledLabelMap(
    revisions.map((r) => r.model)
  );

  // Save revised label map
  stages.push({
    stageType: "revised_label_map",
    stageOrder: 4,
    model: null,
    role: null,
    content: JSON.stringify(revisedLabelMap),
    parsedData: revisedLabelMap,
    responseTimeMs: null,
  });

  emit({ type: "vote_start", data: { revisedLabelMap } });

  const { votes, tally } = await executeDebateVote(
    question,
    revisions,
    revisedLabelMap,
    config.models,
    config.timeoutMs
  );

  const voteResult: DebateVoteResult = {
    votes,
    tallies: tally.tallies,
    revisedLabelToModel: revisedLabelMap,
    validVoteCount: tally.totalValidVotes,
    invalidVoteCount: tally.invalidVotes.length,
    isTie: tally.isTie,
    tiedLabels: tally.isTie ? tally.winners : [],
  };

  emit({ type: "vote_complete", data: voteResult });

  // Save vote stages
  for (const v of votes) {
    stages.push({
      stageType: "debate_vote",
      stageOrder: 5,
      model: v.model,
      role: "voter",
      content: v.voteText,
      parsedData: { votedFor: v.votedFor },
      responseTimeMs: v.responseTimeMs,
    });
  }

  // Save vote tally
  stages.push({
    stageType: "debate_vote_tally",
    stageOrder: 6,
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

  // --- Stage 4: Determine winner ---
  const winner = determineWinner(tally, revisedLabelMap, revisions);

  emit({ type: "winner_declared", data: winner });

  stages.push({
    stageType: "debate_winner",
    stageOrder: 7,
    model: winner.winnerModel,
    role: "winner",
    content: winner.winnerResponse,
    parsedData: {
      winnerLabel: winner.winnerLabel,
      winnerModel: winner.winnerModel,
      winnerDecision: winner.winnerDecision,
      voteCount: winner.voteCount,
      totalVotes: winner.totalVotes,
      tiebroken: winner.tiebroken,
    },
    responseTimeMs: null,
  });

  // Note: title generation and "complete" event are handled by the route dispatcher.

  return stages;
}
