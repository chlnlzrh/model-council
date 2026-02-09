/**
 * OpenRouter client — uses Vercel AI SDK pointed at the OpenRouter endpoint.
 *
 * OpenRouter acts as a gateway to all LLM providers (OpenAI, Anthropic,
 * Google, etc.) via a single API key.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Create a Vercel AI SDK provider configured for OpenRouter.
 */
function getOpenRouterProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY environment variable is not set");
  }

  return createOpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
  });
}

export interface QueryResult {
  content: string;
  responseTimeMs: number;
}

/**
 * Query a single model via OpenRouter.
 *
 * @param model - OpenRouter model identifier (e.g. "openai/gpt-4o")
 * @param prompt - The user prompt to send
 * @param timeoutMs - Request timeout in milliseconds (default 120s)
 * @returns QueryResult or null if the request failed
 */
export async function queryModel(
  model: string,
  prompt: string,
  timeoutMs: number = 120_000
): Promise<QueryResult | null> {
  const provider = getOpenRouterProvider();
  const start = Date.now();

  try {
    const result = await generateText({
      model: provider(model),
      prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    });

    return {
      content: result.text,
      responseTimeMs: Date.now() - start,
    };
  } catch (error) {
    console.error(`[openrouter] Error querying ${model}:`, error);
    return null;
  }
}

/**
 * Query multiple models in parallel.
 *
 * Uses Promise.allSettled so one failure doesn't block others.
 *
 * @param models - List of OpenRouter model identifiers
 * @param prompt - The prompt to send to each model
 * @param timeoutMs - Per-model timeout
 * @returns Map of model identifier → QueryResult (null entries excluded)
 */
export async function queryModelsParallel(
  models: string[],
  prompt: string,
  timeoutMs: number = 120_000
): Promise<Map<string, QueryResult>> {
  const results = await Promise.allSettled(
    models.map((model) => queryModel(model, prompt, timeoutMs))
  );

  const map = new Map<string, QueryResult>();

  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value !== null) {
      map.set(models[index], result.value);
    } else if (result.status === "rejected") {
      console.error(
        `[openrouter] ${models[index]} rejected:`,
        result.reason
      );
    }
  });

  return map;
}
