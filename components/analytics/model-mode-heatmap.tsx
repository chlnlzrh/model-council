"use client";

import { Card, CardContent } from "@/components/ui/card";
import { MODE_REGISTRY } from "@/lib/council/modes/index";
import type { CrossModeModelEntry } from "@/lib/analytics/types";

interface ModelModeHeatmapProps {
  data: CrossModeModelEntry[];
}

function getHeatColor(ms: number): string {
  // Green (fast) → Yellow (medium) → Red (slow)
  // <5s = green, 5-15s = yellow, >15s = red
  if (ms <= 5000) {
    const ratio = ms / 5000;
    const r = Math.round(ratio * 234);
    const g = Math.round(179 + (1 - ratio) * 76);
    return `rgb(${r}, ${g}, 100)`;
  }
  if (ms <= 15000) {
    const ratio = (ms - 5000) / 10000;
    const r = Math.round(234 + ratio * 21);
    const g = Math.round(179 - ratio * 111);
    return `rgb(${r}, ${g}, ${Math.round(68 * (1 - ratio))})`;
  }
  return "#ef4444";
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ModelModeHeatmap({ data }: ModelModeHeatmapProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Response Time Heatmap</h3>
          <p className="text-[10px] text-muted-foreground">No data available</p>
        </CardContent>
      </Card>
    );
  }

  // Collect all unique modes across all models
  const allModes = new Set<string>();
  for (const entry of data) {
    for (const m of entry.modes) {
      allModes.add(m.mode);
    }
  }
  const modeList = [...allModes].sort();

  // Build lookup: model → mode → avgResponseTimeMs
  const lookup = new Map<string, Map<string, number>>();
  for (const entry of data) {
    const modeMap = new Map<string, number>();
    for (const m of entry.modes) {
      modeMap.set(m.mode, m.avgResponseTimeMs);
    }
    lookup.set(entry.model, modeMap);
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Response Time Heatmap</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          Average response time by model and mode (green=fast, red=slow)
        </p>

        <div className="overflow-x-auto">
          <div
            className="grid gap-px"
            style={{
              gridTemplateColumns: `120px repeat(${modeList.length}, minmax(50px, 1fr))`,
            }}
          >
            {/* Header row */}
            <div />
            {modeList.map((mode) => (
              <div
                key={mode}
                className="text-center text-[9px] text-muted-foreground font-medium py-1 truncate px-0.5"
                title={MODE_REGISTRY[mode as keyof typeof MODE_REGISTRY]?.name ?? mode}
              >
                {MODE_REGISTRY[mode as keyof typeof MODE_REGISTRY]?.name ?? mode}
              </div>
            ))}

            {/* Data rows */}
            {data.map((entry) => (
              <>
                <div
                  key={`label-${entry.model}`}
                  className="text-xs truncate py-1.5 pr-2"
                  title={entry.model}
                >
                  {entry.displayName}
                </div>
                {modeList.map((mode) => {
                  const ms = lookup.get(entry.model)?.get(mode);
                  return (
                    <div
                      key={`${entry.model}-${mode}`}
                      className="flex items-center justify-center py-1.5 rounded-sm text-[9px] font-medium"
                      style={{
                        backgroundColor: ms != null ? getHeatColor(ms) : undefined,
                        color: ms != null ? "#fff" : undefined,
                      }}
                      title={ms != null ? formatMs(ms) : "N/A"}
                    >
                      {ms != null ? formatMs(ms) : "—"}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-3 text-[9px] text-muted-foreground">
          <span>Fast</span>
          <div className="flex h-2 flex-1 rounded-full overflow-hidden">
            <div className="flex-1" style={{ backgroundColor: "rgb(0, 255, 100)" }} />
            <div className="flex-1" style={{ backgroundColor: "rgb(234, 179, 100)" }} />
            <div className="flex-1" style={{ backgroundColor: "#ef4444" }} />
          </div>
          <span>Slow</span>
        </div>
      </CardContent>
    </Card>
  );
}
