"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import type {
  ModeMetrics,
  ChainMetrics,
  BlueprintMetrics,
  DecomposeMetrics,
} from "@/lib/analytics/types";

interface SequentialMetricsProps {
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

export function SequentialMetrics({ metrics }: SequentialMetricsProps) {
  if (metrics.kind === "chain") {
    const m = metrics as ChainMetrics;
    const progressionData = m.avgWordCountProgression.map((p) => ({
      step: `Step ${p.step}`,
      words: p.avgWordCount,
    }));

    return (
      <div className="space-y-3">
        {progressionData.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="text-xs font-semibold mb-0.5">Word Count Progression</h3>
              <p className="text-[10px] text-muted-foreground mb-3">Average word count at each chain step</p>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={progressionData} margin={{ top: 4, right: 10, bottom: 0, left: -20 }}>
                  <XAxis dataKey="step" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) => [`${value ?? 0} words`, "Avg Words"]}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="words" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
        <div className="flex gap-2 flex-wrap">
          <StatBadge label="Skip Rate" value={`${(m.skipRate * 100).toFixed(0)}%`} />
          {m.mandateDistribution.slice(0, 3).map((d) => (
            <StatBadge key={d.mandate} label={d.mandate} value={d.count.toString()} />
          ))}
        </div>
      </div>
    );
  }

  if (metrics.kind === "blueprint") {
    const m = metrics as BlueprintMetrics;
    return (
      <div className="flex gap-2 flex-wrap">
        <StatBadge label="Avg Sections" value={m.avgSectionCount.toString()} />
        <StatBadge label="Avg Words" value={m.avgWordCount.toString()} />
        <StatBadge label="TODO Rate" value={`${(m.todoMarkerRate * 100).toFixed(0)}%`} />
      </div>
    );
  }

  if (metrics.kind === "decompose") {
    const m = metrics as DecomposeMetrics;
    return (
      <div className="flex gap-2 flex-wrap">
        <StatBadge label="Parallelism Efficiency" value={`${(m.avgParallelismEfficiency * 100).toFixed(0)}%`} />
        <StatBadge label="Task Success Rate" value={`${(m.taskSuccessRate * 100).toFixed(0)}%`} />
        <StatBadge label="Avg Waves" value={m.avgWaveCount.toString()} />
      </div>
    );
  }

  return null;
}
