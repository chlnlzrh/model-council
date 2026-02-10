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
  ExtendedAnalyticsSummary,
  ModeDistributionEntry,
  CrossModeModelEntry,
  CrossModeModelModeEntry,
  RawRankingRow,
  RawLabelMapRow,
  RawResponseTimeRow,
  RawMessageDateRow,
} from "./types";
import { MODE_REGISTRY } from "@/lib/council/modes/index";

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

// ---------------------------------------------------------------------------
// Mode Distribution
// ---------------------------------------------------------------------------

export function computeModeDistribution(
  modeCounts: Array<{ mode: string; count: number }>
): ModeDistributionEntry[] {
  const total = modeCounts.reduce((sum, m) => sum + m.count, 0);
  if (total === 0) return [];

  return modeCounts
    .map((m) => ({
      mode: m.mode,
      displayName:
        MODE_REGISTRY[m.mode as keyof typeof MODE_REGISTRY]?.name ?? m.mode,
      count: m.count,
      percentage: m.count / total,
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Extended Summary
// ---------------------------------------------------------------------------

export function computeExtendedSummary(
  totalSessions: number,
  totalQueries: number,
  responseTimes: ResponseTimeEntry[],
  winRates: WinRateEntry[],
  modeDistribution: ModeDistributionEntry[]
): ExtendedAnalyticsSummary {
  const base = computeSummary(totalSessions, totalQueries, responseTimes, winRates);
  const mostActive = modeDistribution.length > 0 ? modeDistribution[0] : null;

  return {
    ...base,
    modesUsed: modeDistribution.length,
    mostActiveMode: mostActive?.mode ?? null,
    mostActiveModeDisplayName: mostActive?.displayName ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cross-Mode Response Times → CrossModeModelEntry[]
// ---------------------------------------------------------------------------

export function computeCrossModeResponseTimes(
  rows: Array<{ model: string | null; responseTimeMs: number | null; mode: string }>
): CrossModeModelEntry[] {
  // Group by (model, mode) → {sum, count}
  const grouped = new Map<string, Map<string, { sum: number; count: number }>>();

  for (const row of rows) {
    if (!row.model || row.responseTimeMs == null) continue;

    if (!grouped.has(row.model)) {
      grouped.set(row.model, new Map());
    }
    const modeMap = grouped.get(row.model)!;
    const existing = modeMap.get(row.mode);
    if (existing) {
      existing.sum += row.responseTimeMs;
      existing.count++;
    } else {
      modeMap.set(row.mode, { sum: row.responseTimeMs, count: 1 });
    }
  }

  const entries: CrossModeModelEntry[] = [];

  for (const [model, modeMap] of grouped) {
    const modes: CrossModeModelModeEntry[] = [];
    let totalSessions = 0;
    let totalMs = 0;
    let totalSamples = 0;

    for (const [mode, stats] of modeMap) {
      const avgMs = Math.round(stats.sum / stats.count);
      modes.push({
        mode,
        sessions: stats.count,
        avgResponseTimeMs: avgMs,
      });
      totalSessions += stats.count;
      totalMs += stats.sum;
      totalSamples += stats.count;
    }

    // Composite score: inverse of avg response time, normalized 0-100
    const avgResponseMs = totalSamples > 0 ? totalMs / totalSamples : 0;
    // Score: faster = higher. Cap at 60s → 0 score.
    const overallScore =
      avgResponseMs > 0
        ? Math.round(Math.max(0, 100 - (avgResponseMs / 60000) * 100))
        : 0;

    entries.push({
      model,
      displayName: getModelDisplayName(model),
      modes: modes.sort((a, b) => a.mode.localeCompare(b.mode)),
      overallScore,
      totalSessions,
    });
  }

  return entries.sort((a, b) => b.overallScore - a.overallScore);
}
