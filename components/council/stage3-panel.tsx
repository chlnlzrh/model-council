"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getModelDisplayName } from "@/lib/council/model-colors";
import type { Stage3Response } from "@/lib/council/types";
import type { StageStatus } from "@/hooks/use-council-stream";

interface Stage3PanelProps {
  synthesis: Stage3Response | null;
  status: StageStatus;
  modelCount: number;
}

export function Stage3Panel({ synthesis, status, modelCount }: Stage3PanelProps) {
  const [copied, setCopied] = useState(false);

  if (status === "loading" || (status === "pending" && !synthesis)) {
    return <Stage3Skeleton />;
  }

  if (!synthesis) {
    return <p className="py-4 text-xs text-muted-foreground">No synthesis available.</p>;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(synthesis.response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group rounded-lg border-l-[3px] border-l-primary bg-primary/5 p-4">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <Badge variant="default" className="text-[10px]">
          Chairman
        </Badge>
        <span className="text-[11px] font-semibold">
          {getModelDisplayName(synthesis.model)}
        </span>
        <span className="text-[10px] text-muted-foreground">
          · Final Synthesis
        </span>
      </div>

      {/* Content */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed">
        <ReactMarkdown>{synthesis.response}</ReactMarkdown>
      </div>

      {/* Meta + Copy */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">
          {getModelDisplayName(synthesis.model)} ·{" "}
          {(synthesis.responseTimeMs / 1000).toFixed(1)}s · Synthesized from{" "}
          {modelCount} models
        </span>
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

function Stage3Skeleton() {
  return (
    <div className="rounded-lg border-l-[3px] border-l-muted bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-16 rounded" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-[90%]" />
        <Skeleton className="h-3 w-[80%]" />
        <Skeleton className="h-3 w-[85%]" />
        <Skeleton className="h-3 w-[70%]" />
        <Skeleton className="h-3 w-[60%]" />
      </div>
    </div>
  );
}
