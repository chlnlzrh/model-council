"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useOverviewAnalytics } from "@/hooks/use-analytics";
import { DateRangeSelect } from "@/components/analytics/date-range-select";
import { UsageStats } from "@/components/analytics/usage-stats";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";
import { AnalyticsEmpty } from "@/components/analytics/analytics-empty";
import { ModeMetricsPanel } from "@/components/analytics/mode-metrics-panel";
import type { DatePreset, CrossModeModelEntry } from "@/lib/analytics/types";

const WinRateChart = dynamic(
  () =>
    import("@/components/analytics/win-rate-chart").then(
      (mod) => mod.WinRateChart
    ),
  { ssr: false }
);

const ResponseTimeChart = dynamic(
  () =>
    import("@/components/analytics/response-time-chart").then(
      (mod) => mod.ResponseTimeChart
    ),
  { ssr: false }
);

const DailyUsageChart = dynamic(
  () =>
    import("@/components/analytics/daily-usage-chart").then(
      (mod) => mod.DailyUsageChart
    ),
  { ssr: false }
);

const ModeDistributionChart = dynamic(
  () =>
    import("@/components/analytics/mode-distribution-chart").then(
      (mod) => mod.ModeDistributionChart
    ),
  { ssr: false }
);

const ModelLeaderboard = dynamic(
  () =>
    import("@/components/analytics/model-leaderboard").then(
      (mod) => mod.ModelLeaderboard
    ),
  { ssr: false }
);

const ModelModeHeatmap = dynamic(
  () =>
    import("@/components/analytics/model-mode-heatmap").then(
      (mod) => mod.ModelModeHeatmap
    ),
  { ssr: false }
);

function AnalyticsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [preset, setPreset] = useState<DatePreset>("30d");
  const [tab, setTab] = useState(searchParams.get("tab") ?? "overview");

  const handleTabChange = useCallback(
    (value: string) => {
      setTab(value);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", value);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  const {
    data: overviewData,
    loading: overviewLoading,
    error: overviewError,
    retry: retryOverview,
  } = useOverviewAnalytics(preset);

  const [modelsData, setModelsData] = useState<{ models: CrossModeModelEntry[] } | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (tab !== "models") return;
    setModelsLoading(true);
    fetch(`/api/analytics?preset=${preset}&view=models`)
      .then((r) => r.json())
      .then((d) => setModelsData(d))
      .catch(() => setModelsData(null))
      .finally(() => setModelsLoading(false));
  }, [tab, preset]);

  const isEmpty =
    !overviewLoading &&
    !overviewError &&
    overviewData &&
    overviewData.summary.totalQueries === 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/council">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-sm font-bold">Analytics</h1>
              <p className="text-xs text-muted-foreground">
                Model performance and usage insights
              </p>
            </div>
          </div>
          <DateRangeSelect value={preset} onChange={setPreset} />
        </div>

        {/* Loading */}
        {overviewLoading && <AnalyticsSkeleton />}

        {/* Error */}
        {!overviewLoading && overviewError && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">Failed to load analytics</p>
                <p className="text-[10px] text-muted-foreground">{overviewError}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={retryOverview}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Empty */}
        {isEmpty && <AnalyticsEmpty />}

        {/* Populated — Tabbed Layout */}
        {!overviewLoading && !overviewError && overviewData && overviewData.summary.totalQueries > 0 && (
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList className="text-xs">
              <TabsTrigger value="overview" className="text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="modes" className="text-xs">
                Mode Deep Dive
              </TabsTrigger>
              <TabsTrigger value="models" className="text-xs">
                Model Comparison
              </TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <UsageStats summary={overviewData.summary} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <DailyUsageChart data={overviewData.dailyUsage} />
                <ModeDistributionChart data={overviewData.modeDistribution} />
              </div>
              <WinRateChart data={overviewData.winRates} />
              <ResponseTimeChart data={overviewData.responseTimes} />
            </TabsContent>

            {/* Mode Deep Dive Tab */}
            <TabsContent value="modes" className="mt-4">
              <ModeMetricsPanel preset={preset} />
            </TabsContent>

            {/* Model Comparison Tab */}
            <TabsContent value="models" className="space-y-4 mt-4">
              {modelsLoading && <AnalyticsSkeleton />}
              {!modelsLoading && modelsData && (
                <>
                  <ModelLeaderboard data={modelsData.models} />
                  <ModelModeHeatmap data={modelsData.models} />
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="flex-1 overflow-y-auto px-4 py-6"><div className="mx-auto max-w-3xl"><AnalyticsSkeleton /></div></div>}>
      <AnalyticsContent />
    </Suspense>
  );
}
