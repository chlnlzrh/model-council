"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { getChartColor } from "@/lib/analytics/chart-colors";
import type { ModeDistributionEntry } from "@/lib/analytics/types";

interface ModeDistributionChartProps {
  data: ModeDistributionEntry[];
}

interface ChartEntry {
  displayName: string;
  count: number;
  percentage: number;
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
        {d.count} sessions ({(d.percentage * 100).toFixed(0)}%)
      </p>
    </div>
  );
}

export function ModeDistributionChart({ data }: ModeDistributionChartProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Mode Distribution</h3>
          <p className="text-[10px] text-muted-foreground">No mode data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData: ChartEntry[] = data.map((d) => ({
    displayName: d.displayName,
    count: d.count,
    percentage: d.percentage,
  }));

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Mode Distribution</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          Session count by deliberation mode
        </p>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="50%" height={180}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={40}
                outerRadius={70}
                dataKey="count"
                nameKey="displayName"
                paddingAngle={2}
              >
                {chartData.map((_, index) => (
                  <Cell key={index} fill={getChartColor(index)} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1">
            {chartData.slice(0, 6).map((d, i) => (
              <div key={d.displayName} className="flex items-center gap-2 text-xs">
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getChartColor(i) }}
                />
                <span className="truncate text-muted-foreground">{d.displayName}</span>
                <span className="ml-auto font-medium">{d.count}</span>
              </div>
            ))}
            {chartData.length > 6 && (
              <p className="text-[10px] text-muted-foreground">
                +{chartData.length - 6} more
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
