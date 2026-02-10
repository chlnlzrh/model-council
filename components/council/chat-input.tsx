"use client";

import { useState, useRef, useCallback } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DeliberationMode } from "@/lib/council/types";
import { getModeDefinition } from "@/lib/council/modes/index";

interface ChatInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  mode: DeliberationMode;
  stageName: string | null;
  stageIndex: number;
  stageTotal: number;
  elapsedMs: number;
}

export function ChatInput({
  onSend,
  isLoading,
  mode,
  stageName,
  stageIndex,
  stageTotal,
  elapsedMs,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const modeDef = getModeDefinition(mode);
  const modeName = modeDef?.name ?? "Council";

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, isLoading, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };

  const elapsedSec = Math.floor(elapsedMs / 1000);

  const statusText =
    isLoading && stageIndex > 0 && stageName
      ? `Stage ${stageIndex} of ${stageTotal} · ${stageName}... (${elapsedSec}s)`
      : "Enter to send · Shift+Enter for new line";

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            isLoading
              ? `${modeName} is deliberating...`
              : `Ask the ${modeName.toLowerCase()} anything...`
          }
          disabled={isLoading}
          rows={1}
          className="min-h-[40px] max-h-[120px] resize-none text-xs"
        />
        <Button
          onClick={handleSubmit}
          disabled={isLoading || !value.trim()}
          size="sm"
          className="h-10 px-3"
        >
          <Send className="h-3 w-3" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
      <p className="mx-auto mt-1 max-w-3xl text-center text-[10px] text-muted-foreground">
        {statusText}
      </p>
    </div>
  );
}
