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
import type { RedTeamMetrics } from "@/lib/analytics/types";

interface AdversarialMetricsProps {
  metrics: RedTeamMetrics;
}

export function AdversarialMetrics({ metrics }: AdversarialMetricsProps) {
  const severityData = metrics.severityDistribution.map((d) => ({
    name: d.severity,
    count: d.count,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
        <span className="text-[10px] text-muted-foreground">Defense Accept Rate</span>
        <span className="text-xs font-semibold">{(metrics.defenseAcceptRate * 100).toFixed(0)}%</span>
      </div>

      {severityData.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-xs font-semibold mb-3">Attack Severity</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={severityData} margin={{ top: 0, right: 10, bottom: 0, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => [value ?? 0, "Count"]}
                  contentStyle={{ fontSize: 11 }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={30}>
                  {severityData.map((_, i) => (
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
