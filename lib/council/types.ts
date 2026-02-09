/**
 * Core type definitions for the Model Council 3-stage pipeline.
 *
 * Stage 1: Collect individual responses from council models
 * Stage 2: Anonymize & cross-rank responses
 * Stage 3: Chairman synthesizes final answer
 */

// ---------------------------------------------------------------------------
// Stage 1 — Individual Responses
// ---------------------------------------------------------------------------

export interface Stage1Response {
  model: string;
  response: string;
  responseTimeMs: number;
}

// ---------------------------------------------------------------------------
// Stage 2 — Rankings
// ---------------------------------------------------------------------------

export interface RankingEntry {
  label: string; // e.g. "Response A"
  position: number; // 1-based rank
}

export interface Stage2Response {
  model: string;
  rankingText: string;
  parsedRanking: RankingEntry[];
}

export interface AggregateRanking {
  model: string;
  averageRank: number;
  rankingsCount: number;
}

export interface LabelMap {
  [label: string]: string; // "Response A" → "openai/gpt-4o"
}

export interface Stage2Metadata {
  labelToModel: LabelMap;
  aggregateRankings: AggregateRanking[];
}

// ---------------------------------------------------------------------------
// Stage 3 — Chairman Synthesis
// ---------------------------------------------------------------------------

export interface Stage3Response {
  model: string;
  response: string;
  responseTimeMs: number;
}

// ---------------------------------------------------------------------------
// Council Configuration
// ---------------------------------------------------------------------------

export interface CouncilConfig {
  councilModels: string[];
  chairmanModel: string;
  timeoutMs?: number;
}

export const DEFAULT_COUNCIL_CONFIG: CouncilConfig = {
  councilModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
    "perplexity/sonar-pro",
  ],
  chairmanModel: "anthropic/claude-opus-4-6",
  timeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export type SSEEventType =
  | "stage1_start"
  | "stage1_complete"
  | "stage2_start"
  | "stage2_complete"
  | "stage3_start"
  | "stage3_complete"
  | "title_complete"
  | "complete"
  | "error";

export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  data?: T;
  metadata?: Stage2Metadata;
  message?: string; // error events only
}

// ---------------------------------------------------------------------------
// API Request / Response
// ---------------------------------------------------------------------------

export interface CouncilStreamRequest {
  question: string;
  councilModels?: string[];
  chairmanModel?: string;
}

// ---------------------------------------------------------------------------
// Orchestrator Result (non-streaming)
// ---------------------------------------------------------------------------

export interface CouncilResult {
  stage1: Stage1Response[];
  stage2: Stage2Response[];
  stage2Metadata: Stage2Metadata;
  stage3: Stage3Response;
  title?: string;
}
