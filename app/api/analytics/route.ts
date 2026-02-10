/**
 * GET /api/analytics — Aggregated analytics for the authenticated user.
 *
 * Query params:
 *   preset — "7d" | "30d" | "90d" | "all" (default: "30d")
 *   view   — "overview" | "mode" | "models" (optional, omit for legacy response)
 *   mode   — DeliberationMode string (required when view=mode)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getStage2DataForUser,
  getStage1TimesForUser,
  getUsageStatsForUser,
  getModeDistributionForUser,
  getDeliberationStagesForAnalytics,
  getDeliberationResponseTimesForUser,
} from "@/lib/db/queries";
import {
  computeWinRates,
  computeResponseTimes,
  computeDailyUsage,
  computeSummary,
  computeExtendedSummary,
  computeModeDistribution,
  computeCrossModeResponseTimes,
  presetToDate,
  isValidPreset,
} from "@/lib/analytics/compute";
import { computeMetricsForMode } from "@/lib/analytics/mode-compute";
import { MODE_REGISTRY } from "@/lib/council/modes/index";
import type { AnalyticsData, DatePreset } from "@/lib/analytics/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const presetParam = params.get("preset") ?? "30d";
  const preset: DatePreset = isValidPreset(presetParam) ? presetParam : "30d";
  const fromDate = presetToDate(preset);
  const view = params.get("view");
  const modeParam = params.get("mode");

  // -------------------------------------------------------------------------
  // View: mode — per-mode deep dive
  // -------------------------------------------------------------------------
  if (view === "mode") {
    if (!modeParam || !(modeParam in MODE_REGISTRY)) {
      return NextResponse.json({ error: "Invalid mode parameter" }, { status: 400 });
    }

    const [stages, delibTimes, usageStats] = await Promise.all([
      getDeliberationStagesForAnalytics(session.user.id, fromDate, modeParam),
      getDeliberationResponseTimesForUser(session.user.id, fromDate),
      getUsageStatsForUser(session.user.id, fromDate),
    ]);

    // Filter response times to this mode
    const modeTimesRaw = delibTimes
      .filter((r) => r.mode === modeParam && r.model && r.responseTimeMs != null)
      .map((r) => ({ model: r.model!, responseTimeMs: r.responseTimeMs }));

    const responseTimes = computeResponseTimes(modeTimesRaw);
    const metrics = computeMetricsForMode(modeParam, stages);
    const modeDef = MODE_REGISTRY[modeParam as keyof typeof MODE_REGISTRY];

    return NextResponse.json({
      mode: modeParam,
      modeName: modeDef?.name ?? modeParam,
      queryCount: stages.length,
      responseTimes,
      metrics,
    });
  }

  // -------------------------------------------------------------------------
  // View: models — cross-mode model comparison
  // -------------------------------------------------------------------------
  if (view === "models") {
    const [delibTimes, stage1Times] = await Promise.all([
      getDeliberationResponseTimesForUser(session.user.id, fromDate),
      getStage1TimesForUser(session.user.id, fromDate),
    ]);

    // Merge council stage1 times (tagged as "council" mode)
    const allTimes = [
      ...delibTimes.map((r) => ({
        model: r.model,
        responseTimeMs: r.responseTimeMs,
        mode: r.mode,
      })),
      ...stage1Times.map((r) => ({
        model: r.model,
        responseTimeMs: r.responseTimeMs,
        mode: "council",
      })),
    ];

    const models = computeCrossModeResponseTimes(allTimes);
    return NextResponse.json({ models });
  }

  // -------------------------------------------------------------------------
  // Default + overview: full analytics payload
  // -------------------------------------------------------------------------
  const [stage2Data, stage1Times, usageStats, modeDistRaw] = await Promise.all([
    getStage2DataForUser(session.user.id, fromDate),
    getStage1TimesForUser(session.user.id, fromDate),
    getUsageStatsForUser(session.user.id, fromDate),
    getModeDistributionForUser(session.user.id, fromDate),
  ]);

  const winRates = computeWinRates(stage2Data.rankings, stage2Data.labelMaps);
  const responseTimes = computeResponseTimes(stage1Times);
  const dailyUsage = computeDailyUsage(usageStats.messageDates);
  const modeDistribution = computeModeDistribution(modeDistRaw);

  const dateRange = {
    from: fromDate?.toISOString() ?? null,
    to: new Date().toISOString(),
    preset,
  };

  // If view=overview, return extended payload with mode distribution
  if (view === "overview") {
    const summary = computeExtendedSummary(
      usageStats.totalSessions,
      usageStats.messageDates.length,
      responseTimes,
      winRates,
      modeDistribution
    );

    // Cross-mode model data for overview
    const delibTimes = await getDeliberationResponseTimesForUser(session.user.id, fromDate);
    const allTimes = [
      ...delibTimes.map((r) => ({
        model: r.model,
        responseTimeMs: r.responseTimeMs,
        mode: r.mode,
      })),
      ...stage1Times.map((r) => ({
        model: r.model,
        responseTimeMs: r.responseTimeMs,
        mode: "council",
      })),
    ];
    const crossModeModels = computeCrossModeResponseTimes(allTimes);

    return NextResponse.json({
      winRates,
      responseTimes,
      dailyUsage,
      summary,
      dateRange,
      modeDistribution,
      crossModeModels,
    });
  }

  // Legacy response (no view param)
  const summary = computeSummary(
    usageStats.totalSessions,
    usageStats.messageDates.length,
    responseTimes,
    winRates
  );

  const data: AnalyticsData = {
    winRates,
    responseTimes,
    dailyUsage,
    summary,
    dateRange,
  };

  return NextResponse.json(data);
}
