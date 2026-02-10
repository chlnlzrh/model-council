/**
 * Core type definitions for the Model Council deliberation platform.
 *
 * Council Pipeline (original):
 *   Stage 1: Collect individual responses from council models
 *   Stage 2: Anonymize & cross-rank responses
 *   Stage 3: Chairman synthesizes final answer
 *
 * Multi-Mode: 15 deliberation modes across 6 families.
 * See docs/modes/ for full specifications per mode.
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
// Deliberation Modes
// ---------------------------------------------------------------------------

export type DeliberationMode =
  | "council"
  | "vote"
  | "jury"
  | "debate"
  | "delphi"
  | "red_team"
  | "chain"
  | "specialist_panel"
  | "blueprint"
  | "peer_review"
  | "tournament"
  | "confidence_weighted"
  | "decompose"
  | "brainstorm"
  | "fact_check";

export const DELIBERATION_MODES: readonly DeliberationMode[] = [
  "council",
  "vote",
  "jury",
  "debate",
  "delphi",
  "red_team",
  "chain",
  "specialist_panel",
  "blueprint",
  "peer_review",
  "tournament",
  "confidence_weighted",
  "decompose",
  "brainstorm",
  "fact_check",
] as const;

export type ModeFamily =
  | "evaluation"
  | "adversarial"
  | "sequential"
  | "role_based"
  | "algorithmic"
  | "creative"
  | "verification";

export interface ModeDefinition {
  id: DeliberationMode;
  name: string;
  family: ModeFamily;
  description: string;
  minModels: number;
  maxModels: number;
  requiresSpecialRole: boolean;
  supportsMultiTurn: boolean;
  estimatedDurationMs: number;
}

// ---------------------------------------------------------------------------
// Shared Mode Configuration
// ---------------------------------------------------------------------------

export interface BaseModeConfig {
  mode: DeliberationMode;
  models: string[];
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Deliberation Stage (generic storage for non-Council modes)
// ---------------------------------------------------------------------------

export interface DeliberationStageData {
  stageType: string;
  stageOrder: number;
  model: string | null;
  role: string | null;
  content: string;
  parsedData: unknown;
  responseTimeMs: number | null;
}

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

/** Council-specific SSE events (backward compatible) */
export type CouncilSSEEventType =
  | "stage1_start"
  | "stage1_complete"
  | "stage2_start"
  | "stage2_complete"
  | "stage3_start"
  | "stage3_complete";

/** Shared SSE events (all modes) */
export type SharedSSEEventType =
  | "title_complete"
  | "complete"
  | "error";

/** Mode-specific SSE events use string literals defined per mode */
export type SSEEventType =
  | CouncilSSEEventType
  | SharedSSEEventType
  | string; // mode-specific events (e.g. "vote_round_start", "attack_complete")

export interface SSEEvent<T = unknown> {
  type: SSEEventType;
  data?: T;
  metadata?: Stage2Metadata;
  message?: string; // error events only
}

// ---------------------------------------------------------------------------
// Conversation History (multi-turn)
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// API Request / Response
// ---------------------------------------------------------------------------

export interface CouncilStreamRequest {
  question: string;
  conversationId?: string;
  councilModels?: string[];
  chairmanModel?: string;
}

export interface ModeStreamRequest {
  question: string;
  mode: DeliberationMode;
  conversationId?: string;
  /** Council-specific (backward compat) */
  councilModels?: string[];
  chairmanModel?: string;
  /** Generic mode configuration — shape varies per mode */
  modeConfig?: Record<string, unknown>;
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
