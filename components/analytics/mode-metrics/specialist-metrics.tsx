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
import type { SpecialistPanelMetrics } from "@/lib/analytics/types";

interface SpecialistMetricsProps {
  metrics: SpecialistPanelMetrics;
}

export function SpecialistMetrics({ metrics }: SpecialistMetricsProps) {
  const roleData = metrics.roleDistribution.map((r) => ({
    name: r.role,
    count: r.count,
  }));

  if (roleData.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Role Distribution</h3>
          <p className="text-[10px] text-muted-foreground">No role data available</p>
        </CardContent>
      </Card>
    );
  }

  const barHeight = 32;
  const height = Math.max(100, roleData.length * barHeight + 30);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Role Distribution</h3>
        <p className="text-[10px] text-muted-foreground mb-3">Specialist roles assigned across sessions</p>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={roleData} layout="vertical" margin={{ top: 0, right: 30, bottom: 0, left: 0 }}>
            <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(value) => [value ?? 0, "Count"]}
              contentStyle={{ fontSize: 11 }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18}>
              {roleData.map((_, i) => (
                <Cell key={i} fill={getChartColor(i)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
