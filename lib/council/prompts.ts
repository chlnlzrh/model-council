/**
 * Prompt templates for the 3-stage council pipeline.
 *
 * Ported from karpathy/llm-council's council.py — all prompts are
 * reimplemented in TypeScript with template literal functions.
 */

import type { Stage1Response, Stage2Response } from "./types";

// ---------------------------------------------------------------------------
// Stage 2 — Ranking Prompt
// ---------------------------------------------------------------------------

export interface RankingPromptInput {
  userQuery: string;
  labeledResponses: { label: string; response: string }[];
}

/**
 * Build the prompt that instructs an evaluator model to rank anonymized responses.
 */
export function buildRankingPrompt(input: RankingPromptInput): string {
  const responsesText = input.labeledResponses
    .map(({ label, response }) => `${label}:\n${response}`)
    .join("\n\n");

  return `You are evaluating different responses to the following question:

Question: ${input.userQuery}

Here are the responses from different models (anonymized):

${responsesText}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:`;
}

// ---------------------------------------------------------------------------
// Stage 3 — Chairman Synthesis Prompt
// ---------------------------------------------------------------------------

export interface SynthesisPromptInput {
  userQuery: string;
  stage1Results: Stage1Response[];
  stage2Results: Stage2Response[];
}

/**
 * Build the prompt for the chairman model to synthesize a final answer.
 */
export function buildSynthesisPrompt(input: SynthesisPromptInput): string {
  const stage1Text = input.stage1Results
    .map((r) => `Model: ${r.model}\nResponse: ${r.response}`)
    .join("\n\n");

  const stage2Text = input.stage2Results
    .map((r) => `Model: ${r.model}\nRanking: ${r.rankingText}`)
    .join("\n\n");

  return `You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: ${input.userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;
}

// ---------------------------------------------------------------------------
// Title Generation Prompt
// ---------------------------------------------------------------------------

/**
 * Build a prompt to generate a short conversation title.
 */
export function buildTitlePrompt(userQuery: string): string {
  return `Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: ${userQuery}

Title:`;
}
