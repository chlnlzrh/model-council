"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ModePanelProps } from "./types";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";

/**
 * Fact-Check mode panel — Claims table with verdict badges, summary stats, and report.
 */
export function VerificationPanel({ stages, isLoading }: ModePanelProps) {
  const [activeTab, setActiveTab] = useState("claims");

  const extractData = stages["extract_complete"] as Record<string, unknown> | undefined;
  const verifications = normalizeArray(stages["verify_complete"]);
  const reportData = stages["report_complete"] as Record<string, unknown> | undefined;

  const claims = normalizeArray(extractData?.claims);
  const hasClaims = claims.length > 0 || verifications.length > 0;
  const hasReport = !!reportData;

  // Count verdicts
  const verdictCounts = { verified: 0, false: 0, uncertain: 0 };
  for (const v of verifications) {
    const verdict = String(v.verified ?? "").toUpperCase();
    if (verdict === "TRUE") verdictCounts.verified++;
    else if (verdict === "FALSE") verdictCounts.false++;
    else verdictCounts.uncertain++;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        <TabsTrigger value="claims" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Claims
          <StageIndicator done={hasClaims} loading={isLoading && !hasClaims} />
        </TabsTrigger>
        <TabsTrigger value="report" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Report
          <StageIndicator done={hasReport} loading={isLoading && hasClaims && !hasReport} />
        </TabsTrigger>
      </TabsList>

      <div className="p-4">
        <TabsContent value="claims" className="mt-0">
          {hasClaims ? (
            <div className="space-y-3">
              {/* Summary stats */}
              {verifications.length > 0 && (
                <div className="flex gap-3 text-[10px]">
                  <StatBadge icon={<CheckCircle className="h-3 w-3 text-emerald-500" />} label="Verified" count={verdictCounts.verified} />
                  <StatBadge icon={<XCircle className="h-3 w-3 text-red-500" />} label="False" count={verdictCounts.false} />
                  <StatBadge icon={<AlertCircle className="h-3 w-3 text-amber-500" />} label="Uncertain" count={verdictCounts.uncertain} />
                </div>
              )}

              {/* Claims list */}
              <div className="space-y-2">
                {(verifications.length > 0 ? verifications : claims).map((item, i) => (
                  <ClaimRow key={i} item={item} index={i} />
                ))}
              </div>
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </TabsContent>

        <TabsContent value="report" className="mt-0">
          {hasReport ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
              <ReactMarkdown>{String(reportData.report ?? reportData.response ?? "")}</ReactMarkdown>
            </div>
          ) : (
            <PanelSkeleton />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

function ClaimRow({ item, index }: { item: Record<string, unknown>; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const claim = String(item.claim ?? item.content ?? `Claim ${index + 1}`);
  const verdict = String(item.verified ?? "PENDING").toUpperCase();
  const confidence = item.confidence as number | undefined;
  const summary = String(item.summary ?? item.evidence ?? "");

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <VerdictBadge verdict={verdict} />
        <span className="text-xs flex-1 truncate">{claim}</span>
        {confidence !== undefined && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <div className="h-1.5 w-12 rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full",
                  confidence >= 0.7 ? "bg-emerald-500" : confidence >= 0.4 ? "bg-amber-500" : "bg-red-500"
                )}
                style={{ width: `${Math.round(confidence * 100)}%` }}
              />
            </div>
            <span className="text-[9px] text-muted-foreground w-7 text-right">
              {Math.round(confidence * 100)}%
            </span>
          </div>
        )}
      </button>
      {expanded && summary && (
        <div className="border-t px-3 py-2 text-xs text-muted-foreground leading-relaxed">
          {summary}
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  if (verdict === "TRUE") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle className="h-2.5 w-2.5" />
        True
      </span>
    );
  }
  if (verdict === "FALSE") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-950 px-1.5 py-0.5 text-[9px] font-medium text-red-700 dark:text-red-300">
        <XCircle className="h-2.5 w-2.5" />
        False
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
      <AlertCircle className="h-2.5 w-2.5" />
      {verdict === "PENDING" ? "Pending" : "Uncertain"}
    </span>
  );
}

function StatBadge({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <span className="text-muted-foreground">{label}: {count}</span>
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
