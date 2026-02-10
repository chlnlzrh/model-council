"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import { CollapsibleContent } from "./collapsible-content";
import { CopyButton } from "./copy-button";
import type { ModePanelProps } from "./types";
import { Trophy } from "lucide-react";

/**
 * Shared panel for Vote and Debate modes.
 *
 * Vote events: stage1_complete, vote_round_complete, tiebreaker_complete, winner_declared
 * Debate events: round1_complete, revision_complete, revision_summary, vote_complete, winner_declared
 */
export function VotingPanel({ mode, stages, isLoading, currentStage }: ModePanelProps) {
  const [activeTab, setActiveTab] = useState("responses");
  const isDebate = mode === "debate";

  // Extract data from stages
  const responses = (
    isDebate
      ? stages["round1_complete"]
      : stages["stage1_complete"]
  ) as Array<{ model: string; response: string; responseTimeMs: number }> | undefined;

  const revisions = stages["revision_complete"] as
    | Array<{ model: string; decision: string; revisedResponse?: string; responseTimeMs: number }>
    | undefined;

  const voteData = (
    isDebate
      ? stages["vote_complete"]
      : stages["vote_round_complete"]
  ) as { votes?: Array<{ model: string; votedFor: string }>; tallies?: Record<string, number>; isTie?: boolean } | undefined;

  const winner = stages["winner_declared"] as {
    winnerModel?: string;
    winnerResponse?: string;
    voteCount?: number;
    totalVotes?: number;
  } | undefined;

  const hasResponses = !!responses && (Array.isArray(responses) ? responses.length > 0 : true);
  const hasVotes = !!voteData;
  const hasWinner = !!winner;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
        <TabsTrigger value="responses" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          {isDebate ? "Answers" : "Responses"}
          <StageIndicator done={hasResponses} loading={isLoading && !hasResponses} />
        </TabsTrigger>
        {isDebate && (
          <TabsTrigger value="revisions" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
            Revisions
            <StageIndicator done={!!revisions} loading={isLoading && hasResponses && !revisions} />
          </TabsTrigger>
        )}
        <TabsTrigger value="votes" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Votes
          <StageIndicator done={hasVotes} loading={isLoading && hasResponses && !hasVotes} />
        </TabsTrigger>
        <TabsTrigger value="winner" className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
          Winner
          <StageIndicator done={hasWinner} loading={isLoading && hasVotes && !hasWinner} />
        </TabsTrigger>
      </TabsList>

      <div className="p-4">
        <TabsContent value="responses" className="mt-0">
          {hasResponses ? (
            <ResponseList responses={Array.isArray(responses) ? responses : []} />
          ) : isLoading ? (
            <VotingSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No responses yet.</p>
          )}
        </TabsContent>

        {isDebate && (
          <TabsContent value="revisions" className="mt-0">
            {revisions ? (
              <RevisionList revisions={Array.isArray(revisions) ? revisions : [revisions]} />
            ) : isLoading ? (
              <VotingSkeleton />
            ) : (
              <p className="py-4 text-xs text-muted-foreground">No revisions yet.</p>
            )}
          </TabsContent>
        )}

        <TabsContent value="votes" className="mt-0">
          {voteData ? (
            <VoteTally tallies={voteData.tallies ?? {}} isTie={voteData.isTie} />
          ) : isLoading ? (
            <VotingSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No votes yet.</p>
          )}
        </TabsContent>

        <TabsContent value="winner" className="mt-0">
          {winner ? (
            <WinnerCard winner={winner} />
          ) : isLoading ? (
            <VotingSkeleton />
          ) : (
            <p className="py-4 text-xs text-muted-foreground">No winner declared yet.</p>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

function ResponseList({
  responses,
}: {
  responses: Array<{ model: string; response: string; responseTimeMs: number }>;
}) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (responses.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">No responses received.</p>;
  }
  const active = responses[activeIdx];

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {responses.map((r, i) => {
          const color = getModelColor(i);
          return (
            <button
              key={r.model}
              onClick={() => setActiveIdx(i)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                activeIdx === i
                  ? `${color.bg} ${color.text} ${color.border}`
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", color.dot)} />
              {getModelDisplayName(r.model)}
              <span className="text-[10px] text-muted-foreground">
                {(r.responseTimeMs / 1000).toFixed(1)}s
              </span>
            </button>
          );
        })}
      </div>
      {active && (
        <CollapsibleContent content={active.response} copyable />
      )}
    </div>
  );
}

function RevisionList({
  revisions,
}: {
  revisions: Array<{ model: string; decision: string; revisedResponse?: string; responseTimeMs: number }>;
}) {
  return (
    <div className="space-y-3">
      {revisions.map((r, i) => {
        const color = getModelColor(i);
        return (
          <div key={`${r.model}-${i}`} className={cn("rounded-lg border p-3", color.border)}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("h-2 w-2 rounded-full", color.dot)} />
              <span className="text-xs font-medium">{getModelDisplayName(r.model)}</span>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                r.decision === "revise"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              )}>
                {r.decision === "revise" ? "Revised" : "Stood firm"}
              </span>
            </div>
            {r.revisedResponse != null && (
              <CollapsibleContent content={r.revisedResponse} copyable />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VoteTally({ tallies, isTie }: { tallies: Record<string, number>; isTie?: boolean }) {
  const entries = Object.entries(tallies).sort(([, a], [, b]) => b - a);
  const maxVotes = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="space-y-3">
      {isTie && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Tie detected — tiebreaker applied
        </div>
      )}
      <div className="space-y-2">
        {entries.map(([model, votes], i) => {
          const color = getModelColor(i);
          const pct = (votes / maxVotes) * 100;
          return (
            <div key={model} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", color.dot)} />
                  {getModelDisplayName(model)}
                </span>
                <span className="text-muted-foreground">{votes} vote{votes !== 1 ? "s" : ""}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", color.bar)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WinnerCard({ winner }: { winner: { winnerModel?: string; winnerResponse?: string; voteCount?: number; totalVotes?: number } }) {
  return (
    <div className="group space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-500" />
        <span className="text-xs font-semibold">
          {winner.winnerModel ? getModelDisplayName(winner.winnerModel) : "Winner"}
        </span>
        {winner.voteCount !== undefined && winner.totalVotes !== undefined && (
          <span className="text-[10px] text-muted-foreground">
            ({winner.voteCount}/{winner.totalVotes} votes)
          </span>
        )}
      </div>
      {winner.winnerResponse != null && (
        <CollapsibleContent content={winner.winnerResponse} copyable />
      )}
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

function VotingSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-[90%]" />
        <Skeleton className="h-3 w-[75%]" />
        <Skeleton className="h-3 w-[85%]" />
        <Skeleton className="h-3 w-[60%]" />
      </div>
    </div>
  );
}
