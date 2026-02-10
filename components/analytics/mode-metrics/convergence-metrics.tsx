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
import type { ModeMetrics, DelphiMetrics, ConfidenceMetrics } from "@/lib/analytics/types";

interface ConvergenceMetricsProps {
  metrics: ModeMetrics;
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  );
}

function BucketChart({ data, title }: { data: Array<{ bucket: string; count: number }>; title: string }) {
  if (data.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-3">{title}</h3>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
            <XAxis dataKey="bucket" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              formatter={(value) => [value ?? 0, "Count"]}
              contentStyle={{ fontSize: 11 }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={30}>
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

export function ConvergenceMetrics({ metrics }: ConvergenceMetricsProps) {
  if (metrics.kind === "delphi") {
    const m = metrics as DelphiMetrics;
    return (
      <div className="space-y-3">
        <StatBadge label="Avg Convergence Rounds" value={m.avgConvergenceRounds.toString()} />
        <BucketChart data={m.confidenceDistribution} title="Confidence Distribution" />
      </div>
    );
  }

  if (metrics.kind === "confidence_weighted") {
    const m = metrics as ConfidenceMetrics;
    return (
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <StatBadge label="Avg Confidence" value={`${(m.avgConfidence * 100).toFixed(0)}%`} />
          <StatBadge label="Outlier Rate" value={`${(m.outlierRate * 100).toFixed(0)}%`} />
        </div>
        <BucketChart data={m.confidenceHistogram} title="Confidence Histogram" />
      </div>
    );
  }

  return null;
}
