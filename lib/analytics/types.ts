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
