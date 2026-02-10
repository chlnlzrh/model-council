/**
 * Confidence-Weighted Mode — Answer with Self-Assessed Confidence + Weighted Synthesis
 *
 * Models answer a question while self-assessing their confidence (0.0-1.0).
 * A softmax function normalizes those into weights, and a synthesis model
 * produces a weighted synthesis favoring higher-confidence responses.
 *
 * Supports multi-turn conversations.
 *
 * See docs/modes/12-confidence-weighted.md for full specification.
 */

import type {
  ConversationTurn,
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel, queryModelsParallelWithMessages } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfidenceConfig {
  models: string[];
  synthesisModel: string;
  temperature: number;
  timeoutMs: number;
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  models: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  synthesisModel: "anthropic/claude-opus-4-6",
  temperature: 1.0,
  timeoutMs: 120_000,
};

export interface ConfidenceAnswer {
  model: string;
  response: string;
  rawConfidence: number;
  confidenceReasoning: string;
  parsedSuccessfully: boolean;
  responseTimeMs: number;
}

export interface ConfidenceWeight {
  model: string;
  rawConfidence: number;
  normalizedWeight: number;
  weightPercent: number;
  isOutlier: boolean;
}

export interface WeightedSynthesis {
  model: string;
  response: string;
  calibrationNotes: string;
  responseTimeMs: number;
}

export interface ConfidenceWeightedResult {
  answers: ConfidenceAnswer[];
  weights: ConfidenceWeight[];
  temperature: number;
  synthesis: WeightedSynthesis;
  title?: string;
}

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Parse a model's response that includes RESPONSE:, CONFIDENCE:, and
 * CONFIDENCE_REASONING: sections.
 *
 * Handles formats: 0.82, .82, 82%, 82 (>1.0 && <=100 → divide by 100),
 * 1.0, 0. Clamps to [0,1]. Defaults to 0.5 on parse failure.
 */
export function parseConfidenceResponse(text: string): {
  response: string;
  confidence: number;
  confidenceReasoning: string;
  parsedSuccessfully: boolean;
} {
  if (!text || !text.trim()) {
    return {
      response: "",
      confidence: 0.5,
      confidenceReasoning: "",
      parsedSuccessfully: false,
    };
  }

  // Extract CONFIDENCE: value — supports 0.82, .82, 82%, 82, 1.0, 0
  const confMatch = text.match(/CONFIDENCE:\s*(\d+(?:\.\d+)?%?|\.?\d+)/i);
  let confidence = 0.5;
  let parsedSuccessfully = false;

  if (confMatch) {
    let raw = confMatch[1];
    const isPercentage = raw.endsWith("%");
    if (isPercentage) {
      raw = raw.slice(0, -1);
    }

    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      parsedSuccessfully = true;
      if (isPercentage) {
        confidence = parsed / 100;
      } else if (parsed > 1.0 && parsed <= 100) {
        confidence = parsed / 100;
      } else {
        confidence = parsed;
      }
    }
  }

  // Clamp to [0, 1]
  confidence = Math.max(0, Math.min(1, confidence));

  // Extract CONFIDENCE_REASONING: section
  const reasonMatch = text.match(/CONFIDENCE_REASONING:\s*([\s\S]+?)$/i);
  const confidenceReasoning = reasonMatch ? reasonMatch[1].trim() : "";

  // Extract RESPONSE: content (between RESPONSE: and CONFIDENCE:)
  const responseMatch = text.match(/RESPONSE:\s*([\s\S]+?)(?=\nCONFIDENCE:)/i);
  const response = responseMatch
    ? responseMatch[1].trim()
    : text.split(/CONFIDENCE:/i)[0].trim();

  return {
    response,
    confidence,
    confidenceReasoning,
    parsedSuccessfully,
  };
}

/**
 * Compute softmax weights from raw confidence scores.
 *
 * weight_i = exp(conf_i / temp) / Σ exp(conf_j / temp)
 *
 * Temperature < 0.001 → uniform weights.
 * Flags outliers: confidence > 0.95 or < 0.1.
 */
export function computeSoftmaxWeights(
  answers: Array<{ model: string; rawConfidence: number }>,
  temperature: number
): ConfidenceWeight[] {
  if (answers.length === 0) return [];

  // Guard: near-zero temperature → uniform weights
  if (temperature < 0.001) {
    const uniform = 1.0 / answers.length;
    return answers.map((a) => ({
      model: a.model,
      rawConfidence: a.rawConfidence,
      normalizedWeight: uniform,
      weightPercent: Math.round(uniform * 10000) / 100,
      isOutlier: a.rawConfidence > 0.95 || a.rawConfidence < 0.1,
    }));
  }

  // Softmax: weight_i = exp(conf_i / temp) / sum(exp(conf_j / temp))
  const exps = answers.map((a) => Math.exp(a.rawConfidence / temperature));
  const sumExp = exps.reduce((a, b) => a + b, 0);

  return answers.map((a, i) => ({
    model: a.model,
    rawConfidence: a.rawConfidence,
    normalizedWeight: exps[i] / sumExp,
    weightPercent: Math.round((exps[i] / sumExp) * 10000) / 100,
    isOutlier: a.rawConfidence > 0.95 || a.rawConfidence < 0.1,
  }));
}

/**
 * Build the prompt that asks a model to answer with a confidence self-assessment.
 */
export function buildAnswerConfidencePrompt(
  userQuery: string,
  history: ConversationTurn[] = []
): string {
  let historySection = "";
  if (history.length > 0) {
    const turns = history
      .map((t) => `${t.role}: ${t.content}`)
      .join("\n");
    historySection = `\nCONVERSATION CONTEXT:\n${turns}\n`;
  }

  return `Answer the following question. After your response, assess your confidence in your answer on a scale from 0.0 (no confidence, pure guess) to 1.0 (absolute certainty, verified fact).

QUESTION:
${userQuery}
${historySection}
Provide your response, then your confidence assessment:

RESPONSE:
[your detailed answer]

CONFIDENCE: [0.0-1.0]
CONFIDENCE_REASONING: [1-2 sentences explaining why you are this confident — what do you know for certain vs. what are you uncertain about?]`;
}

/**
 * Build the weighted synthesis prompt.
 * Responses are sorted by weight (highest first), with weight % and raw confidence.
 * Outliers are marked with a warning.
 */
export function buildWeightedSynthesisPrompt(
  userQuery: string,
  weightedResponses: Array<{
    model: string;
    response: string;
    weightPercent: number;
    rawConfidence: number;
    isOutlier: boolean;
  }>,
  history: ConversationTurn[] = []
): string {
  // Sort by weight (highest first)
  const sorted = [...weightedResponses].sort(
    (a, b) => b.weightPercent - a.weightPercent
  );

  let historySection = "";
  if (history.length > 0) {
    const turns = history
      .map((t) => `${t.role}: ${t.content}`)
      .join("\n");
    historySection = `\nCONVERSATION CONTEXT:\n${turns}\n`;
  }

  const responsesText = sorted
    .map((r) => {
      const outlierWarning = r.isOutlier
        ? "\n⚠️ OUTLIER CONFIDENCE — treat with appropriate skepticism"
        : "";
      return `--- ${r.model} (Weight: ${r.weightPercent}%, Confidence: ${r.rawConfidence}) ---${outlierWarning}\n${r.response}`;
    })
    .join("\n\n");

  const weightDistribution = sorted
    .map((r) => `- ${r.model}: ${r.weightPercent}% (raw confidence: ${r.rawConfidence})`)
    .join("\n");

  return `You are synthesizing multiple model responses, weighted by each model's self-assessed confidence.

QUESTION:
${userQuery}
${historySection}
RESPONSES (ordered by weight, highest first):

${responsesText}

WEIGHT DISTRIBUTION:
${weightDistribution}

Instructions:
1. Give proportionally MORE consideration to higher-weighted responses.
2. A response with 40% weight should influence roughly 2x as much as one with 20% weight.
3. However, do NOT blindly trust high-confidence responses — a model can be confidently wrong.
4. If high-confidence and low-confidence responses CONTRADICT each other, note the disagreement and reason about which is more likely correct.
5. Flag any responses where the confidence seems miscalibrated (overconfident or underconfident based on content quality).

SYNTHESIS:
[Your weighted synthesis]

CONFIDENCE CALIBRATION NOTES:
[Any observations about how well models calibrated their confidence]`;
}

/**
 * Parse the synthesis model's response into synthesis text and calibration notes.
 * Fallback: full text as synthesis, empty calibrationNotes.
 */
export function parseSynthesisResponse(text: string): {
  synthesis: string;
  calibrationNotes: string;
} {
  if (!text || !text.trim()) {
    return { synthesis: "", calibrationNotes: "" };
  }

  // Try to extract SYNTHESIS: and CONFIDENCE CALIBRATION NOTES: sections
  const synthesisMatch = text.match(
    /SYNTHESIS:\s*([\s\S]+?)(?=\nCONFIDENCE CALIBRATION NOTES:|$)/i
  );
  const calibrationMatch = text.match(
    /CONFIDENCE CALIBRATION NOTES:\s*([\s\S]+?)$/i
  );

  const synthesis = synthesisMatch ? synthesisMatch[1].trim() : text.trim();
  const calibrationNotes = calibrationMatch ? calibrationMatch[1].trim() : "";

  return { synthesis, calibrationNotes };
}

// ---------------------------------------------------------------------------
// Async Functions
// ---------------------------------------------------------------------------

/**
 * Stage 1: Collect answers with confidence from all models in parallel.
 * Supports multi-turn via history param (vote.ts pattern).
 */
export async function collectAnswersWithConfidence(
  userQuery: string,
  config: ConfidenceConfig,
  history: ConversationTurn[] = []
): Promise<ConfidenceAnswer[]> {
  const prompt = buildAnswerConfidencePrompt(userQuery, history);

  let results: Map<string, { content: string; responseTimeMs: number }>;

  if (history.length > 0) {
    const messages = [
      ...history.map((turn) => ({
        role: turn.role as "user" | "assistant",
        content: turn.content,
      })),
      { role: "user" as const, content: prompt },
    ];
    results = await queryModelsParallelWithMessages(
      config.models,
      messages,
      config.timeoutMs
    );
  } else {
    results = await queryModelsParallel(
      config.models,
      prompt,
      config.timeoutMs
    );
  }

  const answers: ConfidenceAnswer[] = [];
  for (const [model, result] of results.entries()) {
    const parsed = parseConfidenceResponse(result.content);
    answers.push({
      model,
      response: parsed.response,
      rawConfidence: parsed.confidence,
      confidenceReasoning: parsed.confidenceReasoning,
      parsedSuccessfully: parsed.parsedSuccessfully,
      responseTimeMs: result.responseTimeMs,
    });
  }

  return answers;
}

/**
 * Stage 3: Synthesize all answers weighted by confidence.
 * Single call to the synthesis model.
 */
export async function synthesizeWeighted(
  userQuery: string,
  answers: ConfidenceAnswer[],
  weights: ConfidenceWeight[],
  config: ConfidenceConfig,
  history: ConversationTurn[] = []
): Promise<WeightedSynthesis | null> {
  // Build weighted responses for the prompt
  const weightedResponses = answers.map((a) => {
    const weight = weights.find((w) => w.model === a.model);
    return {
      model: a.model,
      response: a.response,
      weightPercent: weight?.weightPercent ?? 0,
      rawConfidence: a.rawConfidence,
      isOutlier: weight?.isOutlier ?? false,
    };
  });

  const prompt = buildWeightedSynthesisPrompt(userQuery, weightedResponses, history);
  const result = await queryModel(config.synthesisModel, prompt, config.timeoutMs);

  if (!result || !result.content.trim()) {
    return null;
  }

  const parsed = parseSynthesisResponse(result.content);

  return {
    model: config.synthesisModel,
    response: parsed.synthesis,
    calibrationNotes: parsed.calibrationNotes,
    responseTimeMs: result.responseTimeMs,
  };
}

// ---------------------------------------------------------------------------
// SSE Stream Handler
// ---------------------------------------------------------------------------

/**
 * Run the Confidence-Weighted pipeline, emitting SSE events via the controller.
 * Returns DeliberationStageData[] for DB persistence.
 */
export async function handleConfidenceWeightedStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: ConfidenceConfig;
    history: ConversationTurn[];
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config, history } = params;
  const stages: DeliberationStageData[] = [];

  // 1. confidence_start
  emit({
    type: "confidence_start",
    data: {
      conversationId,
      messageId,
      config: {
        models: config.models,
        synthesisModel: config.synthesisModel,
        temperature: config.temperature,
      },
    },
  });

  // 2. answers_start
  emit({ type: "answers_start" });

  // Stage 1: Collect answers with confidence
  const answers = await collectAnswersWithConfidence(question, config, history);

  // Emit per-model answer_complete events
  answers.forEach((answer, index) => {
    emit({
      type: "answer_complete",
      data: {
        model: answer.model,
        response: answer.response,
        confidence: answer.rawConfidence,
        confidenceReasoning: answer.confidenceReasoning,
        parsedSuccessfully: answer.parsedSuccessfully,
        responseTimeMs: answer.responseTimeMs,
        index,
        totalModels: config.models.length,
      },
    });
  });

  // 4. all_answers_complete
  const failedCount = config.models.length - answers.length;
  emit({
    type: "all_answers_complete",
    data: {
      totalAnswers: answers.length,
      failedCount,
    },
  });

  // Push answer stages (stageOrder: 0)
  answers.forEach((answer, index) => {
    stages.push({
      stageType: `answer_${index}`,
      stageOrder: 0,
      model: answer.model,
      role: "respondent",
      content: `RESPONSE:\n${answer.response}\n\nCONFIDENCE: ${answer.rawConfidence}\nCONFIDENCE_REASONING: ${answer.confidenceReasoning}`,
      parsedData: {
        confidence: answer.rawConfidence,
        confidenceReasoning: answer.confidenceReasoning,
        parsedSuccessfully: answer.parsedSuccessfully,
        responsePreview: answer.response.slice(0, 200),
        ...(answer.parsedSuccessfully
          ? {}
          : { parseFailureNote: "No CONFIDENCE: line found in response. Defaulted to 0.5." }),
      },
      responseTimeMs: answer.responseTimeMs,
    });
  });

  // Validate: need at least 1 successful answer
  if (answers.length < 1) {
    emit({
      type: "error",
      message: "All models failed to respond. Cannot proceed with confidence-weighted synthesis.",
    });
    return stages;
  }

  // Single model edge case: skip synthesis, output directly
  if (answers.length === 1) {
    const singleAnswer = answers[0];
    const singleWeights: ConfidenceWeight[] = [{
      model: singleAnswer.model,
      rawConfidence: singleAnswer.rawConfidence,
      normalizedWeight: 1.0,
      weightPercent: 100,
      isOutlier: singleAnswer.rawConfidence > 0.95 || singleAnswer.rawConfidence < 0.1,
    }];

    emit({
      type: "weights_calculated",
      data: {
        weights: singleWeights,
        temperature: config.temperature,
        outlierCount: singleWeights.filter((w) => w.isOutlier).length,
      },
    });

    // Push weights stage
    stages.push({
      stageType: "weights",
      stageOrder: 1,
      model: null,
      role: null,
      content: `Weight Distribution (temperature=${config.temperature}): ${singleAnswer.model}: 100.00% (conf ${singleAnswer.rawConfidence}). Outliers: ${singleWeights[0].isOutlier ? 1 : 0}.`,
      parsedData: {
        type: "weights",
        temperature: config.temperature,
        weights: singleWeights,
        outlierCount: singleWeights.filter((w) => w.isOutlier).length,
      },
      responseTimeMs: null,
    });

    emit({ type: "synthesis_start" });
    emit({
      type: "synthesis_complete",
      data: {
        model: singleAnswer.model,
        response: singleAnswer.response,
        calibrationNotes: "Only one model responded. No cross-model calibration possible.",
        responseTimeMs: 0,
      },
    });

    // Push synthesis stage with the single model's response
    stages.push({
      stageType: "synthesis",
      stageOrder: 2,
      model: singleAnswer.model,
      role: "synthesizer",
      content: singleAnswer.response,
      parsedData: {
        synthesisPreview: singleAnswer.response.slice(0, 200),
        calibrationNotes: "Only one model responded. No cross-model calibration possible.",
        totalModels: 1,
        highestWeight: { model: singleAnswer.model, weightPercent: 100 },
        lowestWeight: { model: singleAnswer.model, weightPercent: 100 },
      },
      responseTimeMs: 0,
    });

    return stages;
  }

  // 5. Compute softmax weights
  const weights = computeSoftmaxWeights(
    answers.map((a) => ({ model: a.model, rawConfidence: a.rawConfidence })),
    config.temperature
  );

  const outlierCount = weights.filter((w) => w.isOutlier).length;

  emit({
    type: "weights_calculated",
    data: {
      weights,
      temperature: config.temperature,
      outlierCount,
    },
  });

  // Push weights stage (stageOrder: 1)
  const weightsSummary = weights
    .map((w) => `${w.model}: ${w.weightPercent}% (conf ${w.rawConfidence})`)
    .join(", ");
  stages.push({
    stageType: "weights",
    stageOrder: 1,
    model: null,
    role: null,
    content: `Weight Distribution (temperature=${config.temperature}): ${weightsSummary}. Outliers: ${outlierCount}.`,
    parsedData: {
      type: "weights",
      temperature: config.temperature,
      weights,
      outlierCount,
    },
    responseTimeMs: null,
  });

  // 6. synthesis_start
  emit({ type: "synthesis_start" });

  // Stage 3: Weighted synthesis
  const synthesis = await synthesizeWeighted(question, answers, weights, config, history);

  if (!synthesis) {
    emit({
      type: "error",
      message: "Synthesis model failed to respond. Partial results (answers + weights) saved.",
    });
    return stages;
  }

  // 7. synthesis_complete
  emit({
    type: "synthesis_complete",
    data: {
      model: synthesis.model,
      response: synthesis.response,
      calibrationNotes: synthesis.calibrationNotes,
      responseTimeMs: synthesis.responseTimeMs,
    },
  });

  // Find highest and lowest weight for parsedData
  const sortedWeights = [...weights].sort(
    (a, b) => b.normalizedWeight - a.normalizedWeight
  );
  const highestWeight = sortedWeights[0];
  const lowestWeight = sortedWeights[sortedWeights.length - 1];

  // Push synthesis stage (stageOrder: 2)
  stages.push({
    stageType: "synthesis",
    stageOrder: 2,
    model: synthesis.model,
    role: "synthesizer",
    content: `SYNTHESIS:\n${synthesis.response}\n\nCONFIDENCE CALIBRATION NOTES:\n${synthesis.calibrationNotes}`,
    parsedData: {
      synthesisPreview: synthesis.response.slice(0, 200),
      calibrationNotes: synthesis.calibrationNotes,
      totalModels: answers.length,
      highestWeight: { model: highestWeight.model, weightPercent: highestWeight.weightPercent },
      lowestWeight: { model: lowestWeight.model, weightPercent: lowestWeight.weightPercent },
    },
    responseTimeMs: synthesis.responseTimeMs,
  });

  // Route handles title_complete and complete events
  return stages;
}
