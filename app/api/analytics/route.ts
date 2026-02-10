/**
 * GET /api/analytics — Aggregated analytics for the authenticated user.
 *
 * Query params:
 *   preset — "7d" | "30d" | "90d" | "all" (default: "30d")
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  getStage2DataForUser,
  getStage1TimesForUser,
  getUsageStatsForUser,
} from "@/lib/db/queries";
import {
  computeWinRates,
  computeResponseTimes,
  computeDailyUsage,
  computeSummary,
  presetToDate,
  isValidPreset,
} from "@/lib/analytics/compute";
import type { AnalyticsData, DatePreset } from "@/lib/analytics/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const presetParam = request.nextUrl.searchParams.get("preset") ?? "30d";
  const preset: DatePreset = isValidPreset(presetParam) ? presetParam : "30d";
  const fromDate = presetToDate(preset);

  const [stage2Data, stage1Times, usageStats] = await Promise.all([
    getStage2DataForUser(session.user.id, fromDate),
    getStage1TimesForUser(session.user.id, fromDate),
    getUsageStatsForUser(session.user.id, fromDate),
  ]);

  const winRates = computeWinRates(stage2Data.rankings, stage2Data.labelMaps);
  const responseTimes = computeResponseTimes(stage1Times);
  const dailyUsage = computeDailyUsage(usageStats.messageDates);
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
    dateRange: {
      from: fromDate?.toISOString() ?? null,
      to: new Date().toISOString(),
      preset,
    },
  };

  return NextResponse.json(data);
}
