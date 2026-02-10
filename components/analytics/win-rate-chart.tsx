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
import type { WinRateEntry } from "@/lib/analytics/types";

interface WinRateChartProps {
  data: WinRateEntry[];
}

interface ChartEntry {
  displayName: string;
  winRate: number;
  wins: number;
  totalAppearances: number;
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
        Win rate: {(d.winRate * 100).toFixed(0)}% ({d.wins}/{d.totalAppearances})
      </p>
    </div>
  );
}

export function WinRateChart({ data }: WinRateChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Win Rates</h3>
          <p className="text-[10px] text-muted-foreground">No ranking data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData: ChartEntry[] = data.map((d) => ({
    displayName: d.displayName,
    winRate: d.winRate,
    wins: d.wins,
    totalAppearances: d.totalAppearances,
  }));

  const barHeight = 36;
  const chartHeight = Math.max(160, chartData.length * barHeight + 40);

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Win Rates</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          How often each model is ranked #1 by peers
        </p>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
          >
            <XAxis
              type="number"
              domain={[0, 1]}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
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
            <Bar dataKey="winRate" radius={[0, 4, 4, 0]} barSize={20}>
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
