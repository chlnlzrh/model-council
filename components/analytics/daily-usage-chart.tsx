"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import type { DailyUsageEntry } from "@/lib/analytics/types";

interface DailyUsageChartProps {
  data: DailyUsageEntry[];
}

interface ChartEntry {
  date: string;
  shortDate: string;
  queryCount: number;
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
      <p className="font-semibold">{d.date}</p>
      <p className="text-muted-foreground">
        {d.queryCount} {d.queryCount === 1 ? "query" : "queries"}
      </p>
    </div>
  );
}

export function DailyUsageChart({ data }: DailyUsageChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Daily Usage</h3>
          <p className="text-[10px] text-muted-foreground">No usage data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData: ChartEntry[] = data.map((d) => ({
    date: d.date,
    shortDate: d.date.slice(5), // "02-01"
    queryCount: d.queryCount,
  }));

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Daily Usage</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          Queries per day over time
        </p>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart
            data={chartData}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
          >
            <defs>
              <linearGradient id="usageGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="shortDate"
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="queryCount"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#usageGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
