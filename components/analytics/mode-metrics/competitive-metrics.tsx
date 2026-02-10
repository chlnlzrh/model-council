"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { getChartColor } from "@/lib/analytics/chart-colors";
import type {
  ModeMetrics,
  CouncilMetrics,
  VoteMetrics,
  DebateMetrics,
  TournamentMetrics,
} from "@/lib/analytics/types";

interface CompetitiveMetricsProps {
  metrics: ModeMetrics;
}

interface WinEntry {
  displayName: string;
  wins: number;
}

function WinnerTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: WinEntry }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{d.displayName}</p>
      <p className="text-muted-foreground">{d.wins} wins</p>
    </div>
  );
}

function WinnerChart({ data, title, subtitle }: { data: WinEntry[]; title: string; subtitle: string }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">{title}</h3>
          <p className="text-[10px] text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  const barHeight = 36;
  const chartHeight = Math.max(120, data.length * barHeight + 40);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">{title}</h3>
        <p className="text-[10px] text-muted-foreground mb-3">{subtitle}</p>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="displayName" width={120} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<WinnerTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
            <Bar dataKey="wins" radius={[0, 4, 4, 0]} barSize={20}>
              {data.map((_, i) => (
                <Cell key={i} fill={getChartColor(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  );
}

export function CompetitiveMetrics({ metrics }: CompetitiveMetricsProps) {
  if (metrics.kind === "council") {
    const m = metrics as CouncilMetrics;
    const data = m.winRates.map((w) => ({ displayName: w.displayName, wins: w.wins }));
    return <WinnerChart data={data} title="Win Rates" subtitle="Times ranked #1 by peers" />;
  }

  if (metrics.kind === "vote") {
    const m = metrics as VoteMetrics;
    return (
      <div className="space-y-3">
        <WinnerChart data={m.winnerDistribution} title="Vote Winners" subtitle="Models selected as best answer" />
        <div className="flex gap-2 flex-wrap">
          <StatBadge label="Tiebreaker Rate" value={`${(m.tiebreakerRate * 100).toFixed(0)}%`} />
          <StatBadge label="Avg Win Margin" value={m.avgWinMargin.toFixed(1)} />
        </div>
      </div>
    );
  }

  if (metrics.kind === "debate") {
    const m = metrics as DebateMetrics;
    return (
      <div className="space-y-3">
        <WinnerChart data={m.winnerDistribution} title="Debate Winners" subtitle="Models winning post-revision vote" />
        <div className="flex gap-2 flex-wrap">
          <StatBadge label="Avg Word Delta" value={`${m.avgWordCountDelta > 0 ? "+" : ""}${m.avgWordCountDelta}`} />
          {m.revisionDecisionDist.map((d) => (
            <StatBadge key={d.decision} label={d.decision} value={d.count.toString()} />
          ))}
        </div>
      </div>
    );
  }

  if (metrics.kind === "tournament") {
    const m = metrics as TournamentMetrics;
    return (
      <div className="space-y-3">
        <WinnerChart data={m.championDistribution} title="Champions" subtitle="Tournament winners" />
        {m.matchupWinRates.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="text-xs font-semibold mb-2">Matchup Win Rates</h3>
              <div className="space-y-1.5">
                {m.matchupWinRates.map((w) => (
                  <div key={w.model} className="flex items-center gap-2 text-xs">
                    <span className="truncate flex-1 text-muted-foreground">{w.displayName}</span>
                    <span className="font-medium">{(w.winRate * 100).toFixed(0)}%</span>
                    <span className="text-[10px] text-muted-foreground">({w.matches} matches)</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return null;
}
