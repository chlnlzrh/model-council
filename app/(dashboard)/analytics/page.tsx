"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAnalytics } from "@/hooks/use-analytics";
import { DateRangeSelect } from "@/components/analytics/date-range-select";
import { UsageStats } from "@/components/analytics/usage-stats";
import { AnalyticsSkeleton } from "@/components/analytics/analytics-skeleton";
import { AnalyticsEmpty } from "@/components/analytics/analytics-empty";

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

export default function AnalyticsPage() {
  const { data, loading, error, preset, setPreset, retry } = useAnalytics();

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
        {loading && <AnalyticsSkeleton />}

        {/* Error */}
        {!loading && error && (
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold">Failed to load analytics</p>
                <p className="text-[10px] text-muted-foreground">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7"
                onClick={retry}
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Empty */}
        {!loading && !error && data && data.summary.totalQueries === 0 && (
          <AnalyticsEmpty />
        )}

        {/* Populated */}
        {!loading && !error && data && data.summary.totalQueries > 0 && (
          <>
            <UsageStats summary={data.summary} />
            <WinRateChart data={data.winRates} />
            <ResponseTimeChart data={data.responseTimes} />
          </>
        )}
      </div>
    </div>
  );
}
