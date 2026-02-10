"use client";

import { Activity, MessageSquare, Clock, Trophy, Layers, Flame } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { AnalyticsSummary, ExtendedAnalyticsSummary } from "@/lib/analytics/types";

interface UsageStatsProps {
  summary: AnalyticsSummary | ExtendedAnalyticsSummary;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function isExtended(s: AnalyticsSummary): s is ExtendedAnalyticsSummary {
  return "modesUsed" in s;
}

const BASE_CARDS = [
  {
    key: "sessions" as const,
    label: "Sessions",
    icon: Activity,
    getValue: (s: AnalyticsSummary) => s.totalSessions.toString(),
  },
  {
    key: "queries" as const,
    label: "Queries",
    icon: MessageSquare,
    getValue: (s: AnalyticsSummary) => s.totalQueries.toString(),
  },
  {
    key: "avgTime" as const,
    label: "Avg Response",
    icon: Clock,
    getValue: (s: AnalyticsSummary) =>
      s.avgResponseTimeMs > 0 ? formatMs(s.avgResponseTimeMs) : "—",
  },
  {
    key: "topModel" as const,
    label: "Top Model",
    icon: Trophy,
    getValue: (s: AnalyticsSummary) => s.topModelDisplayName ?? "—",
  },
];

const EXTENDED_CARDS = [
  {
    key: "modesUsed" as const,
    label: "Modes Used",
    icon: Layers,
    getValue: (s: ExtendedAnalyticsSummary) => s.modesUsed.toString(),
  },
  {
    key: "mostActive" as const,
    label: "Most Active",
    icon: Flame,
    getValue: (s: ExtendedAnalyticsSummary) => s.mostActiveModeDisplayName ?? "—",
  },
];

export function UsageStats({ summary }: UsageStatsProps) {
  const extended = isExtended(summary);
  const cards = extended
    ? [...BASE_CARDS, ...EXTENDED_CARDS]
    : BASE_CARDS;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.key}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <card.icon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground">{card.label}</p>
              <p className="text-sm font-bold truncate" title={card.getValue(summary as never)}>
                {card.getValue(summary as never)}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
