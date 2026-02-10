"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import { CollapsibleContent } from "./collapsible-content";
import type { ModePanelProps } from "./types";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Shared panel for Chain and Decompose modes.
 *
 * Vertical numbered pipeline with step/task cards.
 */
export function SequentialPanel({ mode, stages, isLoading }: ModePanelProps) {
  const isChain = mode === "chain";

  if (isChain) {
    return <ChainView stages={stages} isLoading={isLoading} />;
  }
  return <DecomposeView stages={stages} isLoading={isLoading} />;
}

function ChainView({ stages, isLoading }: { stages: Record<string, unknown>; isLoading: boolean }) {
  const chainStart = stages["chain_start"] as Record<string, unknown> | undefined;
  const steps = normalizeArray(stages["chain_step_complete"]);
  const totalSteps = Number(chainStart?.totalSteps ?? steps.length);

  return (
    <div className="space-y-3 p-4">
      {totalSteps > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {steps.length} / {totalSteps} steps complete
        </div>
      )}

      <div className="relative space-y-2">
        {steps.length > 1 && (
          <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
        )}
        {steps.map((step, i) => (
          <StepCard key={i} index={i} step={step} isLast={i === steps.length - 1} />
        ))}
      </div>

      {isLoading && steps.length === 0 && <SequentialSkeleton />}
      {!isLoading && steps.length === 0 && (
        <p className="py-4 text-xs text-muted-foreground">No steps completed.</p>
      )}
    </div>
  );
}

function DecomposeView({ stages, isLoading }: { stages: Record<string, unknown>; isLoading: boolean }) {
  const plan = stages["plan_complete"] as Record<string, unknown> | undefined;
  const tasks = normalizeArray(stages["task_complete"]);
  const assembly = stages["assembly_complete"] as Record<string, unknown> | undefined;
  const taskCount = Number(plan?.taskCount ?? tasks.length);
  const hasContent = plan != null || tasks.length > 0;

  return (
    <div className="space-y-3 p-4">
      {/* Plan overview */}
      {plan != null && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Task Plan ({taskCount} tasks)
          </div>
          {Array.isArray(plan.tasks) && (
            <ol className="list-decimal list-inside text-xs space-y-0.5 text-muted-foreground">
              {(plan.tasks as Array<Record<string, unknown>>).map((t, i) => (
                <li key={i}>{String(t.title ?? t.description ?? `Task ${i + 1}`)}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Task results */}
      {taskCount > 0 && (
        <div className="text-[10px] text-muted-foreground">
          {tasks.length} / {taskCount} tasks complete
        </div>
      )}

      <div className="relative space-y-2">
        {tasks.length > 1 && (
          <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
        )}
        {tasks.map((task, i) => (
          <TaskCard key={i} index={i} task={task} />
        ))}
      </div>

      {/* Assembly */}
      {assembly != null && (
        <div className="group rounded-lg border border-emerald-300 dark:border-emerald-700 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              Assembled Answer
            </div>
            {assembly.wordCount != null && (
              <span className="text-[10px] text-muted-foreground">{String(assembly.wordCount)} words</span>
            )}
          </div>
          <CollapsibleContent
            content={String(assembly.finalAnswer ?? assembly.response ?? "")}
            copyable
          />
        </div>
      )}

      {isLoading && !hasContent && <SequentialSkeleton />}
      {!isLoading && !hasContent && (
        <p className="py-4 text-xs text-muted-foreground">No steps completed.</p>
      )}
    </div>
  );
}

function StepCard({ index, step, isLast }: { index: number; step: Record<string, unknown>; isLast?: boolean }) {
  const [expanded, setExpanded] = useState(index === 0);
  const color = getModelColor(index);
  const data = (step.data as Record<string, unknown>) ?? step;
  const model = String(data.model ?? "");
  const mandate = String(data.mandate ?? "");
  const content = String(data.content ?? data.response ?? "");
  const wordCount = data.wordCount as number | undefined;

  return (
    <div className="relative pl-7">
      <div className={cn(
        "absolute left-1.5 top-2.5 flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-bold text-white z-10",
        color.dot
      )}>
        {index + 1}
      </div>
      <div className="rounded-lg border border-border">
        <Button
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between px-3 py-2 text-left h-auto font-normal hover:bg-transparent"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">Step {index + 1}</span>
            {mandate && <span className="text-[10px] text-muted-foreground truncate max-w-[160px]">{mandate}</span>}
          </div>
          <div className="flex items-center gap-2">
            {model && <span className="text-[10px] text-muted-foreground">{getModelDisplayName(model)}</span>}
            {wordCount !== undefined && <span className="text-[10px] text-muted-foreground">{wordCount}w</span>}
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </div>
        </Button>
        {expanded && content && (
          <div className="border-t px-3 py-2">
            <CollapsibleContent content={content} copyable={isLast} />
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ index, task }: { index: number; task: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const color = getModelColor(index);
  const title = String(task.taskTitle ?? `Task ${(task.taskNumber as number) ?? index + 1}`);
  const consensus = String(task.consensus ?? "");

  return (
    <div className="relative pl-7">
      <div className={cn(
        "absolute left-1.5 top-2.5 flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-bold text-white z-10",
        color.dot
      )}>
        {index + 1}
      </div>
      <div className="rounded-lg border border-border">
        <Button
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex w-full items-center justify-between px-3 py-2 text-left h-auto font-normal hover:bg-transparent"
        >
          <span className="text-xs font-medium truncate">{title}</span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
        {expanded && consensus && (
          <div className="border-t px-3 py-2">
            <CollapsibleContent content={consensus} copyable />
          </div>
        )}
      </div>
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

function SequentialSkeleton() {
  return (
    <div className="relative space-y-2">
      <div className="absolute left-3 top-3 bottom-3 w-px bg-border" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="relative pl-7">
          <Skeleton className="absolute left-1.5 top-2.5 h-3 w-3 rounded-full" />
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-[75%]" />
          </div>
        </div>
      ))}
    </div>
  );
}
