"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { CrossModeModelEntry } from "@/lib/analytics/types";

interface ModelLeaderboardProps {
  data: CrossModeModelEntry[];
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ModelLeaderboard({ data }: ModelLeaderboardProps) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="text-xs font-semibold mb-1">Model Leaderboard</h3>
          <p className="text-[10px] text-muted-foreground">No model data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="text-xs font-semibold mb-0.5">Model Leaderboard</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          Cross-mode performance comparison
        </p>

        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_80px_60px] gap-2 pb-2 border-b text-[10px] text-muted-foreground font-medium">
          <span>Model</span>
          <span className="text-right">Sessions</span>
          <span className="text-right">Avg Time</span>
          <span className="text-right">Score</span>
        </div>

        {/* Rows */}
        <div className="divide-y">
          {data.map((entry, i) => {
            const avgMs =
              entry.modes.reduce(
                (sum, m) => sum + m.avgResponseTimeMs * m.sessions,
                0
              ) /
              Math.max(entry.totalSessions, 1);

            return (
              <div
                key={entry.model}
                className="grid grid-cols-[1fr_80px_80px_60px] gap-2 py-2 items-center"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-muted-foreground w-4 shrink-0">
                    {i + 1}.
                  </span>
                  <span className="text-xs truncate" title={entry.model}>
                    {entry.displayName}
                  </span>
                </div>
                <span className="text-xs text-right">{entry.totalSessions}</span>
                <span className="text-xs text-right text-muted-foreground">
                  {formatMs(Math.round(avgMs))}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      width: `${entry.overallScore}%`,
                      maxWidth: 40,
                      backgroundColor:
                        entry.overallScore >= 70
                          ? "#10b981"
                          : entry.overallScore >= 40
                          ? "#f59e0b"
                          : "#ef4444",
                    }}
                  />
                  <span className="text-xs font-semibold">{entry.overallScore}</span>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
