"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import { CollapsibleContent } from "./collapsible-content";
import type { ModePanelProps } from "./types";
import { AlertTriangle, Shield, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Shared panel for Delphi and Red Team modes.
 *
 * Vertical timeline of rounds with collapsible content.
 */
export function RoundsPanel({ mode, stages, isLoading }: ModePanelProps) {
  const isDelphi = mode === "delphi";

  if (isDelphi) {
    return <DelphiView stages={stages} isLoading={isLoading} />;
  }
  return <RedTeamView stages={stages} isLoading={isLoading} />;
}

function DelphiView({ stages, isLoading }: { stages: Record<string, unknown>; isLoading: boolean }) {
  const classification = stages["classify_complete"] as Record<string, unknown> | undefined;
  const estimateRounds = normalizeArray(stages["estimates_complete"]);
  const synthesis = stages["synthesis_complete"] as Record<string, unknown> | undefined;
  const converged = !!stages["convergence_reached"];

  const hasContent = classification != null || estimateRounds.length > 0;

  return (
    <div className="space-y-4 p-4">
      {/* Classification */}
      {classification != null && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Classification
          </div>
          <div className="text-xs">
            Type: <span className="font-medium">{String(classification.type ?? "")}</span>
            {classification.reasoning != null && (
              <span className="ml-2 text-muted-foreground">{String(classification.reasoning)}</span>
            )}
          </div>
        </div>
      )}

      {/* Rounds timeline */}
      <div className="relative space-y-3">
        {estimateRounds.length > 0 && (
          <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
        )}
        {estimateRounds.map((round, i) => (
          <RoundCard key={i} roundNumber={i + 1} data={round} />
        ))}
      </div>

      {/* Convergence indicator */}
      {(converged || stages["max_rounds_reached"] != null) && (
        <div className={cn(
          "rounded-md px-3 py-2 text-xs border",
          converged
            ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
            : "bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
        )}>
          {converged ? "Consensus reached" : "Max rounds reached"}
        </div>
      )}

      {/* Synthesis */}
      {synthesis != null && (
        <div className="group rounded-lg border border-border p-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Final Synthesis
          </div>
          <CollapsibleContent
            content={String(synthesis.report ?? synthesis.finalValue ?? "")}
            copyable
          />
        </div>
      )}

      {isLoading && !hasContent && <RoundsSkeleton />}
      {!isLoading && !hasContent && (
        <p className="py-4 text-xs text-muted-foreground">No rounds completed.</p>
      )}
    </div>
  );
}

function RedTeamView({ stages, isLoading }: { stages: Record<string, unknown>; isLoading: boolean }) {
  const generated = stages["generate_complete"] as Record<string, unknown> | undefined;
  const attacks = normalizeArray(stages["attack_complete"]);
  const defenses = normalizeArray(stages["defend_complete"]);
  const synthesis = stages["synthesize_complete"] as Record<string, unknown> | undefined;

  const maxRounds = Math.max(attacks.length, defenses.length);
  const hasContent = generated != null || maxRounds > 0;

  return (
    <div className="space-y-4 p-4">
      {/* Generated content */}
      {generated != null && (
        <div className="group rounded-lg border border-border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Generated Content
          </div>
          <CollapsibleContent
            content={String(generated.structuredContent ?? generated.response ?? "")}
            copyable
          />
        </div>
      )}

      {/* Attack/Defense rounds */}
      <div className="space-y-3">
        {Array.from({ length: maxRounds }, (_, i) => (
          <AttackDefenseRound
            key={i}
            roundNumber={i + 1}
            attack={attacks[i]}
            defense={defenses[i]}
          />
        ))}
      </div>

      {/* Hardened output */}
      {synthesis != null && (
        <div className="group rounded-lg border border-emerald-300 dark:border-emerald-700 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            <Shield className="h-3 w-3" />
            Hardened Output
          </div>
          <CollapsibleContent
            content={String(synthesis.hardenedOutput ?? synthesis.response ?? "")}
            copyable
          />
        </div>
      )}

      {isLoading && !hasContent && <RoundsSkeleton />}
      {!isLoading && !hasContent && (
        <p className="py-4 text-xs text-muted-foreground">No rounds completed.</p>
      )}
    </div>
  );
}

function RoundCard({ roundNumber, data }: { roundNumber: number; data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(roundNumber === 1);
  const stats = data.stats as Record<string, unknown> | undefined;

  return (
    <div className="relative pl-7">
      <div className="absolute left-1.5 top-2.5 h-3 w-3 rounded-full border-2 border-border bg-background z-10" />
      <div className="rounded-lg border border-border">
        <Button
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between px-3 py-2 text-left h-auto font-normal hover:bg-transparent"
        >
          <span className="text-xs font-medium">Round {roundNumber}</span>
          <div className="flex items-center gap-2">
            {stats && (
              <span className="text-[10px] text-muted-foreground">
                {stats.mean !== undefined && `Mean: ${Number(stats.mean).toFixed(2)}`}
                {stats.stdDev !== undefined && ` | StdDev: ${Number(stats.stdDev).toFixed(2)}`}
              </span>
            )}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </div>
        </Button>
        {expanded && (
          <div className="border-t px-3 py-2">
            <div className="space-y-1.5">
              {normalizeArray(data.estimates).map((est, i) => {
                const color = getModelColor(i);
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={cn("h-1.5 w-1.5 rounded-full", color.dot)} />
                    <span className="text-muted-foreground">{getModelDisplayName(String(est.model ?? ""))}</span>
                    <span className="font-medium">{String(est.value ?? est.estimate ?? "")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AttackDefenseRound({
  roundNumber,
  attack,
  defense,
}: {
  roundNumber: number;
  attack?: Record<string, unknown>;
  defense?: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const severity = attack?.summary as Record<string, number> | undefined;

  return (
    <div className="rounded-lg border border-border">
      <Button
        variant="ghost"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-left h-auto font-normal hover:bg-transparent"
      >
        <span className="text-xs font-medium">Round {roundNumber}</span>
        <div className="flex items-center gap-2">
          {severity && (
            <div className="flex items-center gap-1.5 text-[10px]">
              {severity.critical > 0 && <SeverityBadge level="critical" count={severity.critical} />}
              {severity.high > 0 && <SeverityBadge level="high" count={severity.high} />}
              {severity.medium > 0 && <SeverityBadge level="medium" count={severity.medium} />}
              {severity.low > 0 && <SeverityBadge level="low" count={severity.low} />}
            </div>
          )}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </Button>
      {expanded && (
        <div className="border-t">
          {attack && (
            <div className="border-b px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">Attack</span>
                {attack.model != null && (
                  <span className="text-[10px] text-muted-foreground">{getModelDisplayName(String(attack.model))}</span>
                )}
              </div>
              <CollapsibleContent content={formatFindings(attack.findings)} />
            </div>
          )}
          {defense && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="h-3 w-3 text-emerald-500" />
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Defense</span>
                {defense.model != null && (
                  <span className="text-[10px] text-muted-foreground">{getModelDisplayName(String(defense.model))}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {defense.accepted !== undefined && <span>Accepted: {String(defense.accepted)} </span>}
                {defense.rebutted !== undefined && <span>Rebutted: {String(defense.rebutted)}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ level, count }: { level: string; count: number }) {
  const colors: Record<string, string> = {
    critical: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <span className={cn("rounded px-1 py-0.5 text-[9px] font-medium", colors[level] ?? colors.low)}>
      {count} {level}
    </span>
  );
}

function formatFindings(findings: unknown): string {
  if (!findings) return "";
  if (typeof findings === "string") return findings;
  if (Array.isArray(findings)) {
    return findings.map((f, i) => `${i + 1}. ${typeof f === "object" ? JSON.stringify(f) : String(f)}`).join("\n");
  }
  return String(findings);
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

function RoundsSkeleton() {
  return (
    <div className="relative space-y-3">
      <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
      {[1, 2].map((i) => (
        <div key={i} className="relative pl-7">
          <div className="absolute left-1.5 top-2.5 h-3 w-3 rounded-full border-2 border-border bg-background z-10" />
          <div className="rounded-lg border border-border p-3 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-[80%]" />
            <Skeleton className="h-3 w-[60%]" />
          </div>
        </div>
      ))}
    </div>
  );
}
