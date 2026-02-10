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
 * Shared panel for Specialist Panel, Jury, and Peer Review modes.
 *
 * Shows role-based contributions with expandable cards and a final synthesis/verdict.
 */
export function RolePanel({ mode, stages, isLoading }: ModePanelProps) {
  const [activeTab, setActiveTab] = useState("contributions");

  const isSpecialist = mode === "specialist_panel";
  const isJury = mode === "jury";

  // Normalize contributions from various stage shapes
  const contributions = extractContributions(mode, stages);
  const synthesis = extractSynthesis(mode, stages);
  const hasContributions = contributions.length > 0;
  const hasSynthesis = !!synthesis;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        <TabsTrigger value="contributions" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          {isSpecialist ? "Specialists" : isJury ? "Jurors" : "Reviewers"}
          <StageIndicator done={hasContributions} loading={isLoading && !hasContributions} />
        </TabsTrigger>
        <TabsTrigger value="synthesis" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          {isSpecialist ? "Synthesis" : isJury ? "Verdict" : "Consolidated"}
          <StageIndicator done={hasSynthesis} loading={isLoading && hasContributions && !hasSynthesis} />
        </TabsTrigger>
      </TabsList>

      <div className="p-4">
        <TabsContent value="contributions" className="mt-0">
          {hasContributions ? (
            <ContributionList contributions={contributions} mode={mode} />
          ) : isLoading ? (
            <RoleSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No reports yet.</p>
          )}
        </TabsContent>

        <TabsContent value="synthesis" className="mt-0">
          {hasSynthesis ? (
            <CollapsibleContent content={synthesis} copyable />
          ) : isLoading ? (
            <RoleSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No synthesis yet.</p>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

interface Contribution {
  model: string;
  role: string;
  content: string;
  score?: number;
  responseTimeMs?: number;
}

function extractContributions(mode: string, stages: Record<string, unknown>): Contribution[] {
  if (mode === "specialist_panel") {
    const raw = stages["specialist_complete"];
    const items = normalizeArray(raw);
    return items.map((item: Record<string, unknown>) => ({
      model: String(item.model ?? ""),
      role: String(item.roleTitle ?? item.roleId ?? "Specialist"),
      content: String(item.report ?? ""),
      score: typeof item.averageScore === "number" ? item.averageScore : undefined,
      responseTimeMs: typeof item.responseTimeMs === "number" ? item.responseTimeMs : undefined,
    }));
  }

  if (mode === "jury") {
    const raw = stages["juror_complete"];
    const items = normalizeArray(raw);
    return items.map((item: Record<string, unknown>, i: number) => ({
      model: String(item.model ?? ""),
      role: `Juror ${i + 1}`,
      content: String(item.verdict ?? item.recommendations ?? ""),
      score: typeof item.average === "number" ? item.average : undefined,
      responseTimeMs: typeof item.responseTimeMs === "number" ? item.responseTimeMs : undefined,
    }));
  }

  // peer_review
  const raw = stages["review_complete"];
  const items = normalizeArray(raw);
  return items.map((item: Record<string, unknown>, i: number) => ({
    model: String(item.model ?? ""),
    role: `Reviewer ${i + 1}`,
    content: formatReview(item),
    responseTimeMs: typeof item.responseTimeMs === "number" ? item.responseTimeMs : undefined,
  }));
}

function extractSynthesis(mode: string, stages: Record<string, unknown>): string | null {
  if (mode === "specialist_panel") {
    const data = stages["synthesis_complete"] as Record<string, unknown> | undefined;
    return data ? String(data.integratedAssessment ?? data.response ?? "") : null;
  }

  if (mode === "jury") {
    const data = stages["verdict_complete"] as Record<string, unknown> | undefined;
    if (!data) return null;
    const parts = [
      data.finalVerdict && `**Verdict:** ${data.finalVerdict}`,
      data.keyStrengths && `**Strengths:** ${data.keyStrengths}`,
      data.keyWeaknesses && `**Weaknesses:** ${data.keyWeaknesses}`,
      data.recommendations && `**Recommendations:** ${data.recommendations}`,
    ].filter(Boolean);
    return parts.join("\n\n") || String(data.response ?? "");
  }

  // peer_review
  const data = stages["consolidation_complete"] as Record<string, unknown> | undefined;
  return data ? String(data.consolidatedFeedback ?? data.response ?? "") : null;
}

function formatReview(item: Record<string, unknown>): string {
  const parts: string[] = [];
  if (item.strengths) parts.push(`**Strengths:** ${Array.isArray(item.strengths) ? (item.strengths as string[]).join(", ") : item.strengths}`);
  if (item.weaknesses) parts.push(`**Weaknesses:** ${Array.isArray(item.weaknesses) ? (item.weaknesses as string[]).join(", ") : item.weaknesses}`);
  if (item.suggestions) parts.push(`**Suggestions:** ${Array.isArray(item.suggestions) ? (item.suggestions as string[]).join(", ") : item.suggestions}`);
  return parts.join("\n\n") || String(item.reviewDimensions ?? "");
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

function ContributionList({ contributions, mode }: { contributions: Contribution[]; mode: string }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0);

  return (
    <div className="space-y-2">
      {contributions.map((c, i) => {
        const color = getModelColor(i);
        const isExpanded = expandedIdx === i;
        return (
          <div key={`${c.model}-${i}`} className={cn("rounded-lg border", color.border)}>
            <Button
              variant="ghost"
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              aria-expanded={isExpanded}
              className="flex w-full items-center gap-2 px-3 py-2 text-left h-auto justify-start font-normal hover:bg-transparent"
            >
              <span className={cn("h-2 w-2 rounded-full flex-shrink-0", color.dot)} />
              <span className="text-xs font-medium flex-1">
                {c.role}
                <span className="ml-1.5 text-[10px] text-muted-foreground font-normal">
                  {getModelDisplayName(c.model)}
                </span>
              </span>
              {c.score !== undefined && (
                <span className="text-[10px] text-muted-foreground">{c.score.toFixed(1)}/10</span>
              )}
              {c.responseTimeMs !== undefined && (
                <span className="text-[10px] text-muted-foreground">{(c.responseTimeMs / 1000).toFixed(1)}s</span>
              )}
            </Button>
            {isExpanded && (
              <div className="border-t px-3 py-2">
                <CollapsibleContent content={c.content} copyable />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
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

function RoleSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-16 rounded-full" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-[85%]" />
        </div>
      ))}
    </div>
  );
}
