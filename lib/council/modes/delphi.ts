/**
 * Delphi Mode — Iterative anonymous estimation with statistical feedback.
 *
 * Implements the classic Delphi method: models independently estimate/answer,
 * receive only anonymous statistical feedback (never individual responses),
 * and iteratively revise until convergence or max rounds.
 *
 * A separate facilitator model classifies the question type and produces
 * a final synthesis report.
 *
 * See docs/modes/05-delphi.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelphiConfig {
  panelistModels: string[];
  facilitatorModel: string;
  maxRounds: number;
  numericConvergenceThreshold: number;
  qualitativeConvergenceThreshold: number;
  timeoutMs: number;
}

export const DEFAULT_DELPHI_CONFIG: DelphiConfig = {
  panelistModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
    "perplexity/sonar-pro",
  ],
  facilitatorModel: "anthropic/claude-sonnet-4-5-20250929",
  maxRounds: 5,
  numericConvergenceThreshold: 0.15,
  qualitativeConvergenceThreshold: 75,
  timeoutMs: 120_000,
};

export interface DelphiClassification {
  type: "numeric" | "qualitative";
  options: string[] | null;
  reasoning: string;
}

export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ConfidenceCounts {
  low: number;
  medium: number;
  high: number;
}

export interface NumericStats {
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  cv: number;
  confidenceCounts: ConfidenceCounts;
}

export interface QualitativeDistributionEntry {
  answer: string;
  count: number;
  percentage: number;
}

export interface QualitativeStats {
  distribution: QualitativeDistributionEntry[];
  agreementPercentage: number;
  mode: string;
  confidenceCounts: ConfidenceCounts;
}

export interface DelphiNumericEstimate {
  model: string;
  estimate: number;
  confidence: ConfidenceLevel;
  reasoning: string;
  previousEstimate: number | null;
  changed: boolean;
  responseTimeMs: number;
}

export interface DelphiQualitativeEstimate {
  model: string;
  answer: string;
  confidence: ConfidenceLevel;
  reasoning: string;
  previousAnswer: string | null;
  changed: boolean;
  responseTimeMs: number;
}

export type DelphiEstimate = DelphiNumericEstimate | DelphiQualitativeEstimate;

export interface DelphiRound {
  roundNumber: number;
  estimates: DelphiEstimate[];
  stats: NumericStats | QualitativeStats;
  converged: boolean;
}

export interface DelphiReport {
  facilitatorModel: string;
  report: string;
  totalRounds: number;
  converged: boolean;
  finalValue: number | string;
  responseTimeMs: number;
}

export interface DelphiResult {
  classification: DelphiClassification;
  rounds: DelphiRound[];
  converged: boolean;
  convergenceRound: number | null;
  finalValue: number | string;
  report: DelphiReport;
  title?: string;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse confidence level from text. Defaults to MEDIUM on failure.
 */
export function parseConfidence(text: string): ConfidenceLevel {
  if (!text) return "MEDIUM";
  const upper = text.toUpperCase().trim();
  if (upper.includes("HIGH")) return "HIGH";
  if (upper.includes("LOW")) return "LOW";
  if (upper.includes("MEDIUM")) return "MEDIUM";
  return "MEDIUM";
}

/**
 * Parse the facilitator's question classification.
 * Falls back to "qualitative" if parsing fails.
 */
export function parseClassification(text: string): DelphiClassification {
  if (!text || !text.trim()) {
    return { type: "qualitative", options: null, reasoning: "" };
  }

  // Extract TYPE
  const typeMatch = text.match(/TYPE:\s*(NUMERIC|QUALITATIVE)/i);
  const type: "numeric" | "qualitative" = typeMatch
    ? (typeMatch[1].toUpperCase() === "NUMERIC" ? "numeric" : "qualitative")
    : "qualitative";

  // Extract OPTIONS
  let options: string[] | null = null;
  const optionsMatch = text.match(/OPTIONS:\s*(.+)/i);
  if (optionsMatch) {
    const optionsStr = optionsMatch[1].trim();
    if (optionsStr.toUpperCase() !== "N/A" && optionsStr !== "-" && optionsStr !== "None") {
      options = optionsStr.split(",").map((o) => o.trim()).filter(Boolean);
      if (options.length === 0) options = null;
    }
  }

  // Extract REASONING
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]+)$/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";

  return { type, options, reasoning };
}

/**
 * Parse a numeric estimate from model response.
 * Falls back to regex extraction of any number if ESTIMATE: line missing.
 */
export function parseNumericEstimate(text: string): {
  estimate: number | null;
  confidence: ConfidenceLevel;
  reasoning: string;
} {
  if (!text || !text.trim()) {
    return { estimate: null, confidence: "MEDIUM", reasoning: "" };
  }

  // Extract ESTIMATE
  let estimate: number | null = null;
  const estimateMatch = text.match(/ESTIMATE:\s*([\d,.\-+eE]+)/i);
  if (estimateMatch) {
    const cleaned = estimateMatch[1].replace(/,/g, "");
    const parsed = parseFloat(cleaned);
    if (!isNaN(parsed)) {
      estimate = parsed;
    }
  }

  // Fallback: find any number in the text
  if (estimate === null) {
    const numberMatch = text.match(/-?[\d,]+\.?\d*(?:[eE][+-]?\d+)?/);
    if (numberMatch) {
      const cleaned = numberMatch[0].replace(/,/g, "");
      const parsed = parseFloat(cleaned);
      if (!isNaN(parsed)) {
        estimate = parsed;
      }
    }
  }

  // Extract CONFIDENCE
  const confMatch = text.match(/CONFIDENCE:\s*(\w+)/i);
  const confidence = confMatch ? parseConfidence(confMatch[1]) : "MEDIUM";

  // Extract REASONING
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]+)$/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";

  return { estimate, confidence, reasoning };
}

/**
 * Parse a qualitative estimate from model response.
 */
export function parseQualitativeEstimate(text: string): {
  answer: string | null;
  confidence: ConfidenceLevel;
  reasoning: string;
} {
  if (!text || !text.trim()) {
    return { answer: null, confidence: "MEDIUM", reasoning: "" };
  }

  // Extract ANSWER
  let answer: string | null = null;
  const answerMatch = text.match(/ANSWER:\s*(.+)/i);
  if (answerMatch) {
    answer = answerMatch[1].trim();
    // Remove trailing CONFIDENCE/REASONING lines if captured
    answer = answer.split(/\n/)[0].trim();
    if (!answer) answer = null;
  }

  // Extract CONFIDENCE
  const confMatch = text.match(/CONFIDENCE:\s*(\w+)/i);
  const confidence = confMatch ? parseConfidence(confMatch[1]) : "MEDIUM";

  // Extract REASONING
  const reasoningMatch = text.match(/REASONING:\s*([\s\S]+)$/i);
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";

  return { answer, confidence, reasoning };
}

// ---------------------------------------------------------------------------
// Statistics Engine (server-side, no LLM calls)
// ---------------------------------------------------------------------------

/**
 * Count confidence levels across estimates.
 */
function countConfidence(estimates: DelphiEstimate[]): ConfidenceCounts {
  const counts: ConfidenceCounts = { low: 0, medium: 0, high: 0 };
  for (const e of estimates) {
    const conf = e.confidence;
    if (conf === "LOW") counts.low++;
    else if (conf === "HIGH") counts.high++;
    else counts.medium++;
  }
  return counts;
}

/**
 * Compute aggregate statistics for numeric estimates.
 */
export function computeNumericStats(estimates: DelphiNumericEstimate[]): NumericStats {
  const values = estimates.map((e) => e.estimate);
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sorted = [...values].sort((a, b) => a - b);
  const median =
    n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  const cv = mean !== 0 ? stdDev / Math.abs(mean) : 0;

  return {
    mean,
    median,
    stdDev,
    min: sorted[0],
    max: sorted[n - 1],
    cv,
    confidenceCounts: countConfidence(estimates),
  };
}

/**
 * Compute aggregate statistics for qualitative estimates.
 */
export function computeQualitativeStats(estimates: DelphiQualitativeEstimate[]): QualitativeStats {
  const n = estimates.length;
  const answerCounts = new Map<string, number>();

  for (const e of estimates) {
    const key = e.answer;
    answerCounts.set(key, (answerCounts.get(key) ?? 0) + 1);
  }

  const distribution: QualitativeDistributionEntry[] = [];
  let maxCount = 0;
  let modeAnswer = "";

  for (const [answer, count] of answerCounts) {
    const percentage = Math.round((count / n) * 100);
    distribution.push({ answer, count, percentage });
    if (count > maxCount) {
      maxCount = count;
      modeAnswer = answer;
    }
  }

  // Sort distribution by count descending
  distribution.sort((a, b) => b.count - a.count);

  const agreementPercentage = n > 0 ? Math.round((maxCount / n) * 100) : 0;

  return {
    distribution,
    agreementPercentage,
    mode: modeAnswer,
    confidenceCounts: countConfidence(estimates),
  };
}

/**
 * Check whether estimates have converged based on type and thresholds.
 */
export function hasConverged(
  stats: NumericStats | QualitativeStats,
  type: "numeric" | "qualitative",
  config: DelphiConfig
): boolean {
  if (type === "numeric") {
    return (stats as NumericStats).cv < config.numericConvergenceThreshold;
  }
  return (stats as QualitativeStats).agreementPercentage >= config.qualitativeConvergenceThreshold;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the facilitator's classification prompt.
 */
export function buildClassificationPrompt(userQuery: string): string {
  return `Classify the following question for a Delphi estimation exercise.

QUESTION:
${userQuery}

Determine:
1. Is this a NUMERIC question (expects a number, quantity, estimate, percentage, date, or measurable value)?
2. Or is this a QUALITATIVE question (expects a category, recommendation, choice, or opinion)?

If QUALITATIVE, suggest 3-6 answer options that cover the reasonable range of responses.

Format:
TYPE: [NUMERIC|QUALITATIVE]
OPTIONS: [comma-separated options, or "N/A" if NUMERIC]
REASONING: [one sentence explaining your classification]`;
}

/**
 * Build the Round 1 prompt for numeric questions.
 */
export function buildNumericRound1Prompt(userQuery: string): string {
  return `You are participating in a Delphi estimation exercise. You will provide your independent estimate for a question. In later rounds, you will see aggregate statistics from all participants (but never individual responses).

QUESTION:
${userQuery}

Provide:
1. Your numeric estimate
2. Your confidence level (LOW/MEDIUM/HIGH)
3. Your reasoning (2-4 sentences)

Format:
ESTIMATE: [number]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [your reasoning]`;
}

/**
 * Build the Round 1 prompt for qualitative questions.
 */
export function buildQualitativeRound1Prompt(
  userQuery: string,
  options: string[] | null
): string {
  let optionsText = "";
  if (options && options.length > 0) {
    optionsText =
      "\nChoose from these options:\n" +
      options.map((o, i) => `${i + 1}. ${o}`).join("\n") +
      "\n";
  }

  return `You are participating in a Delphi consensus exercise. You will provide your independent assessment. In later rounds, you will see aggregate results from all participants (but never individual responses).

QUESTION:
${userQuery}
${optionsText}
Provide:
1. Your answer/recommendation
2. Your confidence level (LOW/MEDIUM/HIGH)
3. Your reasoning (2-4 sentences)

Format:
ANSWER: [your answer or option number]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [your reasoning]`;
}

/**
 * Build the Round N (2+) prompt for numeric questions.
 * Each model sees its own previous estimate + aggregate stats.
 */
export function buildNumericRoundNPrompt(params: {
  userQuery: string;
  round: number;
  maxRounds: number;
  prevEstimate: number;
  prevConfidence: ConfidenceLevel;
  stats: NumericStats;
  participantCount: number;
}): string {
  const { userQuery, round, maxRounds, prevEstimate, prevConfidence, stats, participantCount } = params;

  return `DELPHI ROUND ${round} of ${maxRounds}

QUESTION: ${userQuery}

YOUR PREVIOUS ESTIMATE: ${prevEstimate}
YOUR PREVIOUS CONFIDENCE: ${prevConfidence}

AGGREGATE STATISTICS FROM ALL ${participantCount} PARTICIPANTS (Round ${round - 1}):
- Mean: ${stats.mean.toFixed(2)}
- Median: ${stats.median.toFixed(2)}
- Standard Deviation: ${stats.stdDev.toFixed(2)}
- Range: ${stats.min} — ${stats.max}
- Coefficient of Variation: ${stats.cv.toFixed(4)}
- Confidence Distribution: ${stats.confidenceCounts.low} LOW, ${stats.confidenceCounts.medium} MEDIUM, ${stats.confidenceCounts.high} HIGH

You may revise your estimate based on these aggregates, or maintain your position if you believe you are correct.

ESTIMATE: [number]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [why you revised or maintained — reference the aggregates]`;
}

/**
 * Build the Round N (2+) prompt for qualitative questions.
 * Each model sees its own previous answer + aggregate stats.
 */
export function buildQualitativeRoundNPrompt(params: {
  userQuery: string;
  round: number;
  maxRounds: number;
  prevAnswer: string;
  prevConfidence: ConfidenceLevel;
  stats: QualitativeStats;
  participantCount: number;
}): string {
  const { userQuery, round, maxRounds, prevAnswer, prevConfidence, stats, participantCount } = params;

  const distributionText = stats.distribution
    .map((d) => `  ${d.answer}: ${d.count} participants (${d.percentage}%)`)
    .join("\n");

  return `DELPHI ROUND ${round} of ${maxRounds}

QUESTION: ${userQuery}

YOUR PREVIOUS ANSWER: ${prevAnswer}
YOUR PREVIOUS CONFIDENCE: ${prevConfidence}

AGGREGATE RESULTS FROM ALL ${participantCount} PARTICIPANTS (Round ${round - 1}):
- Distribution:
${distributionText}
- Agreement Level: ${stats.agreementPercentage}%
- Confidence Distribution: ${stats.confidenceCounts.low} LOW, ${stats.confidenceCounts.medium} MEDIUM, ${stats.confidenceCounts.high} HIGH

You may revise your answer based on these aggregates, or maintain your position.

ANSWER: [your answer]
CONFIDENCE: [LOW|MEDIUM|HIGH]
REASONING: [why you revised or maintained — reference the distribution]`;
}

/**
 * Build the facilitator synthesis prompt.
 */
function buildSynthesisPrompt(params: {
  userQuery: string;
  classification: DelphiClassification;
  rounds: DelphiRound[];
  converged: boolean;
  finalValue: number | string;
  participantCount: number;
}): string {
  const { userQuery, classification, rounds, converged, finalValue, participantCount } = params;

  const isNumeric = classification.type === "numeric";
  const roundsText = rounds
    .map((r) => {
      if (isNumeric) {
        const s = r.stats as NumericStats;
        return `Round ${r.roundNumber}:
- Mean: ${s.mean.toFixed(2)}, Median: ${s.median.toFixed(2)}, StdDev: ${s.stdDev.toFixed(2)}, CV: ${s.cv.toFixed(4)}
- Range: ${s.min} — ${s.max}
- Confidence: ${s.confidenceCounts.low}L / ${s.confidenceCounts.medium}M / ${s.confidenceCounts.high}H`;
      } else {
        const s = r.stats as QualitativeStats;
        const distText = s.distribution.map((d) => `${d.answer}: ${d.percentage}%`).join(", ");
        return `Round ${r.roundNumber}:
- Distribution: ${distText}
- Agreement: ${s.agreementPercentage}%
- Confidence: ${s.confidenceCounts.low}L / ${s.confidenceCounts.medium}M / ${s.confidenceCounts.high}H`;
      }
    })
    .join("\n\n");

  const convergenceStatus = converged ? "Converged" : "Max rounds reached";
  const valueLabel = isNumeric ? "CONSENSUS VALUE" : "MAJORITY ANSWER";

  return `You are the facilitator for a Delphi exercise that ran ${rounds.length} rounds with ${participantCount} participants.

QUESTION: ${userQuery}

CONVERGENCE TRAJECTORY:
${roundsText}

CONVERGENCE STATUS: ${convergenceStatus}
FINAL ${valueLabel}: ${finalValue}

Produce a Delphi Report:

## Delphi Consensus Report

### Question
${userQuery}

### Final Consensus
[The consensus value/answer with confidence interval if numeric]

### Convergence Analysis
[How opinions shifted across rounds. Did they converge smoothly or oscillate? Which rounds saw the biggest shifts?]

### Confidence Trajectory
[How participant confidence changed across rounds]

### Outlier Analysis
[Were there persistent outliers who never converged? What might their reasoning have been?]

### Reliability Assessment
[How reliable is this consensus? Consider: convergence speed, final CV/agreement, confidence levels, participant count]`;
}

// ---------------------------------------------------------------------------
// Pipeline Helpers
// ---------------------------------------------------------------------------

/**
 * Get the final consensus value from the last round's stats.
 */
function getFinalValue(
  type: "numeric" | "qualitative",
  stats: NumericStats | QualitativeStats
): number | string {
  if (type === "numeric") {
    return (stats as NumericStats).median;
  }
  return (stats as QualitativeStats).mode;
}

/**
 * Format stats as a human-readable string for DB content column.
 */
function formatStatsContent(
  type: "numeric" | "qualitative",
  roundNumber: number,
  stats: NumericStats | QualitativeStats
): string {
  if (type === "numeric") {
    const s = stats as NumericStats;
    return `Round ${roundNumber} Statistics: Mean=${s.mean.toFixed(2)} Median=${s.median.toFixed(2)} StdDev=${s.stdDev.toFixed(2)} CV=${s.cv.toFixed(4)} Range=${s.min}—${s.max}`;
  }
  const s = stats as QualitativeStats;
  const distText = s.distribution.map((d) => `${d.answer} ${d.percentage}%`).join(", ");
  return `Round ${roundNumber} Statistics: ${distText}. Agreement: ${s.agreementPercentage}%.`;
}

// ---------------------------------------------------------------------------
// Full Pipeline (non-streaming, for testing)
// ---------------------------------------------------------------------------

/**
 * Run the full Delphi pipeline and return the result.
 */
export async function runFullDelphi(
  userQuery: string,
  config: DelphiConfig = DEFAULT_DELPHI_CONFIG
): Promise<DelphiResult> {
  // Step 0: Classify
  const classifyResult = await queryModel(
    config.facilitatorModel,
    buildClassificationPrompt(userQuery),
    config.timeoutMs
  );
  const classification = classifyResult
    ? parseClassification(classifyResult.content)
    : { type: "qualitative" as const, options: null, reasoning: "Classification failed, defaulting to qualitative." };

  const isNumeric = classification.type === "numeric";
  const rounds: DelphiRound[] = [];
  let converged = false;
  let convergenceRound: number | null = null;

  // Track active panelists (those that succeed in Round 1)
  let activePanelists = [...config.panelistModels];

  // Previous estimates per model (for rounds 2+)
  const previousEstimates = new Map<string, DelphiEstimate>();

  for (let roundNum = 1; roundNum <= config.maxRounds; roundNum++) {
    let estimates: DelphiEstimate[];

    if (roundNum === 1) {
      // Round 1: same prompt to all, use queryModelsParallel
      const prompt = isNumeric
        ? buildNumericRound1Prompt(userQuery)
        : buildQualitativeRound1Prompt(userQuery, classification.options);

      const results = await queryModelsParallel(activePanelists, prompt, config.timeoutMs);

      estimates = [];
      const successfulModels: string[] = [];

      for (const model of activePanelists) {
        const result = results.get(model);
        if (!result) continue;

        if (isNumeric) {
          const parsed = parseNumericEstimate(result.content);
          if (parsed.estimate === null) continue;
          estimates.push({
            model,
            estimate: parsed.estimate,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            previousEstimate: null,
            changed: false,
            responseTimeMs: result.responseTimeMs,
          } as DelphiNumericEstimate);
          successfulModels.push(model);
        } else {
          const parsed = parseQualitativeEstimate(result.content);
          if (!parsed.answer) continue;
          estimates.push({
            model,
            answer: parsed.answer,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            previousAnswer: null,
            changed: false,
            responseTimeMs: result.responseTimeMs,
          } as DelphiQualitativeEstimate);
          successfulModels.push(model);
        }
      }

      if (estimates.length < 3) {
        throw new Error(
          `Delphi mode requires at least 3 successful panelists in Round 1, got ${estimates.length}.`
        );
      }

      activePanelists = successfulModels;
    } else {
      // Rounds 2+: unique prompt per model with their own previous answer + aggregate stats
      const prevRoundStats = rounds[rounds.length - 1].stats;
      estimates = [];

      const queries = activePanelists.map(async (model) => {
        const prevEstimate = previousEstimates.get(model)!;
        let prompt: string;

        if (isNumeric) {
          const prev = prevEstimate as DelphiNumericEstimate;
          prompt = buildNumericRoundNPrompt({
            userQuery,
            round: roundNum,
            maxRounds: config.maxRounds,
            prevEstimate: prev.estimate,
            prevConfidence: prev.confidence,
            stats: prevRoundStats as NumericStats,
            participantCount: activePanelists.length,
          });
        } else {
          const prev = prevEstimate as DelphiQualitativeEstimate;
          prompt = buildQualitativeRoundNPrompt({
            userQuery,
            round: roundNum,
            maxRounds: config.maxRounds,
            prevAnswer: prev.answer,
            prevConfidence: prev.confidence,
            stats: prevRoundStats as QualitativeStats,
            participantCount: activePanelists.length,
          });
        }

        const result = await queryModel(model, prompt, config.timeoutMs);
        return { model, result };
      });

      const results = await Promise.allSettled(queries);

      for (const settled of results) {
        if (settled.status !== "fulfilled") continue;
        const { model, result } = settled.value;
        const prevEstimate = previousEstimates.get(model)!;

        if (!result) {
          // Model failed — carry forward previous answer
          estimates.push({ ...prevEstimate, changed: false, responseTimeMs: 0 });
          continue;
        }

        if (isNumeric) {
          const prev = prevEstimate as DelphiNumericEstimate;
          const parsed = parseNumericEstimate(result.content);
          if (parsed.estimate === null) {
            // Parse failed — carry forward
            estimates.push({ ...prev, changed: false, responseTimeMs: result.responseTimeMs });
          } else {
            estimates.push({
              model,
              estimate: parsed.estimate,
              confidence: parsed.confidence,
              reasoning: parsed.reasoning,
              previousEstimate: prev.estimate,
              changed: parsed.estimate !== prev.estimate,
              responseTimeMs: result.responseTimeMs,
            } as DelphiNumericEstimate);
          }
        } else {
          const prev = prevEstimate as DelphiQualitativeEstimate;
          const parsed = parseQualitativeEstimate(result.content);
          if (!parsed.answer) {
            estimates.push({ ...prev, changed: false, responseTimeMs: result.responseTimeMs });
          } else {
            estimates.push({
              model,
              answer: parsed.answer,
              confidence: parsed.confidence,
              reasoning: parsed.reasoning,
              previousAnswer: prev.answer,
              changed: parsed.answer !== prev.answer,
              responseTimeMs: result.responseTimeMs,
            } as DelphiQualitativeEstimate);
          }
        }
      }
    }

    // Update previous estimates
    for (const est of estimates) {
      previousEstimates.set(est.model, est);
    }

    // Compute stats
    const stats = isNumeric
      ? computeNumericStats(estimates as DelphiNumericEstimate[])
      : computeQualitativeStats(estimates as DelphiQualitativeEstimate[]);

    const roundConverged = hasConverged(stats, classification.type, config);

    rounds.push({
      roundNumber: roundNum,
      estimates,
      stats,
      converged: roundConverged,
    });

    if (roundConverged) {
      converged = true;
      convergenceRound = roundNum;
      break;
    }
  }

  // Final value from last round
  const lastStats = rounds[rounds.length - 1].stats;
  const finalValue = getFinalValue(classification.type, lastStats);

  // Synthesis
  const synthesisResult = await queryModel(
    config.facilitatorModel,
    buildSynthesisPrompt({
      userQuery,
      classification,
      rounds,
      converged,
      finalValue,
      participantCount: activePanelists.length,
    }),
    config.timeoutMs
  );

  if (!synthesisResult) {
    throw new Error("Facilitator synthesis failed.");
  }

  const report: DelphiReport = {
    facilitatorModel: config.facilitatorModel,
    report: synthesisResult.content,
    totalRounds: rounds.length,
    converged,
    finalValue,
    responseTimeMs: synthesisResult.responseTimeMs,
  };

  return {
    classification,
    rounds,
    converged,
    convergenceRound,
    finalValue,
    report,
  };
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Delphi pipeline, emitting SSE events via the controller.
 * Returns stage data for persistence to deliberation_stages.
 */
export async function handleDelphiStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: DelphiConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // --- Step 0: Classify ---
  const classifyResult = await queryModel(
    config.facilitatorModel,
    buildClassificationPrompt(question),
    config.timeoutMs
  );
  const classification = classifyResult
    ? parseClassification(classifyResult.content)
    : { type: "qualitative" as const, options: null, reasoning: "Classification failed, defaulting to qualitative." };

  // Emit start with classification info
  emit({
    type: "delphi_start",
    data: { conversationId, messageId, mode: "delphi", questionType: classification.type },
  });

  emit({ type: "classify_complete", data: classification });

  // Save classification stage
  stages.push({
    stageType: "classify",
    stageOrder: 0,
    model: config.facilitatorModel,
    role: "facilitator",
    content: classifyResult?.content ?? "Classification failed",
    parsedData: classification,
    responseTimeMs: classifyResult?.responseTimeMs ?? null,
  });

  const isNumeric = classification.type === "numeric";
  const rounds: DelphiRound[] = [];
  let converged = false;
  let activePanelists = [...config.panelistModels];
  const previousEstimates = new Map<string, DelphiEstimate>();

  for (let roundNum = 1; roundNum <= config.maxRounds; roundNum++) {
    emit({ type: "round_start", data: { round: roundNum } });

    let estimates: DelphiEstimate[];
    const stageOrder = (roundNum - 1) * 2 + 1;

    if (roundNum === 1) {
      const prompt = isNumeric
        ? buildNumericRound1Prompt(question)
        : buildQualitativeRound1Prompt(question, classification.options);

      const results = await queryModelsParallel(activePanelists, prompt, config.timeoutMs);

      estimates = [];
      const successfulModels: string[] = [];

      for (const model of activePanelists) {
        const result = results.get(model);
        if (!result) continue;

        if (isNumeric) {
          const parsed = parseNumericEstimate(result.content);
          if (parsed.estimate === null) continue;
          const est: DelphiNumericEstimate = {
            model,
            estimate: parsed.estimate,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            previousEstimate: null,
            changed: false,
            responseTimeMs: result.responseTimeMs,
          };
          estimates.push(est);
          successfulModels.push(model);

          // Save estimate stage
          stages.push({
            stageType: `round_${roundNum}`,
            stageOrder,
            model,
            role: "panelist",
            content: result.content,
            parsedData: {
              round: roundNum,
              type: "numeric",
              estimate: parsed.estimate,
              confidence: parsed.confidence,
              previousEstimate: null,
              changed: false,
              reasoning: parsed.reasoning,
            },
            responseTimeMs: result.responseTimeMs,
          });
        } else {
          const parsed = parseQualitativeEstimate(result.content);
          if (!parsed.answer) continue;
          const est: DelphiQualitativeEstimate = {
            model,
            answer: parsed.answer,
            confidence: parsed.confidence,
            reasoning: parsed.reasoning,
            previousAnswer: null,
            changed: false,
            responseTimeMs: result.responseTimeMs,
          };
          estimates.push(est);
          successfulModels.push(model);

          stages.push({
            stageType: `round_${roundNum}`,
            stageOrder,
            model,
            role: "panelist",
            content: result.content,
            parsedData: {
              round: roundNum,
              type: "qualitative",
              answer: parsed.answer,
              confidence: parsed.confidence,
              previousAnswer: null,
              changed: false,
              reasoning: parsed.reasoning,
            },
            responseTimeMs: result.responseTimeMs,
          });
        }
      }

      if (estimates.length < 3) {
        emit({
          type: "error",
          message: `Delphi mode requires at least 3 successful panelists in Round 1, got ${estimates.length}.`,
        });
        return stages;
      }

      activePanelists = successfulModels;
    } else {
      // Rounds 2+: unique prompt per model
      const prevRoundStats = rounds[rounds.length - 1].stats;
      estimates = [];

      const queries = activePanelists.map(async (model) => {
        const prevEstimate = previousEstimates.get(model)!;
        let prompt: string;

        if (isNumeric) {
          const prev = prevEstimate as DelphiNumericEstimate;
          prompt = buildNumericRoundNPrompt({
            userQuery: question,
            round: roundNum,
            maxRounds: config.maxRounds,
            prevEstimate: prev.estimate,
            prevConfidence: prev.confidence,
            stats: prevRoundStats as NumericStats,
            participantCount: activePanelists.length,
          });
        } else {
          const prev = prevEstimate as DelphiQualitativeEstimate;
          prompt = buildQualitativeRoundNPrompt({
            userQuery: question,
            round: roundNum,
            maxRounds: config.maxRounds,
            prevAnswer: prev.answer,
            prevConfidence: prev.confidence,
            stats: prevRoundStats as QualitativeStats,
            participantCount: activePanelists.length,
          });
        }

        const result = await queryModel(model, prompt, config.timeoutMs);
        return { model, result };
      });

      const results = await Promise.allSettled(queries);

      for (const settled of results) {
        if (settled.status !== "fulfilled") continue;
        const { model, result } = settled.value;
        const prevEstimate = previousEstimates.get(model)!;

        if (!result) {
          // Model failed — carry forward
          estimates.push({ ...prevEstimate, changed: false, responseTimeMs: 0 });

          if (isNumeric) {
            const prev = prevEstimate as DelphiNumericEstimate;
            stages.push({
              stageType: `round_${roundNum}`,
              stageOrder,
              model,
              role: "panelist",
              content: "(model failed — carried forward from previous round)",
              parsedData: {
                round: roundNum,
                type: "numeric",
                estimate: prev.estimate,
                confidence: prev.confidence,
                previousEstimate: prev.estimate,
                changed: false,
                reasoning: "",
                carriedForward: true,
              },
              responseTimeMs: 0,
            });
          } else {
            const prev = prevEstimate as DelphiQualitativeEstimate;
            stages.push({
              stageType: `round_${roundNum}`,
              stageOrder,
              model,
              role: "panelist",
              content: "(model failed — carried forward from previous round)",
              parsedData: {
                round: roundNum,
                type: "qualitative",
                answer: prev.answer,
                confidence: prev.confidence,
                previousAnswer: prev.answer,
                changed: false,
                reasoning: "",
                carriedForward: true,
              },
              responseTimeMs: 0,
            });
          }
          continue;
        }

        if (isNumeric) {
          const prev = prevEstimate as DelphiNumericEstimate;
          const parsed = parseNumericEstimate(result.content);
          if (parsed.estimate === null) {
            estimates.push({ ...prev, changed: false, responseTimeMs: result.responseTimeMs });
            stages.push({
              stageType: `round_${roundNum}`,
              stageOrder,
              model,
              role: "panelist",
              content: result.content,
              parsedData: {
                round: roundNum,
                type: "numeric",
                estimate: prev.estimate,
                confidence: prev.confidence,
                previousEstimate: prev.estimate,
                changed: false,
                reasoning: "",
                parseFailed: true,
              },
              responseTimeMs: result.responseTimeMs,
            });
          } else {
            const changed = parsed.estimate !== prev.estimate;
            estimates.push({
              model,
              estimate: parsed.estimate,
              confidence: parsed.confidence,
              reasoning: parsed.reasoning,
              previousEstimate: prev.estimate,
              changed,
              responseTimeMs: result.responseTimeMs,
            } as DelphiNumericEstimate);

            stages.push({
              stageType: `round_${roundNum}`,
              stageOrder,
              model,
              role: "panelist",
              content: result.content,
              parsedData: {
                round: roundNum,
                type: "numeric",
                estimate: parsed.estimate,
                confidence: parsed.confidence,
                previousEstimate: prev.estimate,
                changed,
                reasoning: parsed.reasoning,
              },
              responseTimeMs: result.responseTimeMs,
            });
          }
        } else {
          const prev = prevEstimate as DelphiQualitativeEstimate;
          const parsed = parseQualitativeEstimate(result.content);
          if (!parsed.answer) {
            estimates.push({ ...prev, changed: false, responseTimeMs: result.responseTimeMs });
            stages.push({
              stageType: `round_${roundNum}`,
              stageOrder,
              model,
              role: "panelist",
              content: result.content,
              parsedData: {
                round: roundNum,
                type: "qualitative",
                answer: prev.answer,
                confidence: prev.confidence,
                previousAnswer: prev.answer,
                changed: false,
                reasoning: "",
                parseFailed: true,
              },
              responseTimeMs: result.responseTimeMs,
            });
          } else {
            const changed = parsed.answer !== prev.answer;
            estimates.push({
              model,
              answer: parsed.answer,
              confidence: parsed.confidence,
              reasoning: parsed.reasoning,
              previousAnswer: prev.answer,
              changed,
              responseTimeMs: result.responseTimeMs,
            } as DelphiQualitativeEstimate);

            stages.push({
              stageType: `round_${roundNum}`,
              stageOrder,
              model,
              role: "panelist",
              content: result.content,
              parsedData: {
                round: roundNum,
                type: "qualitative",
                answer: parsed.answer,
                confidence: parsed.confidence,
                previousAnswer: prev.answer,
                changed,
                reasoning: parsed.reasoning,
              },
              responseTimeMs: result.responseTimeMs,
            });
          }
        }
      }
    }

    // Update previous estimates
    for (const est of estimates) {
      previousEstimates.set(est.model, est);
    }

    // Compute stats
    const stats = isNumeric
      ? computeNumericStats(estimates as DelphiNumericEstimate[])
      : computeQualitativeStats(estimates as DelphiQualitativeEstimate[]);

    const roundConverged = hasConverged(stats, classification.type, config);

    const round: DelphiRound = {
      roundNumber: roundNum,
      estimates,
      stats,
      converged: roundConverged,
    };
    rounds.push(round);

    // Save stats stage
    const statsStageOrder = (roundNum - 1) * 2 + 2;
    stages.push({
      stageType: `round_${roundNum}_stats`,
      stageOrder: statsStageOrder,
      model: null,
      role: "stats",
      content: formatStatsContent(classification.type, roundNum, stats),
      parsedData: {
        round: roundNum,
        type: "stats",
        ...(isNumeric
          ? {
              mean: (stats as NumericStats).mean,
              median: (stats as NumericStats).median,
              stdDev: (stats as NumericStats).stdDev,
              cv: (stats as NumericStats).cv,
              min: (stats as NumericStats).min,
              max: (stats as NumericStats).max,
            }
          : {
              distribution: (stats as QualitativeStats).distribution,
              agreementPercentage: (stats as QualitativeStats).agreementPercentage,
              mode: (stats as QualitativeStats).mode,
            }),
        converged: roundConverged,
        confidenceCounts: isNumeric
          ? (stats as NumericStats).confidenceCounts
          : (stats as QualitativeStats).confidenceCounts,
      },
      responseTimeMs: null,
    });

    // Build anonymized estimate summaries for the client (participant indices, no model names)
    const estimateSummaries = estimates.map((est, i) => {
      if (isNumeric) {
        const ne = est as DelphiNumericEstimate;
        return {
          participantIndex: i + 1,
          estimate: ne.estimate,
          confidence: ne.confidence,
          changed: ne.changed,
        };
      } else {
        const qe = est as DelphiQualitativeEstimate;
        return {
          participantIndex: i + 1,
          answer: qe.answer,
          confidence: qe.confidence,
          changed: qe.changed,
        };
      }
    });

    emit({
      type: "round_complete",
      data: {
        round: roundNum,
        estimates: estimateSummaries,
        stats,
        converged: roundConverged,
      },
    });

    if (roundConverged) {
      converged = true;
      emit({ type: "convergence_reached", data: { round: roundNum, stats } });
      break;
    }
  }

  if (!converged) {
    const lastRound = rounds[rounds.length - 1];
    emit({ type: "max_rounds_reached", data: { round: lastRound.roundNumber, stats: lastRound.stats } });
  }

  // --- Synthesis ---
  const lastStats = rounds[rounds.length - 1].stats;
  const finalValue = getFinalValue(classification.type, lastStats);

  emit({ type: "synthesis_start" });

  const synthesisResult = await queryModel(
    config.facilitatorModel,
    buildSynthesisPrompt({
      userQuery: question,
      classification,
      rounds,
      converged,
      finalValue,
      participantCount: activePanelists.length,
    }),
    config.timeoutMs
  );

  if (!synthesisResult) {
    emit({ type: "error", message: "Facilitator synthesis failed." });
    return stages;
  }

  const report: DelphiReport = {
    facilitatorModel: config.facilitatorModel,
    report: synthesisResult.content,
    totalRounds: rounds.length,
    converged,
    finalValue,
    responseTimeMs: synthesisResult.responseTimeMs,
  };

  emit({ type: "synthesis_complete", data: report });

  // Save synthesis stage
  stages.push({
    stageType: "synthesis",
    stageOrder: 99,
    model: config.facilitatorModel,
    role: "facilitator",
    content: synthesisResult.content,
    parsedData: {
      totalRounds: rounds.length,
      converged,
      convergenceRound: converged ? rounds.findIndex((r) => r.converged) + 1 : null,
      finalValue,
    },
    responseTimeMs: synthesisResult.responseTimeMs,
  });

  return stages;
}
