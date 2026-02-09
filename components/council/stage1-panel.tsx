"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getModelColor, getModelDisplayName } from "@/lib/council/model-colors";
import type { Stage1Response } from "@/lib/council/types";
import type { StageStatus } from "@/hooks/use-council-stream";

interface Stage1PanelProps {
  responses: Stage1Response[];
  status: StageStatus;
}

export function Stage1Panel({ responses, status }: Stage1PanelProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (status === "loading" || (status === "pending" && responses.length === 0)) {
    return <Stage1Skeleton />;
  }

  if (responses.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">No responses received.</p>;
  }

  const active = responses[activeIndex];
  const fastest = Math.min(...responses.map((r) => r.responseTimeMs));

  return (
    <div className="space-y-3">
      {/* Model pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {responses.map((r, i) => {
          const color = getModelColor(i);
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
              <span
                className={cn(
                  "text-[10px]",
                  r.responseTimeMs === fastest
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                {(r.responseTimeMs / 1000).toFixed(1)}s
              </span>
            </button>
          );
        })}
      </div>

      {/* Active response */}
      {active && <ResponseContent response={active} />}
    </div>
  );
}

function ResponseContent({ response }: { response: Stage1Response }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isLong = response.response.length > 600;
  const showFull = expanded || !isLong;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(response.response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <div
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed",
          !showFull && "max-h-[160px] overflow-hidden"
        )}
      >
        <ReactMarkdown>{response.response}</ReactMarkdown>
      </div>

      {/* Gradient fade for collapsed */}
      {!showFull && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
      )}

      {/* Expand/collapse + copy */}
      <div className="mt-2 flex items-center gap-2">
        {isLong && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px] text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="mr-1 h-3 w-3" /> Show less
              </>
            ) : (
              <>
                <ChevronDown className="mr-1 h-3 w-3" /> Show more
              </>
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="mr-1 h-3 w-3 text-emerald-500" />
          ) : (
            <Copy className="mr-1 h-3 w-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function Stage1Skeleton() {
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
