"use client";

import ReactMarkdown from "react-markdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import type { ModePanelProps } from "./types";
import { useState } from "react";

/**
 * Confidence-Weighted mode panel — model cards with confidence bars and weighted synthesis.
 */
export function WeightedPanel({ stages, isLoading }: ModePanelProps) {
  const [activeTab, setActiveTab] = useState("answers");

  const answers = normalizeArray(stages["answer_complete"]);
  const allAnswers = stages["all_answers_complete"] as Record<string, unknown> | undefined;
  const synthesis = stages["synthesis_complete"] as Record<string, unknown> | undefined;

  const hasAnswers = answers.length > 0;
  const hasSynthesis = !!synthesis;
  const avgConfidence = allAnswers?.averageConfidence as number | undefined;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        <TabsTrigger value="answers" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Answers
          <StageIndicator done={hasAnswers} loading={isLoading && !hasAnswers} />
        </TabsTrigger>
        <TabsTrigger value="synthesis" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Synthesis
          <StageIndicator done={hasSynthesis} loading={isLoading && hasAnswers && !hasSynthesis} />
        </TabsTrigger>
      </TabsList>

      <div className="p-4">
        <TabsContent value="answers" className="mt-0">
          {hasAnswers ? (
            <div className="space-y-3">
              {avgConfidence !== undefined && (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  Average confidence:
                  <ConfidenceBar confidence={avgConfidence} />
                </div>
              )}
              <div className="space-y-2">
                {answers.map((a, i) => {
                  const color = getModelColor(i);
                  const model = String(a.model ?? "");
                  const confidence = Number(a.confidence ?? 0);
                  const answer = String(a.answer ?? a.response ?? "");
                  const reasoning = String(a.reasoning ?? "");

                  return (
                    <div key={`${model}-${i}`} className={cn("rounded-lg border p-3", color.border)}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("h-2 w-2 rounded-full", color.dot)} />
                          <span className="text-xs font-medium">{getModelDisplayName(model)}</span>
                        </div>
                        <ConfidenceBar confidence={confidence} />
                      </div>
                      <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
                        <ReactMarkdown>{answer}</ReactMarkdown>
                      </div>
                      {reasoning && (
                        <div className="mt-2 text-[10px] text-muted-foreground italic">
                          {reasoning}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </TabsContent>

        <TabsContent value="synthesis" className="mt-0">
          {hasSynthesis ? (
            <div className="space-y-3">
              {Array.isArray(synthesis.keyThemes) && (
                <div className="flex flex-wrap gap-1.5">
                  {(synthesis.keyThemes as string[]).map((theme, i) => (
                    <span key={i} className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      {theme}
                    </span>
                  ))}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
                <ReactMarkdown>{String(synthesis.synthesizedAnswer ?? synthesis.response ?? "")}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-16 rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
    </div>
  );
}

function normalizeArray(raw: unknown): Array<Record<string, unknown>> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) =>
      typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
    );
  }
  if (typeof raw === "object" && raw !== null) return [raw as Record<string, unknown>];
  return [];
}

function StageIndicator({ done, loading }: { done: boolean; loading: boolean }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full",
        done && "bg-emerald-500",
        loading && "bg-amber-500 animate-pulse",
        !done && !loading && "bg-muted-foreground/40"
      )}
    />
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-[90%]" />
      <Skeleton className="h-3 w-[75%]" />
      <Skeleton className="h-3 w-[85%]" />
    </div>
  );
}
