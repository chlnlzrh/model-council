"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import { CollapsibleContent } from "./collapsible-content";
import type { ModePanelProps } from "./types";

/**
 * Blueprint mode panel — Outline, Sections, Assembled tabs.
 */
export function BlueprintPanel({ stages, isLoading }: ModePanelProps) {
  const [activeTab, setActiveTab] = useState("outline");

  const outlineData = stages["outline_complete"] as Record<string, unknown> | undefined;
  const sections = normalizeArray(stages["author_complete"]);
  const assemblyData = stages["assembly_complete"] as Record<string, unknown> | undefined;

  const hasOutline = !!outlineData;
  const hasSections = sections.length > 0;
  const hasAssembly = !!assemblyData;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        <TabsTrigger value="outline" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Outline
          <StageIndicator done={hasOutline} loading={isLoading && !hasOutline} />
        </TabsTrigger>
        <TabsTrigger value="sections" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Sections
          <StageIndicator done={hasSections} loading={isLoading && hasOutline && !hasSections} />
        </TabsTrigger>
        <TabsTrigger value="assembled" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Assembled
          <StageIndicator done={hasAssembly} loading={isLoading && hasSections && !hasAssembly} />
        </TabsTrigger>
      </TabsList>

      <div className="p-4">
        <TabsContent value="outline" className="mt-0">
          {hasOutline ? (
            <div className="space-y-2">
              {outlineData.wordCount !== undefined && outlineData.wordCount !== null && (
                <div className="text-[10px] text-muted-foreground">
                  {String(outlineData.wordCount)} words
                </div>
              )}
              <CollapsibleContent
                content={String(outlineData.outline ?? outlineData.content ?? "")}
                copyable
              />
            </div>
          ) : isLoading ? (
            <BlueprintSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No content drafted.</p>
          )}
        </TabsContent>

        <TabsContent value="sections" className="mt-0">
          {hasSections ? (
            <SectionList sections={sections} />
          ) : isLoading ? (
            <BlueprintSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No sections authored.</p>
          )}
        </TabsContent>

        <TabsContent value="assembled" className="mt-0">
          {hasAssembly ? (
            <div className="space-y-2">
              {assemblyData.wordCount !== undefined && assemblyData.wordCount !== null && (
                <div className="text-[10px] text-muted-foreground">
                  Total: {String(assemblyData.wordCount)} words
                </div>
              )}
              <CollapsibleContent
                content={String(assemblyData.assembledDocument ?? assemblyData.content ?? assemblyData.response ?? "")}
                copyable
              />
            </div>
          ) : isLoading ? (
            <BlueprintSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No document assembled.</p>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

function SectionList({ sections }: { sections: Array<Record<string, unknown>> }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  return (
    <div className="space-y-2">
      {sections.map((section, i) => {
        const color = getModelColor(i);
        const isExpanded = expandedIdx === i;
        const sectionNum = section.sectionNumber as number | undefined;
        const sectionName = String(section.sectionName ?? `Section ${sectionNum ?? i + 1}`);
        const model = String(section.model ?? "");
        const content = String(section.sectionContent ?? section.content ?? "");
        const wordCount = section.wordCount as number | undefined;

        return (
          <div key={i} className={cn("rounded-lg border", color.border)}>
            <Button
              variant="ghost"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              aria-expanded={isExpanded}
              className="flex w-full items-center justify-between px-3 py-2 text-left h-auto font-normal hover:bg-transparent"
            >
              <div className="flex items-center gap-2">
                <span className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white",
                  color.dot
                )}>
                  {sectionNum ?? i + 1}
                </span>
                <span className="text-xs font-medium">{sectionName}</span>
              </div>
              <div className="flex items-center gap-2">
                {model && (
                  <span className="text-[10px] text-muted-foreground">{getModelDisplayName(model)}</span>
                )}
                {wordCount !== undefined && (
                  <span className="text-[10px] text-muted-foreground">{wordCount}w</span>
                )}
              </div>
            </Button>
            {isExpanded && content && (
              <div className="border-t px-3 py-2">
                <CollapsibleContent content={content} copyable />
              </div>
            )}
          </div>
        );
      })}
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

function BlueprintSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-3 w-[75%]" />
        </div>
      ))}
    </div>
  );
}
