/**
 * Pure aggregation functions for analytics data.
 *
 * All functions are stateless and take raw DB rows as input.
 * This makes them trivially unit-testable without DB mocks.
 */

import { getModelDisplayName } from "@/lib/council/model-colors";
import type { RankingEntry } from "@/lib/council/types";
import type {
  DatePreset,
  WinRateEntry,
  ResponseTimeEntry,
  DailyUsageEntry,
  AnalyticsSummary,
  RawRankingRow,
  RawLabelMapRow,
  RawResponseTimeRow,
  RawMessageDateRow,
} from "./types";

// ---------------------------------------------------------------------------
// Date preset → Date conversion
// ---------------------------------------------------------------------------

export function presetToDate(preset: DatePreset): Date | null {
  if (preset === "all") return null;

  const now = new Date();
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function isValidPreset(value: string): value is DatePreset {
  return ["7d", "30d", "90d", "all"].includes(value);
}

// ---------------------------------------------------------------------------
// Win Rates
// ---------------------------------------------------------------------------

export function computeWinRates(
  rankings: RawRankingRow[],
  labelMaps: RawLabelMapRow[]
): WinRateEntry[] {
  // Build per-message label→model lookup
  const labelLookup = new Map<string, Map<string, string>>();
  for (const row of labelMaps) {
    if (!labelLookup.has(row.messageId)) {
      labelLookup.set(row.messageId, new Map());
    }
    labelLookup.get(row.messageId)!.set(row.label, row.model);
  }

  // Track wins and appearances per model
  const modelStats = new Map<string, { wins: number; appearances: number }>();

  // Count appearances: for each unique messageId, each model in its label map appears once
  const seenMessages = new Set<string>();
  for (const row of labelMaps) {
    const key = `${row.messageId}:${row.model}`;
    if (!seenMessages.has(key)) {
      seenMessages.add(key);
      const stats = modelStats.get(row.model) ?? { wins: 0, appearances: 0 };
      stats.appearances++;
      modelStats.set(row.model, stats);
    }
  }

  // Count wins: for each ranking row, find position=1
  for (const ranking of rankings) {
    const parsed = ranking.parsedRanking as RankingEntry[] | null;
    if (!Array.isArray(parsed)) continue;

    const winner = parsed.find((e) => e.position === 1);
    if (!winner) continue;

    const msgLabels = labelLookup.get(ranking.messageId);
    if (!msgLabels) continue;

    const winnerModel = msgLabels.get(winner.label);
    if (!winnerModel) continue;

    const stats = modelStats.get(winnerModel);
    if (stats) {
      stats.wins++;
    }
  }

  // Convert to sorted array
  const entries: WinRateEntry[] = [];
  for (const [model, stats] of modelStats) {
    if (stats.appearances === 0) continue;
    entries.push({
      model,
      displayName: getModelDisplayName(model),
      wins: stats.wins,
      totalAppearances: stats.appearances,
      winRate: stats.wins / stats.appearances,
    });
  }

  return entries.sort((a, b) => b.winRate - a.winRate);
}

// ---------------------------------------------------------------------------
// Response Times
// ---------------------------------------------------------------------------

export function computeResponseTimes(
  rows: RawResponseTimeRow[]
): ResponseTimeEntry[] {
  const grouped = new Map<
    string,
    { sum: number; min: number; max: number; count: number }
  >();

  for (const row of rows) {
    if (row.responseTimeMs == null) continue;

    const existing = grouped.get(row.model);
    if (existing) {
      existing.sum += row.responseTimeMs;
      existing.min = Math.min(existing.min, row.responseTimeMs);
      existing.max = Math.max(existing.max, row.responseTimeMs);
      existing.count++;
    } else {
      grouped.set(row.model, {
        sum: row.responseTimeMs,
        min: row.responseTimeMs,
        max: row.responseTimeMs,
        count: 1,
      });
    }
  }

  const entries: ResponseTimeEntry[] = [];
  for (const [model, stats] of grouped) {
    entries.push({
      model,
      displayName: getModelDisplayName(model),
      avgResponseTimeMs: Math.round(stats.sum / stats.count),
      minResponseTimeMs: stats.min,
      maxResponseTimeMs: stats.max,
      sampleCount: stats.count,
    });
  }

  return entries.sort((a, b) => a.avgResponseTimeMs - b.avgResponseTimeMs);
}

// ---------------------------------------------------------------------------
// Daily Usage
// ---------------------------------------------------------------------------

export function computeDailyUsage(
  messageDates: RawMessageDateRow[]
): DailyUsageEntry[] {
  const counts = new Map<string, number>();

  for (const row of messageDates) {
    const date = row.createdAt.toISOString().split("T")[0];
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const entries: DailyUsageEntry[] = [];
  for (const [date, queryCount] of counts) {
    entries.push({ date, queryCount });
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function computeSummary(
  totalSessions: number,
  totalQueries: number,
  responseTimes: ResponseTimeEntry[],
  winRates: WinRateEntry[]
): AnalyticsSummary {
  // Overall avg response time
  let totalMs = 0;
  let totalSamples = 0;
  for (const rt of responseTimes) {
    totalMs += rt.avgResponseTimeMs * rt.sampleCount;
    totalSamples += rt.sampleCount;
  }

  const topModel = winRates.length > 0 ? winRates[0] : null;

  return {
    totalSessions,
    totalQueries,
    avgResponseTimeMs: totalSamples > 0 ? Math.round(totalMs / totalSamples) : 0,
    topModel: topModel?.model ?? null,
    topModelDisplayName: topModel?.displayName ?? null,
  };
}
