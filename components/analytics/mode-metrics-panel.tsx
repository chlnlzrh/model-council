"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { ModeSelector } from "@/components/analytics/mode-selector";
import { useModeAnalytics } from "@/hooks/use-analytics";
import type { DatePreset, ModeMetrics } from "@/lib/analytics/types";

const CompetitiveMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/competitive-metrics").then((m) => m.CompetitiveMetrics),
  { ssr: false }
);
const ScoringMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/scoring-metrics").then((m) => m.ScoringMetrics),
  { ssr: false }
);
const ConvergenceMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/convergence-metrics").then((m) => m.ConvergenceMetrics),
  { ssr: false }
);
const SequentialMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/sequential-metrics").then((m) => m.SequentialMetrics),
  { ssr: false }
);
const CreativeMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/creative-metrics").then((m) => m.CreativeMetrics),
  { ssr: false }
);
const AdversarialMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/adversarial-metrics").then((m) => m.AdversarialMetrics),
  { ssr: false }
);
const VerificationMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/verification-metrics").then((m) => m.VerificationMetrics),
  { ssr: false }
);
const SpecialistMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/specialist-metrics").then((m) => m.SpecialistMetrics),
  { ssr: false }
);
const GenericMetrics = dynamic(
  () => import("@/components/analytics/mode-metrics/generic-metrics").then((m) => m.GenericMetrics),
  { ssr: false }
);

interface ModeMetricsPanelProps {
  preset: DatePreset;
}

function MetricsSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-2 w-48" />
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

function renderMetrics(metrics: ModeMetrics) {
  switch (metrics.kind) {
    case "council":
    case "vote":
    case "debate":
    case "tournament":
      return <CompetitiveMetrics metrics={metrics} />;
    case "jury":
    case "peer_review":
      return <ScoringMetrics metrics={metrics} />;
    case "delphi":
    case "confidence_weighted":
      return <ConvergenceMetrics metrics={metrics} />;
    case "chain":
    case "blueprint":
    case "decompose":
      return <SequentialMetrics metrics={metrics} />;
    case "brainstorm":
      return <CreativeMetrics metrics={metrics} />;
    case "red_team":
      return <AdversarialMetrics metrics={metrics} />;
    case "fact_check":
      return <VerificationMetrics metrics={metrics} />;
    case "specialist_panel":
      return <SpecialistMetrics metrics={metrics} />;
    default:
      return <GenericMetrics />;
  }
}

export function ModeMetricsPanel({ preset }: ModeMetricsPanelProps) {
  const [selectedMode, setSelectedMode] = useState<string | null>("council");
  const { data, loading, error } = useModeAnalytics(preset, selectedMode);

  return (
    <div className="space-y-4">
      <ModeSelector selected={selectedMode} onSelect={setSelectedMode} />

      {loading && <MetricsSkeleton />}

      {!loading && error && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && data && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold">{data.modeName}</h3>
            <span className="text-[10px] text-muted-foreground">
              {data.queryCount} stage{data.queryCount !== 1 ? "s" : ""} recorded
            </span>
          </div>
          {renderMetrics(data.metrics)}
        </div>
      )}

      {!loading && !error && !data && selectedMode && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">
              Select a mode to view detailed metrics.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
