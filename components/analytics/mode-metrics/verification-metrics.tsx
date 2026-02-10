"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { getChartColor } from "@/lib/analytics/chart-colors";
import type { FactCheckMetrics } from "@/lib/analytics/types";

interface VerificationMetricsProps {
  metrics: FactCheckMetrics;
}

function DistTooltip({
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
      <p className="text-muted-foreground">{d.count}</p>
    </div>
  );
}

function MiniDonut({ data, title }: { data: Array<{ name: string; count: number }>; title: string }) {
  if (data.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-3">{title}</h3>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="45%" height={130}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={25}
                outerRadius={50}
                dataKey="count"
                nameKey="name"
                paddingAngle={2}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={getChartColor(i)} />
                ))}
              </Pie>
              <Tooltip content={<DistTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-1">
            {data.map((d, i) => (
              <div key={d.name} className="flex items-center gap-2 text-xs">
                <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: getChartColor(i) }} />
                <span className="truncate text-muted-foreground">{d.name}</span>
                <span className="ml-auto font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function VerificationMetrics({ metrics }: VerificationMetricsProps) {
  const claimData = metrics.claimTypeDistribution.map((c) => ({
    name: c.type,
    count: c.count,
  }));
  const verdictData = metrics.verdictDistribution.map((v) => ({
    name: v.verdict,
    count: v.count,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
        <span className="text-[10px] text-muted-foreground">Avg Agreement Rate</span>
        <span className="text-xs font-semibold">{(metrics.avgAgreementRate * 100).toFixed(0)}%</span>
      </div>
      <MiniDonut data={claimData} title="Claim Types" />
      <MiniDonut data={verdictData} title="Verdicts" />
    </div>
  );
}
