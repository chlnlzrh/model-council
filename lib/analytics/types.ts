/**
 * TypeScript interfaces for the analytics dashboard.
 *
 * All data shapes used by the API response, compute functions,
 * and UI components are defined here.
 */

// ---------------------------------------------------------------------------
// Win Rate
// ---------------------------------------------------------------------------

export interface WinRateEntry {
  model: string;
  displayName: string;
  wins: number;
  totalAppearances: number;
  winRate: number; // 0–1
}

// ---------------------------------------------------------------------------
// Response Time
// ---------------------------------------------------------------------------

export interface ResponseTimeEntry {
  model: string;
  displayName: string;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  sampleCount: number;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export interface DailyUsageEntry {
  date: string; // ISO date "2026-02-01"
  queryCount: number;
}

export interface AnalyticsSummary {
  totalSessions: number;
  totalQueries: number;
  avgResponseTimeMs: number;
  topModel: string | null;
  topModelDisplayName: string | null;
}

export interface DateRange {
  from: string | null; // ISO datetime or null for "all"
  to: string;
  preset: DatePreset;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export type DatePreset = "7d" | "30d" | "90d" | "all";

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

// ---------------------------------------------------------------------------
// Full API Response
// ---------------------------------------------------------------------------

export interface AnalyticsData {
  winRates: WinRateEntry[];
  responseTimes: ResponseTimeEntry[];
  dailyUsage: DailyUsageEntry[];
  summary: AnalyticsSummary;
  dateRange: DateRange;
}

// ---------------------------------------------------------------------------
// Raw DB Row Shapes (used by compute functions)
// ---------------------------------------------------------------------------

export interface RawRankingRow {
  messageId: string;
  rankerModel: string;
  parsedRanking: unknown; // JSONB — parsed as RankingEntry[]
}

export interface RawLabelMapRow {
  messageId: string;
  label: string;
  model: string;
}

export interface RawResponseTimeRow {
  model: string;
  responseTimeMs: number | null;
}

export interface RawMessageDateRow {
  createdAt: Date;
}

export interface RawDeliberationStageRow {
  messageId: string;
  stageType: string;
  stageOrder: number;
  model: string | null;
  role: string | null;
  parsedData: unknown;
  responseTimeMs: number | null;
  mode: string;
}

// ---------------------------------------------------------------------------
// Mode Distribution
// ---------------------------------------------------------------------------

export interface ModeDistributionEntry {
  mode: string;
  displayName: string;
  count: number;
  percentage: number;
}

export interface DailyModeUsageEntry {
  date: string;
  mode: string;
  queryCount: number;
}

// ---------------------------------------------------------------------------
// Extended Summary (Overview tab)
// ---------------------------------------------------------------------------

export interface ExtendedAnalyticsSummary extends AnalyticsSummary {
  modesUsed: number;
  mostActiveMode: string | null;
  mostActiveModeDisplayName: string | null;
}

// ---------------------------------------------------------------------------
// Cross-Mode Model Comparison
// ---------------------------------------------------------------------------

export interface CrossModeModelModeEntry {
  mode: string;
  sessions: number;
  avgResponseTimeMs: number;
  winRate?: number;
  avgScore?: number;
}

export interface CrossModeModelEntry {
  model: string;
  displayName: string;
  modes: CrossModeModelModeEntry[];
  overallScore: number;
  totalSessions: number;
}

// ---------------------------------------------------------------------------
// Mode-Specific Metrics (discriminated union)
// ---------------------------------------------------------------------------

export interface CouncilMetrics {
  kind: "council";
  winRates: WinRateEntry[];
  avgRankings: Array<{ model: string; displayName: string; avgRank: number }>;
}

export interface VoteMetrics {
  kind: "vote";
  winnerDistribution: Array<{ model: string; displayName: string; wins: number }>;
  tiebreakerRate: number;
  avgWinMargin: number;
}

export interface JuryMetrics {
  kind: "jury";
  verdictDistribution: Array<{ verdict: string; count: number }>;
  dimensionAverages: Array<{ dimension: string; avgScore: number }>;
  jurorConsensusRate: number;
}

export interface DebateMetrics {
  kind: "debate";
  revisionDecisionDist: Array<{ decision: string; count: number }>;
  winnerDistribution: Array<{ model: string; displayName: string; wins: number }>;
  avgWordCountDelta: number;
}

export interface TournamentMetrics {
  kind: "tournament";
  championDistribution: Array<{ model: string; displayName: string; wins: number }>;
  matchupWinRates: Array<{ model: string; displayName: string; winRate: number; matches: number }>;
}

export interface DelphiMetrics {
  kind: "delphi";
  avgConvergenceRounds: number;
  confidenceDistribution: Array<{ bucket: string; count: number }>;
}

export interface ConfidenceMetrics {
  kind: "confidence_weighted";
  confidenceHistogram: Array<{ bucket: string; count: number }>;
  outlierRate: number;
  avgConfidence: number;
}

export interface RedTeamMetrics {
  kind: "red_team";
  severityDistribution: Array<{ severity: string; count: number }>;
  defenseAcceptRate: number;
}

export interface ChainMetrics {
  kind: "chain";
  avgWordCountProgression: Array<{ step: number; avgWordCount: number }>;
  mandateDistribution: Array<{ mandate: string; count: number }>;
  skipRate: number;
}

export interface SpecialistPanelMetrics {
  kind: "specialist_panel";
  roleDistribution: Array<{ role: string; count: number }>;
}

export interface BlueprintMetrics {
  kind: "blueprint";
  avgSectionCount: number;
  avgWordCount: number;
  todoMarkerRate: number;
}

export interface PeerReviewMetrics {
  kind: "peer_review";
  findingSeverityDist: Array<{ severity: string; count: number }>;
  rubricScoreAverages: Array<{ criterion: string; avgScore: number }>;
  consensusRate: number;
}

export interface DecomposeMetrics {
  kind: "decompose";
  avgParallelismEfficiency: number;
  taskSuccessRate: number;
  avgWaveCount: number;
}

export interface BrainstormMetrics {
  kind: "brainstorm";
  avgIdeaCount: number;
  clusterScoreAverages: Array<{ dimension: string; avgScore: number }>;
}

export interface FactCheckMetrics {
  kind: "fact_check";
  claimTypeDistribution: Array<{ type: string; count: number }>;
  verdictDistribution: Array<{ verdict: string; count: number }>;
  avgAgreementRate: number;
}

export type ModeMetrics =
  | CouncilMetrics
  | VoteMetrics
  | JuryMetrics
  | DebateMetrics
  | TournamentMetrics
  | DelphiMetrics
  | ConfidenceMetrics
  | RedTeamMetrics
  | ChainMetrics
  | SpecialistPanelMetrics
  | BlueprintMetrics
  | PeerReviewMetrics
  | DecomposeMetrics
  | BrainstormMetrics
  | FactCheckMetrics;

// ---------------------------------------------------------------------------
// Extended API Responses
// ---------------------------------------------------------------------------

export interface ExtendedAnalyticsData extends AnalyticsData {
  modeDistribution: ModeDistributionEntry[];
  crossModeModels: CrossModeModelEntry[];
}

export interface ModeAnalyticsData {
  mode: string;
  modeName: string;
  queryCount: number;
  responseTimes: ResponseTimeEntry[];
  metrics: ModeMetrics;
}
