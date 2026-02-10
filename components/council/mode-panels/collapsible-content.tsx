"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

interface CollapsibleContentProps {
  content: string;
  maxHeight?: number;
  copyable?: boolean;
}

export function CollapsibleContent({
  content,
  maxHeight = 160,
  copyable = false,
}: CollapsibleContentProps) {
  const [expanded, setExpanded] = useState(false);
  const [isLong, setIsLong] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current) {
      setIsLong(contentRef.current.scrollHeight > maxHeight);
    }
  }, [content, maxHeight]);

  const showFull = expanded || !isLong;

  return (
    <div className="group relative">
      <div
        ref={contentRef}
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none text-xs leading-relaxed",
          !showFull && "overflow-hidden"
        )}
        style={!showFull ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>

      {!showFull && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
      )}

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
        {copyable && <CopyButton text={content} />}
      </div>
    </div>
  );
}
