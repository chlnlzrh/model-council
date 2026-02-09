/**
 * GET /api/models — Discover available OpenRouter models.
 *
 * Proxies to OpenRouter's model list, filters to chat-capable models,
 * and returns a slim payload. Cached in-memory for 5 minutes.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  architecture: {
    modality: string;
    input_modalities: string[];
    output_modalities: string[];
  };
  pricing: {
    prompt: string;
    completion: string;
  };
  top_provider: {
    context_length: number;
    max_completion_tokens: number | null;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  maxCompletionTokens: number | null;
  pricing: {
    promptPer1M: number;
    completionPer1M: number;
  };
}

// In-memory cache
let cachedModels: ModelInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function fetchModels(): Promise<ModelInfo[]> {
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`OpenRouter API error: ${res.status}`);
  }

  const json = await res.json();
  const models: OpenRouterModel[] = json.data;

  // Filter to text-capable chat models (text input + text output)
  const chatModels = models.filter(
    (m) =>
      m.architecture.input_modalities.includes("text") &&
      m.architecture.output_modalities.includes("text")
  );

  // Map to slim payload, sorted by name
  const result: ModelInfo[] = chatModels
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      maxCompletionTokens: m.top_provider.max_completion_tokens,
      pricing: {
        promptPer1M: parseFloat(m.pricing.prompt) * 1_000_000,
        completionPer1M: parseFloat(m.pricing.completion) * 1_000_000,
      },
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  cachedModels = result;
  cacheTimestamp = now;
  return result;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const models = await fetchModels();
    return NextResponse.json(
      { models, count: models.length },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch models";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
