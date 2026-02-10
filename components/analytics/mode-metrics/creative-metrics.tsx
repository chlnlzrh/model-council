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
import type { BrainstormMetrics } from "@/lib/analytics/types";

interface CreativeMetricsProps {
  metrics: BrainstormMetrics;
}

export function CreativeMetrics({ metrics }: CreativeMetricsProps) {
  const scoreData = metrics.clusterScoreAverages.map((d) => ({
    name: d.dimension,
    avgScore: d.avgScore,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
        <span className="text-[10px] text-muted-foreground">Avg Ideas Per Session</span>
        <span className="text-xs font-semibold">{metrics.avgIdeaCount}</span>
      </div>

      {scoreData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold mb-3">Cluster Scores</h3>
            <ResponsiveContainer width="100%" height={Math.max(100, scoreData.length * 32 + 30)}>
              <BarChart data={scoreData} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => [typeof value === "number" ? value.toFixed(1) : "0", "Score"]}
                  contentStyle={{ fontSize: 11 }}
                />
                <Bar dataKey="avgScore" radius={[0, 4, 4, 0]} barSize={18}>
                  {scoreData.map((_, i) => (
                    <Cell key={i} fill={getChartColor(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
