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
import type { ResponseTimeEntry } from "@/lib/analytics/types";

interface ResponseTimeChartProps {
  data: ResponseTimeEntry[];
}

interface ChartEntry {
  displayName: string;
  avgSeconds: number;
  avgResponseTimeMs: number;
  minResponseTimeMs: number;
  maxResponseTimeMs: number;
  sampleCount: number;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartEntry }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{d.displayName}</p>
      <p className="text-muted-foreground">
        Avg: {formatMs(d.avgResponseTimeMs)} · Min: {formatMs(d.minResponseTimeMs)} · Max:{" "}
        {formatMs(d.maxResponseTimeMs)}
      </p>
      <p className="text-muted-foreground">{d.sampleCount} samples</p>
    </div>
  );
}

export function ResponseTimeChart({ data }: ResponseTimeChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Response Times</h3>
          <p className="text-[10px] text-muted-foreground">No response time data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData: ChartEntry[] = data.map((d) => ({
    displayName: d.displayName,
    avgSeconds: d.avgResponseTimeMs / 1000,
    avgResponseTimeMs: d.avgResponseTimeMs,
    minResponseTimeMs: d.minResponseTimeMs,
    maxResponseTimeMs: d.maxResponseTimeMs,
    sampleCount: d.sampleCount,
  }));

  const barHeight = 36;
  const chartHeight = Math.max(160, chartData.length * barHeight + 40);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Response Times</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          Average Stage 1 response time per model
        </p>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          >
            <XAxis
              type="number"
              tickFormatter={(v: number) => `${v.toFixed(1)}s`}
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              width={120}
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "hsl(var(--muted))" }} />
            <Bar dataKey="avgSeconds" radius={[0, 4, 4, 0]} barSize={20}>
              {chartData.map((_, index) => (
                <Cell key={index} fill={getChartColor(index)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
