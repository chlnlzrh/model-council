"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { getChartColor } from "@/lib/analytics/chart-colors";
import type { ModeMetrics, JuryMetrics, PeerReviewMetrics } from "@/lib/analytics/types";

interface ScoringMetricsProps {
  metrics: ModeMetrics;
}

function DistributionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; count: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{d.name}</p>
      <p className="text-muted-foreground">{d.count} occurrences</p>
    </div>
  );
}

function ScoreBar({ data, title }: { data: Array<{ name: string; avgScore: number }>; title: string }) {
  if (data.length === 0) return null;
  const barHeight = 32;
  const height = Math.max(100, data.length * barHeight + 30);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-3">{title}</h3>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => [typeof value === "number" ? value.toFixed(1) : "0", "Score"]}
              contentStyle={{ fontSize: 11 }}
            />
            <Bar dataKey="avgScore" radius={[0, 4, 4, 0]} barSize={18}>
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

export function ScoringMetrics({ metrics }: ScoringMetricsProps) {
  if (metrics.kind === "jury") {
    const m = metrics as JuryMetrics;
    const verdictData = m.verdictDistribution.map((v) => ({
      name: v.verdict,
      count: v.count,
    }));
    const dimensionData = m.dimensionAverages.map((d) => ({
      name: d.dimension,
      avgScore: d.avgScore,
    }));

    return (
      <div className="space-y-3">
        {verdictData.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="text-xs font-semibold mb-0.5">Verdict Distribution</h3>
              <p className="text-[10px] text-muted-foreground mb-3">Jury final verdicts</p>
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={140}>
                  <PieChart>
                    <Pie
                      data={verdictData}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={55}
                      dataKey="count"
                      nameKey="name"
                      paddingAngle={2}
                    >
                      {verdictData.map((_, i) => (
                        <Cell key={i} fill={getChartColor(i)} />
                      ))}
                    </Pie>
                    <Tooltip content={<DistributionTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1">
                  {verdictData.map((d, i) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: getChartColor(i) }} />
                      <span className="truncate text-muted-foreground">{d.name}</span>
                      <span className="ml-auto font-medium">{d.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        <ScoreBar data={dimensionData} title="Dimension Averages" />
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
          <span className="text-[10px] text-muted-foreground">Juror Consensus</span>
          <span className="text-xs font-semibold">{(m.jurorConsensusRate * 100).toFixed(0)}%</span>
        </div>
      </div>
    );
  }

  if (metrics.kind === "peer_review") {
    const m = metrics as PeerReviewMetrics;
    const severityData = m.findingSeverityDist.map((s) => ({
      name: s.severity,
      count: s.count,
    }));
    const rubricData = m.rubricScoreAverages.map((r) => ({
      name: r.criterion,
      avgScore: r.avgScore,
    }));

    return (
      <div className="space-y-3">
        {severityData.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="text-xs font-semibold mb-2">Finding Severity</h3>
              <div className="space-y-1.5">
                {severityData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: getChartColor(i) }} />
                    <span className="truncate flex-1 text-muted-foreground">{d.name}</span>
                    <span className="font-medium">{d.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <ScoreBar data={rubricData} title="Rubric Score Averages" />
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
          <span className="text-[10px] text-muted-foreground">Consensus Rate</span>
          <span className="text-xs font-semibold">{(m.consensusRate * 100).toFixed(0)}%</span>
        </div>
      </div>
    );
  }

  return null;
}
