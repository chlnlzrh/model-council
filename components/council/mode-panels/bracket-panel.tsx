"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import { CollapsibleContent } from "./collapsible-content";
import type { ModePanelProps } from "./types";
import { Trophy, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Tournament bracket panel — shows round-by-round matchups.
 */
export function BracketPanel({ stages, isLoading }: ModePanelProps) {
  const tournamentStart = stages["tournament_start"] as Record<string, unknown> | undefined;
  const matchResults = normalizeArray(stages["match_complete"]);
  const champion = stages["champion_declared"] as Record<string, unknown> | undefined;

  // Group matches by round
  const roundMap = new Map<number, Array<Record<string, unknown>>>();
  for (const match of matchResults) {
    const round = Number(match.round ?? 1);
    if (!roundMap.has(round)) roundMap.set(round, []);
    roundMap.get(round)!.push(match);
  }
  const rounds = Array.from(roundMap.entries()).sort(([a], [b]) => a - b);
  const hasContent = matchResults.length > 0 || champion != null;

  return (
    <div className="space-y-4 p-4">
      {/* Tournament header */}
      {tournamentStart != null && (
        <div className="text-[10px] text-muted-foreground">
          {String(tournamentStart.totalContestants)} contestants, {String(tournamentStart.totalRounds)} rounds
        </div>
      )}

      {/* Rounds */}
      {rounds.map(([roundNum, matches]) => (
        <div key={roundNum} className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Round {roundNum}
          </div>
          {matches.map((match, i) => (
            <MatchCard key={i} match={match} />
          ))}
        </div>
      ))}

      {/* Champion */}
      {champion != null && (
        <div className="rounded-lg border-2 border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-bold">Champion</span>
          </div>
          <div className="mt-1 text-xs font-medium">
            {getModelDisplayName(String(champion.model ?? champion.champion ?? ""))}
          </div>
        </div>
      )}

      {isLoading && !hasContent && <BracketSkeleton />}
      {!isLoading && !hasContent && (
        <p className="py-4 text-xs text-muted-foreground">No matches played.</p>
      )}
    </div>
  );
}

function MatchCard({ match }: { match: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const c1 = match.contestant1 as Record<string, unknown> | undefined;
  const c2 = match.contestant2 as Record<string, unknown> | undefined;
  const winnerModel = String(match.winnerModel ?? "");
  const matchNumber = match.matchNumber as number | undefined;

  const model1 = String(c1?.model ?? "");
  const model2 = String(c2?.model ?? "");
  const isWinner1 = model1 === winnerModel;
  const isWinner2 = model2 === winnerModel;

  return (
    <div className="rounded-lg border border-border">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left h-auto font-normal hover:bg-transparent"
      >
        <div className="flex items-center gap-2">
          {matchNumber !== undefined && (
            <span className="text-[10px] text-muted-foreground">#{matchNumber}</span>
          )}
          <div className="flex items-center gap-1.5">
            <ModelPill model={model1} isWinner={isWinner1} index={0} />
            <span className="text-[10px] text-muted-foreground">vs</span>
            <ModelPill model={model2} isWinner={isWinner2} index={1} />
          </div>
        </div>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </Button>
      {expanded && (
        <div className="border-t divide-y divide-border">
          {c1 && c1.response != null && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <ModelPill model={model1} isWinner={isWinner1} index={0} />
              </div>
              <CollapsibleContent content={String(c1.response)} copyable />
            </div>
          )}
          {c2 && c2.response != null && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <ModelPill model={model2} isWinner={isWinner2} index={1} />
              </div>
              <CollapsibleContent content={String(c2.response)} copyable />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModelPill({ model, isWinner, index }: { model: string; isWinner: boolean; index: number }) {
  const color = getModelColor(index);
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
        isWinner
          ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 font-medium"
          : `${color.bg} ${color.text} border ${color.border}`
      )}
    >
      {isWinner && <Trophy className="h-2.5 w-2.5" />}
      {model ? getModelDisplayName(model) : "Unknown"}
    </span>
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

function BracketSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div key={i} className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-6 w-24 rounded-full" />
            <span className="text-[10px] text-muted-foreground">vs</span>
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
