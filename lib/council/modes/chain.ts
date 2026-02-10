/**
 * Chain Mode — Sequential improvement pipeline: Draft → Improve → Refine → Polish
 *
 * Each model in the chain receives the original query + the previous model's
 * output + a specific improvement mandate. Strictly sequential — no parallelism.
 *
 * The final output is the last completed step's content. All intermediate
 * versions are preserved for comparison.
 *
 * See docs/modes/07-chain.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel } from "../openrouter";

// ---------------------------------------------------------------------------
// Mandate Library
// ---------------------------------------------------------------------------

export interface MandateDefinition {
  key: string;
  display: string;
  details: string;
}

const MANDATE_LIBRARY: Record<string, MandateDefinition> = {
  draft: {
    key: "draft",
    display: "Draft",
    details:
      "Comprehensive first pass covering all aspects of the request. Prioritize completeness and coverage over polish.",
  },
  structure_depth: {
    key: "structure_depth",
    display: "Structure & Depth",
    details:
      "Reorganize for logical flow, add missing sections, deepen shallow areas, improve headings and hierarchy.",
  },
  accuracy_completeness: {
    key: "accuracy_completeness",
    display: "Accuracy & Completeness",
    details:
      "Verify factual claims, fill gaps, add edge cases and caveats, ensure nothing important is omitted.",
  },
  polish_format: {
    key: "polish_format",
    display: "Polish & Format",
    details:
      "Improve readability, fix grammar and spelling, ensure consistent formatting, improve transitions between sections.",
  },
  security_review: {
    key: "security_review",
    display: "Security Review",
    details:
      "Examine for security vulnerabilities, add security recommendations, flag risky patterns, suggest hardening measures.",
  },
  cost_analysis: {
    key: "cost_analysis",
    display: "Cost Analysis",
    details:
      "Add cost estimates, pricing comparisons, ROI analysis, budget considerations, and total cost of ownership.",
  },
  accessibility: {
    key: "accessibility",
    display: "Accessibility",
    details:
      "Review for accessibility concerns, add WCAG compliance notes, ensure inclusive language and design recommendations.",
  },
  performance: {
    key: "performance",
    display: "Performance",
    details:
      "Analyze for performance implications, add benchmarks or estimates, suggest optimizations, flag potential bottlenecks.",
  },
};

/**
 * Get mandate details for a given key. Supports "custom" mandates with
 * user-provided details.
 */
export function getMandateDetails(
  mandateKey: string,
  customMandate?: string
): MandateDefinition {
  if (mandateKey === "custom") {
    return {
      key: "custom",
      display: "Custom",
      details: customMandate ?? "Apply custom improvements as needed.",
    };
  }
  return (
    MANDATE_LIBRARY[mandateKey] ?? {
      key: mandateKey,
      display: mandateKey,
      details: `Apply ${mandateKey} improvements.`,
    }
  );
}

/**
 * Check if a mandate key is valid (known library key or "custom").
 */
export function isValidMandate(key: string): boolean {
  return key === "custom" || key in MANDATE_LIBRARY;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainStepConfig {
  model: string;
  mandate: string;
  customMandate?: string;
}

export interface ChainConfig {
  steps: ChainStepConfig[];
  timeoutMs: number;
}

export const DEFAULT_CHAIN_STEPS: ChainStepConfig[] = [
  { model: "anthropic/claude-sonnet-4", mandate: "draft" },
  { model: "openai/gpt-4o", mandate: "structure_depth" },
  { model: "google/gemini-2.5-flash-preview", mandate: "accuracy_completeness" },
  { model: "anthropic/claude-sonnet-4", mandate: "polish_format" },
];

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
  steps: DEFAULT_CHAIN_STEPS,
  timeoutMs: 120_000,
};

export interface ChainStepResult {
  step: number;
  model: string;
  mandate: string;
  mandateDisplay: string;
  content: string;
  wordCount: number;
  previousWordCount: number;
  wordCountDelta: number;
  responseTimeMs: number;
  skipped: boolean;
  skipReason?: string;
}

export interface ChainResult {
  steps: ChainStepResult[];
  finalContent: string;
  totalSteps: number;
  completedSteps: number;
  skippedSteps: number[];
  wordCountProgression: number[];
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Count words in a text string.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

export function buildDraftPrompt(userQuery: string): string {
  return `You are the first model in a sequential quality chain. Produce a comprehensive initial draft that subsequent models will improve.

USER REQUEST:
${userQuery}

Produce a thorough, well-structured first draft. Prioritize completeness and coverage over polish. Subsequent models will improve structure, accuracy, and formatting.

Do not add disclaimers about being an AI or meta-commentary about the draft process. Produce the content directly.`;
}

export function buildImprovePrompt(
  userQuery: string,
  previousOutput: string,
  stepNumber: number,
  totalSteps: number,
  mandate: MandateDefinition,
  skippedSteps?: Array<{ step: number; mandate: string }>
): string {
  const previousStepNumber = stepNumber - 1;

  let skippedNote = "";
  if (skippedSteps && skippedSteps.length > 0) {
    const skippedDesc = skippedSteps
      .map((s) => `Step ${s.step} (${s.mandate})`)
      .join(", ");
    skippedNote = `\nNOTE: ${skippedDesc} was skipped due to a processing error. You may need to also address aspects of ${skippedSteps.length === 1 ? "that mandate" : "those mandates"} in addition to your own.\n`;
  }

  return `You are step ${stepNumber} of ${totalSteps} in a sequential quality chain. Your specific mandate is: **${mandate.display}**

ORIGINAL USER REQUEST:
${userQuery}

PREVIOUS VERSION (from step ${previousStepNumber}):
${previousOutput}
${skippedNote}
Your mandate — ${mandate.display} — means you should focus on:
${mandate.details}

Rules:
1. Build on the previous version. Do NOT start from scratch.
2. Preserve what is already good.
3. If you add content, integrate it naturally into the existing structure.
4. If you remove content, explain in a brief editor's note at the top (prefixed with "[Editor's Note: ...]").
5. Do not add disclaimers about being an AI or meta-commentary about the chain process.

Produce the improved version now:`;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the full Chain pipeline and return the result.
 * Used for non-streaming testing.
 */
export async function runFullChain(
  userQuery: string,
  config: ChainConfig = DEFAULT_CHAIN_CONFIG
): Promise<ChainResult> {
  const steps: ChainStepResult[] = [];
  let lastContent = "";
  let lastWordCount = 0;
  const skippedSinceLastSuccess: Array<{ step: number; mandate: string }> = [];

  for (let i = 0; i < config.steps.length; i++) {
    const stepNum = i + 1;
    const stepConfig = config.steps[i];
    const mandate = getMandateDetails(stepConfig.mandate, stepConfig.customMandate);

    if (i === 0) {
      // Draft step
      const prompt = buildDraftPrompt(userQuery);
      const result = await queryModel(stepConfig.model, prompt, config.timeoutMs);

      if (!result || !result.content.trim()) {
        throw new Error(
          "Chain mode requires a successful draft (step 1). The drafter model failed to respond."
        );
      }

      const wc = countWords(result.content);
      steps.push({
        step: stepNum,
        model: stepConfig.model,
        mandate: stepConfig.mandate,
        mandateDisplay: mandate.display,
        content: result.content,
        wordCount: wc,
        previousWordCount: 0,
        wordCountDelta: wc,
        responseTimeMs: result.responseTimeMs,
        skipped: false,
      });
      lastContent = result.content;
      lastWordCount = wc;
    } else {
      // Improvement step
      const prompt = buildImprovePrompt(
        userQuery,
        lastContent,
        stepNum,
        config.steps.length,
        mandate,
        skippedSinceLastSuccess.length > 0 ? [...skippedSinceLastSuccess] : undefined
      );

      const result = await queryModel(stepConfig.model, prompt, config.timeoutMs);

      if (!result || !result.content.trim()) {
        // Skip this step
        steps.push({
          step: stepNum,
          model: stepConfig.model,
          mandate: stepConfig.mandate,
          mandateDisplay: mandate.display,
          content: "",
          wordCount: 0,
          previousWordCount: lastWordCount,
          wordCountDelta: 0,
          responseTimeMs: 0,
          skipped: true,
          skipReason: !result ? "Model failed to respond" : "Model returned empty output",
        });
        skippedSinceLastSuccess.push({ step: stepNum, mandate: mandate.display });
        continue;
      }

      const wc = countWords(result.content);
      steps.push({
        step: stepNum,
        model: stepConfig.model,
        mandate: stepConfig.mandate,
        mandateDisplay: mandate.display,
        content: result.content,
        wordCount: wc,
        previousWordCount: lastWordCount,
        wordCountDelta: wc - lastWordCount,
        responseTimeMs: result.responseTimeMs,
        skipped: false,
      });
      lastContent = result.content;
      lastWordCount = wc;
      skippedSinceLastSuccess.length = 0; // Reset skipped tracker
    }
  }

  const completedSteps = steps.filter((s) => !s.skipped);

  return {
    steps,
    finalContent: completedSteps.length > 0
      ? completedSteps[completedSteps.length - 1].content
      : "",
    totalSteps: steps.length,
    completedSteps: completedSteps.length,
    skippedSteps: steps.filter((s) => s.skipped).map((s) => s.step),
    wordCountProgression: steps.map((s) => s.wordCount),
  };
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Chain pipeline, emitting SSE events via the controller.
 * Returns stage data for DB persistence.
 */
export async function handleChainStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: ChainConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // Build step info for the start event
  const stepInfos = config.steps.map((s, i) => {
    const mandate = getMandateDetails(s.mandate, s.customMandate);
    return {
      step: i + 1,
      model: s.model,
      mandate: s.mandate,
      mandateDisplay: mandate.display,
    };
  });

  emit({
    type: "chain_start",
    data: {
      conversationId,
      messageId,
      mode: "chain",
      totalSteps: config.steps.length,
      steps: stepInfos,
    },
  });

  let lastContent = "";
  let lastWordCount = 0;
  const skippedSinceLastSuccess: Array<{ step: number; mandate: string }> = [];

  for (let i = 0; i < config.steps.length; i++) {
    const stepNum = i + 1;
    const stepConfig = config.steps[i];
    const mandate = getMandateDetails(stepConfig.mandate, stepConfig.customMandate);

    emit({
      type: "chain_step_start",
      data: {
        step: stepNum,
        model: stepConfig.model,
        mandate: mandate.display,
        ...(skippedSinceLastSuccess.length > 0
          ? { note: "Previous step(s) skipped" }
          : {}),
      },
    });

    if (i === 0) {
      // Draft step
      const prompt = buildDraftPrompt(question);
      const result = await queryModel(stepConfig.model, prompt, config.timeoutMs);

      if (!result || !result.content.trim()) {
        emit({
          type: "error",
          message: "Chain mode requires a successful draft (step 1). The drafter model failed to respond.",
        });
        return stages;
      }

      const wc = countWords(result.content);

      emit({
        type: "chain_step_complete",
        data: {
          step: stepNum,
          data: {
            model: stepConfig.model,
            mandate: mandate.display,
            content: result.content,
            wordCount: wc,
            previousWordCount: 0,
            wordCountDelta: wc,
            responseTimeMs: result.responseTimeMs,
          },
        },
      });

      stages.push({
        stageType: `chain_step_${stepNum}`,
        stageOrder: stepNum,
        model: stepConfig.model,
        role: "drafter",
        content: result.content,
        parsedData: {
          step: stepNum,
          mandate: stepConfig.mandate,
          mandateDisplay: mandate.display,
          wordCount: wc,
          previousWordCount: 0,
          wordCountDelta: wc,
        },
        responseTimeMs: result.responseTimeMs,
      });

      lastContent = result.content;
      lastWordCount = wc;
    } else {
      // Improvement step
      const prompt = buildImprovePrompt(
        question,
        lastContent,
        stepNum,
        config.steps.length,
        mandate,
        skippedSinceLastSuccess.length > 0 ? [...skippedSinceLastSuccess] : undefined
      );

      const result = await queryModel(stepConfig.model, prompt, config.timeoutMs);

      if (!result || !result.content.trim()) {
        const skipReason = !result
          ? "Model failed to respond"
          : "Model returned empty output";

        emit({
          type: "chain_step_skipped",
          data: {
            step: stepNum,
            reason: skipReason,
            mandate: mandate.display,
          },
        });

        stages.push({
          stageType: `chain_step_${stepNum}`,
          stageOrder: stepNum,
          model: stepConfig.model,
          role: "improver",
          content: "",
          parsedData: {
            step: stepNum,
            mandate: stepConfig.mandate,
            mandateDisplay: mandate.display,
            skipped: true,
            skipReason,
            wordCount: 0,
            previousWordCount: lastWordCount,
            wordCountDelta: 0,
          },
          responseTimeMs: null,
        });

        skippedSinceLastSuccess.push({ step: stepNum, mandate: mandate.display });
        continue;
      }

      const wc = countWords(result.content);

      emit({
        type: "chain_step_complete",
        data: {
          step: stepNum,
          data: {
            model: stepConfig.model,
            mandate: mandate.display,
            content: result.content,
            wordCount: wc,
            previousWordCount: lastWordCount,
            wordCountDelta: wc - lastWordCount,
            responseTimeMs: result.responseTimeMs,
          },
        },
      });

      stages.push({
        stageType: `chain_step_${stepNum}`,
        stageOrder: stepNum,
        model: stepConfig.model,
        role: "improver",
        content: result.content,
        parsedData: {
          step: stepNum,
          mandate: stepConfig.mandate,
          mandateDisplay: mandate.display,
          wordCount: wc,
          previousWordCount: lastWordCount,
          wordCountDelta: wc - lastWordCount,
        },
        responseTimeMs: result.responseTimeMs,
      });

      lastContent = result.content;
      lastWordCount = wc;
      skippedSinceLastSuccess.length = 0;
    }
  }

  // Note: title generation and "complete" event are handled by the route dispatcher.

  return stages;
}
