"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getModelColor,
  getModelDisplayName,
  getRankColor,
} from "@/lib/council/model-colors";
import type { Stage2Response, Stage2Metadata } from "@/lib/council/types";
import type { StageStatus } from "@/hooks/use-council-stream";

interface Stage2PanelProps {
  rankings: Stage2Response[];
  metadata: Stage2Metadata | null;
  status: StageStatus;
  /** Index map from model name to its original position in the council */
  modelIndexMap: Map<string, number>;
}

export function Stage2Panel({
  rankings,
  metadata,
  status,
  modelIndexMap,
}: Stage2PanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (status === "loading" || (status === "pending" && rankings.length === 0)) {
    return <Stage2Skeleton />;
  }

  if (rankings.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">No rankings received.</p>;
  }

  const active = rankings[activeIndex];
  const numModels = metadata?.aggregateRankings.length ?? 1;

  return (
    <div className="space-y-4">
      {/* De-anonymization label map */}
      {metadata?.labelToModel && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(metadata.labelToModel).map(([label, model]) => {
            const idx = modelIndexMap.get(model) ?? 0;
            const color = getModelColor(idx);
            return (
              <span
                key={label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px]",
                  color.bg,
                  color.text,
                  color.border
                )}
              >
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">&rarr;</span>
                <span>{getModelDisplayName(model)}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Evaluator tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {rankings.map((r, i) => {
          const idx = modelIndexMap.get(r.model) ?? 0;
          const color = getModelColor(idx);
          return (
            <button
              key={r.model}
              onClick={() => setActiveIndex(i)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                activeIndex === i
                  ? `${color.bg} ${color.text} ${color.border}`
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", color.dot)} />
              {getModelDisplayName(r.model)}
            </button>
          );
        })}
      </div>

      {/* Active evaluation */}
      {active && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
          <ReactMarkdown>{active.rankingText}</ReactMarkdown>
        </div>
      )}

      {/* Aggregate rankings */}
      {metadata?.aggregateRankings && metadata.aggregateRankings.length > 0 && (
        <div className="border-t border-border pt-4">
          <h4 className="mb-3 text-[11px] font-semibold">Aggregate Rankings</h4>
          <div className="space-y-2">
            {metadata.aggregateRankings.map((r, i) => {
              const barWidth =
                ((numModels - r.averageRank + 1) / numModels) * 100;
              const idx = modelIndexMap.get(r.model) ?? 0;
              const modelColor = getModelColor(idx);
              return (
                <div key={r.model} className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white",
                      getRankColor(i + 1)
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="w-36 truncate text-[11px] font-medium">
                    {getModelDisplayName(r.model)}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all duration-500", modelColor.bar)}
                      style={{ width: `${Math.max(barWidth, 5)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right text-[10px] text-muted-foreground">
                    Avg: {r.averageRank.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stage2Skeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-36 rounded-md" />
        ))}
      </div>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-[85%]" />
        <Skeleton className="h-3 w-[70%]" />
        <Skeleton className="h-3 w-[80%]" />
      </div>
    </div>
  );
}
