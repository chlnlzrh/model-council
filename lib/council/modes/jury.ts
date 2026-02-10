/**
 * Jury Mode — Multi-dimensional evaluation of existing content.
 *
 * 3-6 juror models independently score content on 5 dimensions (1-10 each),
 * deliver APPROVE/REVISE/REJECT verdicts, and a foreman model synthesizes
 * all assessments into a formal verdict report.
 *
 * See docs/modes/03-jury.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JuryConfig {
  jurorModels: string[];
  foremanModel: string;
  timeoutMs: number;
}

export const DEFAULT_JURY_CONFIG: JuryConfig = {
  jurorModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  foremanModel: "perplexity/sonar-pro",
  timeoutMs: 120_000,
};

export type Verdict = "APPROVE" | "REVISE" | "REJECT";

export interface DimensionScores {
  accuracy: number | null;
  completeness: number | null;
  clarity: number | null;
  relevance: number | null;
  actionability: number | null;
}

export interface DimensionRanges {
  accuracy: { min: number; max: number };
  completeness: { min: number; max: number };
  clarity: { min: number; max: number };
  relevance: { min: number; max: number };
  actionability: { min: number; max: number };
}

export interface JurorAssessment {
  model: string;
  assessmentText: string;
  scores: DimensionScores;
  average: number | null;
  verdict: Verdict | null;
  recommendations: string[];
  responseTimeMs: number;
  parseSuccess: boolean;
}

export interface JurorSummary {
  jurorCount: number;
  successfulJurors: number;
  majorityVerdict: Verdict;
  voteTally: {
    approve: number;
    revise: number;
    reject: number;
  };
  dimensionAverages: DimensionScores;
  dimensionRanges: DimensionRanges;
}

export interface DimensionAnalysisRow {
  dimension: string;
  avgScore: number;
  minScore: number;
  maxScore: number;
  consensus: string;
}

export interface ForemanReport {
  model: string;
  reportText: string;
  finalVerdict: Verdict;
  dimensionAnalysis: DimensionAnalysisRow[];
  keyStrengths: string[];
  keyWeaknesses: string[];
  recommendations: string[];
  dissentingOpinions: string[];
  responseTimeMs: number;
}

export interface JuryResult {
  presentation: {
    content: string;
    originalQuestion?: string;
  };
  jurors: JurorAssessment[];
  jurorSummary: JurorSummary;
  foreman: ForemanReport;
  majorityVerdict: Verdict;
  voteTally: {
    approve: number;
    revise: number;
    reject: number;
  };
  dimensionAverages: DimensionScores;
  title?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIMENSIONS = [
  "accuracy",
  "completeness",
  "clarity",
  "relevance",
  "actionability",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse dimension scores from juror assessment text.
 * Primary: table format `| Dimension | Score |`
 * Fallback: inline format `Dimension: 8` or `Dimension — 8`
 */
export function parseScores(text: string): DimensionScores {
  const scores: DimensionScores = {
    accuracy: null,
    completeness: null,
    clarity: null,
    relevance: null,
    actionability: null,
  };

  for (const dim of DIMENSIONS) {
    // Primary: table format  | Dimension | Score |
    const tableRegex = new RegExp(
      `\\|\\s*${dim}\\s*\\|\\s*(\\d+)\\s*\\|`,
      "i"
    );
    const tableMatch = text.match(tableRegex);
    if (tableMatch) {
      const score = parseInt(tableMatch[1], 10);
      if (score >= 1 && score <= 10) {
        scores[dim] = score;
        continue;
      }
    }

    // Fallback: "Accuracy: 8" or "Accuracy — 8" or "**Accuracy**: 8/10"
    const inlineRegex = new RegExp(
      `${dim}\\*?\\*?[:\\s—-]+\\*?\\*?(\\d+)(?:\\/10)?`,
      "i"
    );
    const inlineMatch = text.match(inlineRegex);
    if (inlineMatch) {
      const score = parseInt(inlineMatch[1], 10);
      if (score >= 1 && score <= 10) {
        scores[dim] = score;
      }
    }
  }

  return scores;
}

/**
 * Parse verdict from juror assessment text.
 * Primary: `VERDICT: APPROVE`
 * Fallback: keyword search in last 500 chars
 */
export function parseVerdict(text: string): Verdict | null {
  // Primary: "VERDICT: APPROVE"
  const verdictMatch = text.match(/VERDICT:\s*(APPROVE|REVISE|REJECT)/i);
  if (verdictMatch) {
    return verdictMatch[1].toUpperCase() as Verdict;
  }

  // Fallback: look for standalone verdict keywords near end of text
  const lastParagraph = text.slice(-500);
  if (/\bAPPROVE\b/i.test(lastParagraph)) return "APPROVE";
  if (/\bREJECT\b/i.test(lastParagraph)) return "REJECT";
  if (/\bREVISE\b/i.test(lastParagraph)) return "REVISE";

  return null;
}

/**
 * Parse recommendations from juror text (numbered list under ### Recommendations).
 */
function parseRecommendations(text: string): string[] {
  const recsMatch = text.match(
    /### Recommendations\s*\n([\s\S]*?)(?=###|$)/i
  );
  const recommendations: string[] = [];
  if (recsMatch) {
    const lines = recsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim();
      if (cleaned) recommendations.push(cleaned);
    }
  }
  return recommendations;
}

/**
 * Calculate average of non-null dimension scores, rounded to 1 decimal.
 */
export function calculateAverage(scores: DimensionScores): number | null {
  const values = Object.values(scores).filter(
    (v): v is number => v !== null
  );
  if (values.length === 0) return null;
  return (
    Math.round(
      (values.reduce((a, b) => a + b, 0) / values.length) * 10
    ) / 10
  );
}

/**
 * Calculate majority verdict from array of verdicts.
 * Tie-breaking: APPROVE/REJECT tie → REVISE, three-way → REVISE (conservative).
 */
export function calculateMajorityVerdict(
  verdicts: Array<Verdict | null>
): {
  verdict: Verdict;
  approveCount: number;
  reviseCount: number;
  rejectCount: number;
} {
  const validVerdicts = verdicts.filter(
    (v): v is Verdict => v !== null
  );
  const counts = {
    APPROVE: validVerdicts.filter((v) => v === "APPROVE").length,
    REVISE: validVerdicts.filter((v) => v === "REVISE").length,
    REJECT: validVerdicts.filter((v) => v === "REJECT").length,
  };

  const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);

  // Three-way tie or all zeros → REVISE
  if (
    sorted[0][1] === sorted[1][1] &&
    sorted[1][1] === sorted[2][1]
  ) {
    return {
      verdict: "REVISE",
      approveCount: counts.APPROVE,
      reviseCount: counts.REVISE,
      rejectCount: counts.REJECT,
    };
  }

  // Two-way tie at the top
  if (sorted[0][1] === sorted[1][1]) {
    const tiedVerdicts = [sorted[0][0], sorted[1][0]];

    // If REVISE is one of the tied, REVISE wins
    if (tiedVerdicts.includes("REVISE")) {
      return {
        verdict: "REVISE",
        approveCount: counts.APPROVE,
        reviseCount: counts.REVISE,
        rejectCount: counts.REJECT,
      };
    }

    // APPROVE/REJECT tie → REVISE (conservative)
    return {
      verdict: "REVISE",
      approveCount: counts.APPROVE,
      reviseCount: counts.REVISE,
      rejectCount: counts.REJECT,
    };
  }

  return {
    verdict: sorted[0][0] as Verdict,
    approveCount: counts.APPROVE,
    reviseCount: counts.REVISE,
    rejectCount: counts.REJECT,
  };
}

/**
 * Calculate average scores across all jurors per dimension.
 */
export function calculateDimensionAverages(
  assessments: JurorAssessment[]
): DimensionScores {
  const result: DimensionScores = {
    accuracy: null,
    completeness: null,
    clarity: null,
    relevance: null,
    actionability: null,
  };

  for (const dim of DIMENSIONS) {
    const values = assessments
      .filter((a) => a.parseSuccess && a.scores[dim] !== null)
      .map((a) => a.scores[dim] as number);
    if (values.length > 0) {
      result[dim] =
        Math.round(
          (values.reduce((a, b) => a + b, 0) / values.length) * 10
        ) / 10;
    }
  }

  return result;
}

/**
 * Calculate min/max range per dimension across all jurors.
 */
export function calculateDimensionRanges(
  assessments: JurorAssessment[]
): DimensionRanges {
  const result = {} as DimensionRanges;

  for (const dim of DIMENSIONS) {
    const values = assessments
      .filter((a) => a.parseSuccess && a.scores[dim] !== null)
      .map((a) => a.scores[dim] as number);
    if (values.length > 0) {
      result[dim] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    } else {
      result[dim] = { min: 0, max: 0 };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build evaluation prompt for a juror.
 */
export function buildJurorPrompt(
  content: string,
  originalQuestion?: string
): string {
  let prompt =
    "You are a juror evaluating the quality of a response. Score it on 5 dimensions (1-10 each) and deliver a verdict.\n\n";

  if (originalQuestion) {
    prompt += `ORIGINAL QUESTION:\n${originalQuestion}\n\n`;
  }

  prompt += `CONTENT UNDER EVALUATION:\n${content}\n\n`;

  prompt += `Score each dimension from 1 (terrible) to 10 (exceptional):

1. **Accuracy** — Are the facts, claims, and technical details correct?
2. **Completeness** — Does it cover all important aspects of the topic?
3. **Clarity** — Is it well-organized, easy to follow, and unambiguous?
4. **Relevance** — Does it directly address the question/task at hand?
5. **Actionability** — Does it provide concrete, usable guidance?

For each dimension, provide:
- A score (1-10)
- 1-2 sentences of justification

Then deliver your verdict based on your average score:
- APPROVE (average >= 7): The content is good enough for use
- REVISE (average 4-6.9): The content needs improvement before use
- REJECT (average < 4): The content is fundamentally flawed

Format your response as:

## Juror Assessment

### Scores

| Dimension | Score | Justification |
|-----------|:-----:|---------------|
| Accuracy | [1-10] | [justification] |
| Completeness | [1-10] | [justification] |
| Clarity | [1-10] | [justification] |
| Relevance | [1-10] | [justification] |
| Actionability | [1-10] | [justification] |
| **Average** | [avg] | |

### Deliberation Notes
[2-3 paragraphs explaining your overall assessment, key strengths, and key weaknesses]

### Verdict
VERDICT: [APPROVE|REVISE|REJECT]

### Recommendations
[If REVISE or REJECT: numbered list of specific improvements needed]`;

  return prompt;
}

/**
 * Build synthesis prompt for the foreman.
 */
export function buildForemanPrompt(
  content: string,
  originalQuestion: string | undefined,
  jurorAssessments: Array<{ model: string; assessmentText: string }>,
  voteTally: { approve: number; revise: number; reject: number },
  majorityVerdict: Verdict
): string {
  let prompt =
    "You are the foreman of a jury that has evaluated the following content. Synthesize all juror assessments into a final verdict report.\n\n";

  prompt += `CONTENT EVALUATED:\n${content}\n\n`;

  if (originalQuestion) {
    prompt += `ORIGINAL QUESTION:\n${originalQuestion}\n\n`;
  }

  prompt += "JUROR ASSESSMENTS:\n";
  jurorAssessments.forEach((juror, i) => {
    prompt += `--- Juror ${i + 1} (${juror.model}) ---\n${juror.assessmentText}\n\n`;
  });

  prompt += `VOTE TALLY:
- APPROVE: ${voteTally.approve}
- REVISE: ${voteTally.revise}
- REJECT: ${voteTally.reject}
- Majority Verdict: ${majorityVerdict}

Produce a formal verdict report:

## Jury Verdict Report

### Final Verdict: [APPROVE|REVISE|REJECT]
[1-2 sentence summary explaining the jury's decision]

### Dimension Analysis

| Dimension | Avg Score | Min | Max | Consensus |
|-----------|:---------:|:---:|:---:|-----------|
| Accuracy | [avg] | [min] | [max] | [agreement note] |
| Completeness | [avg] | [min] | [max] | [agreement note] |
| Clarity | [avg] | [min] | [max] | [agreement note] |
| Relevance | [avg] | [min] | [max] | [agreement note] |
| Actionability | [avg] | [min] | [max] | [agreement note] |
| **Overall** | [avg] | [min] | [max] | |

### Key Strengths (Consensus)
[Strengths identified by 2+ jurors — bulleted list]

### Key Weaknesses (Consensus)
[Weaknesses identified by 2+ jurors — bulleted list]

### Improvement Recommendations
[Prioritized numbered list — only include if verdict is REVISE or REJECT]

### Dissenting Opinions
[If any juror's verdict differed from the majority, summarize their reasoning here. If unanimous, state "The jury was unanimous."]`;

  return prompt;
}

/**
 * Build title prompt for the jury evaluation session.
 */
export function buildJuryTitlePrompt(contentPreview: string): string {
  return `Generate a brief title (3-5 words) for a jury evaluation session about this content:

"${contentPreview}"

Reply with ONLY the title. No quotes, no punctuation, no explanation.`;
}

// ---------------------------------------------------------------------------
// Pipeline — Non-streaming
// ---------------------------------------------------------------------------

/**
 * Run the full Jury pipeline (non-streaming, for tests).
 */
export async function runFullJury(
  content: string,
  config: JuryConfig = DEFAULT_JURY_CONFIG,
  originalQuestion?: string
): Promise<JuryResult> {
  // Stage 1: Present
  const presentation = { content, originalQuestion };

  // Stage 2: Parallel juror evaluation
  const jurorPrompt = buildJurorPrompt(content, originalQuestion);

  const jurorResults = await Promise.allSettled(
    config.jurorModels.map(async (model) => {
      const result = await queryModel(model, jurorPrompt, config.timeoutMs);
      if (!result || !result.content.trim()) {
        throw new Error("Model failed to respond");
      }

      const scores = parseScores(result.content);
      const average = calculateAverage(scores);
      const verdict = parseVerdict(result.content);
      const recommendations = parseRecommendations(result.content);
      const hasAnyScore = Object.values(scores).some((v) => v !== null);

      return {
        model,
        assessmentText: result.content,
        scores,
        average,
        verdict,
        recommendations,
        responseTimeMs: result.responseTimeMs,
        parseSuccess: hasAnyScore || verdict !== null,
      } satisfies JurorAssessment;
    })
  );

  const jurors: JurorAssessment[] = [];
  jurorResults.forEach((result, i) => {
    if (result.status === "fulfilled") {
      jurors.push(result.value);
    } else {
      // Failed juror — include with null data
      jurors.push({
        model: config.jurorModels[i],
        assessmentText: "",
        scores: {
          accuracy: null,
          completeness: null,
          clarity: null,
          relevance: null,
          actionability: null,
        },
        average: null,
        verdict: null,
        recommendations: [],
        responseTimeMs: 0,
        parseSuccess: false,
      });
    }
  });

  const successfulJurors = jurors.filter((j) => j.parseSuccess);
  if (successfulJurors.length < 2) {
    throw new Error(
      `Jury requires at least 2 successful juror evaluations, got ${successfulJurors.length}.`
    );
  }

  // Aggregate
  const verdicts = jurors.map((j) => j.verdict);
  const majorityResult = calculateMajorityVerdict(verdicts);
  const dimensionAverages = calculateDimensionAverages(jurors);
  const dimensionRanges = calculateDimensionRanges(jurors);

  const jurorSummary: JurorSummary = {
    jurorCount: jurors.length,
    successfulJurors: successfulJurors.length,
    majorityVerdict: majorityResult.verdict,
    voteTally: {
      approve: majorityResult.approveCount,
      revise: majorityResult.reviseCount,
      reject: majorityResult.rejectCount,
    },
    dimensionAverages,
    dimensionRanges,
  };

  // Stage 3: Foreman synthesis
  const foremanPrompt = buildForemanPrompt(
    content,
    originalQuestion,
    jurors
      .filter((j) => j.parseSuccess)
      .map((j) => ({ model: j.model, assessmentText: j.assessmentText })),
    jurorSummary.voteTally,
    majorityResult.verdict
  );

  const foremanResult = await queryModel(
    config.foremanModel,
    foremanPrompt,
    config.timeoutMs
  );

  if (!foremanResult || !foremanResult.content.trim()) {
    throw new Error("Foreman model failed to respond.");
  }

  const foremanVerdict =
    parseVerdict(foremanResult.content) ?? majorityResult.verdict;

  const foreman: ForemanReport = {
    model: config.foremanModel,
    reportText: foremanResult.content,
    finalVerdict: foremanVerdict,
    dimensionAnalysis: DIMENSIONS.map((dim) => {
      const avg = dimensionAverages[dim];
      const range = dimensionRanges[dim];
      const spread = range.max - range.min;
      let consensus: string;
      if (spread <= 1) consensus = "Strong agreement";
      else if (spread <= 3) consensus = "Mixed";
      else consensus = "Disagreement";

      return {
        dimension: dim.charAt(0).toUpperCase() + dim.slice(1),
        avgScore: avg ?? 0,
        minScore: range.min,
        maxScore: range.max,
        consensus,
      };
    }),
    keyStrengths: [],
    keyWeaknesses: [],
    recommendations: [],
    dissentingOpinions: [],
    responseTimeMs: foremanResult.responseTimeMs,
  };

  return {
    presentation,
    jurors,
    jurorSummary,
    foreman,
    majorityVerdict: majorityResult.verdict,
    voteTally: jurorSummary.voteTally,
    dimensionAverages,
  };
}

// ---------------------------------------------------------------------------
// SSE Handler
// ---------------------------------------------------------------------------

export async function handleJuryStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    content: string;
    originalQuestion?: string;
    conversationId: string;
    messageId: string;
    config: JuryConfig;
  }
): Promise<DeliberationStageData[]> {
  const { content, originalQuestion, conversationId, messageId, config } =
    params;
  const stages: DeliberationStageData[] = [];

  // --- jury_start ---
  emit({
    type: "jury_start",
    data: { conversationId, messageId, mode: "jury" },
  });

  // --- Stage 1: Present ---
  emit({ type: "present_start" });

  stages.push({
    stageType: "present",
    stageOrder: 1,
    model: null,
    role: null,
    content,
    parsedData: originalQuestion ? { originalQuestion } : {},
    responseTimeMs: null,
  });

  emit({
    type: "present_complete",
    data: { content, originalQuestion },
  });

  // --- Stage 2: Deliberation (parallel juror evaluation) ---
  emit({
    type: "deliberation_start",
    data: { totalJurors: config.jurorModels.length },
  });

  const jurorPrompt = buildJurorPrompt(content, originalQuestion);

  const jurors: JurorAssessment[] = [];
  const jurorResults = await Promise.allSettled(
    config.jurorModels.map(async (model) => {
      const result = await queryModel(model, jurorPrompt, config.timeoutMs);
      if (!result || !result.content.trim()) {
        throw new Error("Model failed to respond");
      }

      const scores = parseScores(result.content);
      const average = calculateAverage(scores);
      const verdict = parseVerdict(result.content);
      const recommendations = parseRecommendations(result.content);
      const hasAnyScore = Object.values(scores).some((v) => v !== null);

      const assessment: JurorAssessment = {
        model,
        assessmentText: result.content,
        scores,
        average,
        verdict,
        recommendations,
        responseTimeMs: result.responseTimeMs,
        parseSuccess: hasAnyScore || verdict !== null,
      };

      // Emit per-juror completion
      emit({
        type: "juror_complete",
        data: assessment,
      });

      return assessment;
    })
  );

  jurorResults.forEach((result, i) => {
    if (result.status === "fulfilled") {
      jurors.push(result.value);

      stages.push({
        stageType: "deliberation",
        stageOrder: 2,
        model: result.value.model,
        role: "juror",
        content: result.value.assessmentText,
        parsedData: {
          scores: result.value.scores,
          average: result.value.average,
          verdict: result.value.verdict,
          recommendations: result.value.recommendations,
          parseSuccess: result.value.parseSuccess,
        },
        responseTimeMs: result.value.responseTimeMs,
      });
    } else {
      // Failed juror — not added to jurors list (excluded from aggregation)
      const failedModel = config.jurorModels[i];
      stages.push({
        stageType: "deliberation",
        stageOrder: 2,
        model: failedModel,
        role: "juror",
        content: "",
        parsedData: {
          scores: {
            accuracy: null,
            completeness: null,
            clarity: null,
            relevance: null,
            actionability: null,
          },
          average: null,
          verdict: null,
          recommendations: [],
          parseSuccess: false,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error",
        },
        responseTimeMs: null,
      });
    }
  });

  if (jurors.length < 2) {
    emit({
      type: "error",
      message: `Jury requires at least 2 successful juror evaluations, got ${jurors.length}.`,
    });
    return stages;
  }

  // --- Aggregate scores & majority verdict ---
  const verdicts = jurors.map((j) => j.verdict);
  const majorityResult = calculateMajorityVerdict(verdicts);
  const dimensionAverages = calculateDimensionAverages(jurors);
  const dimensionRanges = calculateDimensionRanges(jurors);

  const jurorSummary: JurorSummary = {
    jurorCount: config.jurorModels.length,
    successfulJurors: jurors.length,
    majorityVerdict: majorityResult.verdict,
    voteTally: {
      approve: majorityResult.approveCount,
      revise: majorityResult.reviseCount,
      reject: majorityResult.rejectCount,
    },
    dimensionAverages,
    dimensionRanges,
  };

  emit({
    type: "all_jurors_complete",
    data: jurorSummary,
  });

  stages.push({
    stageType: "juror_summary",
    stageOrder: 3,
    model: null,
    role: null,
    content: JSON.stringify({
      majorityVerdict: majorityResult.verdict,
      voteTally: jurorSummary.voteTally,
    }),
    parsedData: jurorSummary,
    responseTimeMs: null,
  });

  // --- Stage 3: Foreman verdict ---
  emit({ type: "verdict_start" });

  const foremanPrompt = buildForemanPrompt(
    content,
    originalQuestion,
    jurors
      .filter((j) => j.parseSuccess)
      .map((j) => ({ model: j.model, assessmentText: j.assessmentText })),
    jurorSummary.voteTally,
    majorityResult.verdict
  );

  const foremanResult = await queryModel(
    config.foremanModel,
    foremanPrompt,
    config.timeoutMs
  );

  if (!foremanResult || !foremanResult.content.trim()) {
    emit({
      type: "error",
      message: "Foreman model failed to respond.",
    });
    return stages;
  }

  const foremanVerdict =
    parseVerdict(foremanResult.content) ?? majorityResult.verdict;

  const foreman: ForemanReport = {
    model: config.foremanModel,
    reportText: foremanResult.content,
    finalVerdict: foremanVerdict,
    dimensionAnalysis: DIMENSIONS.map((dim) => {
      const avg = dimensionAverages[dim];
      const range = dimensionRanges[dim];
      const spread = range.max - range.min;
      let consensus: string;
      if (spread <= 1) consensus = "Strong agreement";
      else if (spread <= 3) consensus = "Mixed";
      else consensus = "Disagreement";

      return {
        dimension: dim.charAt(0).toUpperCase() + dim.slice(1),
        avgScore: avg ?? 0,
        minScore: range.min,
        maxScore: range.max,
        consensus,
      };
    }),
    keyStrengths: [],
    keyWeaknesses: [],
    recommendations: [],
    dissentingOpinions: [],
    responseTimeMs: foremanResult.responseTimeMs,
  };

  emit({
    type: "verdict_complete",
    data: foreman,
  });

  stages.push({
    stageType: "verdict",
    stageOrder: 4,
    model: config.foremanModel,
    role: "foreman",
    content: foremanResult.content,
    parsedData: {
      finalVerdict: foreman.finalVerdict,
      dimensionAnalysis: foreman.dimensionAnalysis,
      keyStrengths: foreman.keyStrengths,
      keyWeaknesses: foreman.keyWeaknesses,
      recommendations: foreman.recommendations,
      dissentingOpinions: foreman.dissentingOpinions,
    },
    responseTimeMs: foremanResult.responseTimeMs,
  });

  // Note: title generation and "complete" event handled by the route dispatcher.
  return stages;
}
