"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import type { ModePanelProps } from "./types";
import { Lightbulb } from "lucide-react";

/**
 * Brainstorm mode panel — Ideas, Clusters, Results tabs.
 */
export function IdeationPanel({ stages, isLoading }: ModePanelProps) {
  const [activeTab, setActiveTab] = useState("ideas");

  const ideationData = stages["ideation_complete"] as Record<string, unknown> | undefined;
  const clusteringData = stages["clustering_complete"] as Record<string, unknown> | undefined;
  const scoringData = (stages["scoring_complete"] ?? stages["refinement_complete"]) as Record<string, unknown> | undefined;

  const ideas = normalizeArray(ideationData?.ideas);
  const clusters = normalizeArray(clusteringData?.clusters ?? scoringData?.clusters);
  const hasIdeas = ideas.length > 0;
  const hasClusters = clusters.length > 0;
  const hasResults = !!scoringData;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        <TabsTrigger value="ideas" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Ideas
          <StageIndicator done={hasIdeas} loading={isLoading && !hasIdeas} />
        </TabsTrigger>
        <TabsTrigger value="clusters" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Clusters
          <StageIndicator done={hasClusters} loading={isLoading && hasIdeas && !hasClusters} />
        </TabsTrigger>
        <TabsTrigger value="results" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Results
          <StageIndicator done={hasResults} loading={isLoading && hasClusters && !hasResults} />
        </TabsTrigger>
      </TabsList>

      <div className="p-4">
        <TabsContent value="ideas" className="mt-0">
          {hasIdeas ? (
            <div className="space-y-2">
              <div className="text-[10px] text-muted-foreground">
                {ideas.length} ideas generated
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {ideas.map((idea, i) => {
                  const color = getModelColor(i % 5);
                  return (
                    <div key={i} className={cn("rounded-lg border p-2.5", color.border)}>
                      <div className="flex items-start gap-1.5">
                        <Lightbulb className={cn("h-3 w-3 mt-0.5 flex-shrink-0", color.text)} />
                        <div className="text-xs leading-relaxed">
                          {String(idea.content ?? idea.idea ?? idea.title ?? "")}
                        </div>
                      </div>
                      {idea.model != null && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {getModelDisplayName(String(idea.model))}
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

        <TabsContent value="clusters" className="mt-0">
          {hasClusters ? (
            <div className="space-y-3">
              {clusters.map((cluster, i) => {
                const color = getModelColor(i);
                const clusterIdeas = normalizeArray(cluster.ideas ?? cluster.items);
                return (
                  <div key={i} className={cn("rounded-lg border p-3", color.border)}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className={cn("h-2 w-2 rounded-full", color.dot)} />
                      <span className="text-xs font-medium">
                        {String(cluster.name ?? cluster.theme ?? `Cluster ${i + 1}`)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        ({clusterIdeas.length} ideas)
                      </span>
                    </div>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {clusterIdeas.slice(0, 5).map((idea, j) => (
                        <li key={j}>
                          {String(idea.content ?? idea.idea ?? idea.title ?? "")}
                        </li>
                      ))}
                      {clusterIdeas.length > 5 && (
                        <li className="text-[10px]">+{clusterIdeas.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </TabsContent>

        <TabsContent value="results" className="mt-0">
          {hasResults ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
              <ReactMarkdown>
                {String(
                  scoringData.refinedOutput ??
                  scoringData.rankedIdeas ??
                  scoringData.response ??
                  JSON.stringify(scoringData.rankings ?? scoringData, null, 2)
                )}
              </ReactMarkdown>
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </TabsContent>
      </div>
    </Tabs>
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
