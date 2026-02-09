"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useCouncilStream } from "@/hooks/use-council-stream";
import type { StageStatus } from "@/hooks/use-council-stream";
import { Stage1Panel } from "./stage1-panel";
import { Stage2Panel } from "./stage2-panel";
import { Stage3Panel } from "./stage3-panel";
import { ChatInput } from "./chat-input";

interface CouncilViewProps {
  onTitleChange?: (title: string) => void;
}

export function CouncilView({ onTitleChange }: CouncilViewProps) {
  const stream = useCouncilStream();
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]);
  const [activeTab, setActiveTab] = useState("responses");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Build model index map from stage 1 responses for consistent colors
  const modelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    stream.stage1.forEach((r, i) => map.set(r.model, i));
    return map;
  }, [stream.stage1]);

  // Auto-switch to latest completed stage tab
  useEffect(() => {
    if (stream.stageStatus.stage3 === "done") setActiveTab("synthesis");
    else if (stream.stageStatus.stage2 === "done") setActiveTab("rankings");
    else if (stream.stageStatus.stage1 === "done") setActiveTab("responses");
  }, [stream.stageStatus]);

  // Notify parent of title changes
  useEffect(() => {
    if (stream.title && onTitleChange) {
      onTitleChange(stream.title);
    }
  }, [stream.title, onTitleChange]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, stream.stage1, stream.stage3]);

  const handleSend = (message: string) => {
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    stream.sendMessage(message);
  };

  const hasResponse =
    stream.isLoading ||
    stream.stage1.length > 0 ||
    stream.stage3 !== null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Empty state */}
          {messages.length === 0 && !stream.isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-3xl opacity-20 mb-3">&#9878;</div>
              <h2 className="text-sm font-semibold text-foreground">
                Ask the Council
              </h2>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Type a question below. Four AI models will respond
                independently, rank each other&apos;s answers, and a chairman
                will synthesize the best response.
              </p>
            </div>
          )}

          {/* User messages + council responses */}
          {messages.map((msg, i) => (
            <div key={i}>
              {/* User bubble */}
              {msg.role === "user" && (
                <div className="flex justify-end">
                  <div className="rounded-xl rounded-br-sm bg-foreground px-3 py-2 text-xs text-background max-w-[70%]">
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Council response card */}
          {hasResponse && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
                  <StageTab
                    value="responses"
                    label="Responses"
                    status={stream.stageStatus.stage1}
                  />
                  <StageTab
                    value="rankings"
                    label="Rankings"
                    status={stream.stageStatus.stage2}
                  />
                  <StageTab
                    value="synthesis"
                    label="Synthesis"
                    status={stream.stageStatus.stage3}
                  />
                </TabsList>

                <div className="p-4">
                  <TabsContent value="responses" className="mt-0">
                    <Stage1Panel
                      responses={stream.stage1}
                      status={stream.stageStatus.stage1}
                    />
                  </TabsContent>
                  <TabsContent value="rankings" className="mt-0">
                    <Stage2Panel
                      rankings={stream.stage2}
                      metadata={stream.stage2Metadata}
                      status={stream.stageStatus.stage2}
                      modelIndexMap={modelIndexMap}
                    />
                  </TabsContent>
                  <TabsContent value="synthesis" className="mt-0">
                    <Stage3Panel
                      synthesis={stream.stage3}
                      status={stream.stageStatus.stage3}
                      modelCount={stream.stage1.length}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Chat input */}
      <ChatInput
        onSend={handleSend}
        isLoading={stream.isLoading}
        currentStage={stream.currentStage}
        elapsedMs={stream.elapsedMs}
      />
    </div>
  );
}

function StageTab({
  value,
  label,
  status,
}: {
  value: string;
  label: string;
  status: StageStatus;
}) {
  return (
    <TabsTrigger
      value={value}
      className="gap-1.5 text-[11px] data-[state=active]:shadow-none"
    >
      {label}
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          status === "done" && "bg-emerald-500",
          status === "loading" && "bg-amber-500 animate-pulse",
          status === "pending" && "bg-muted-foreground/40"
        )}
      />
    </TabsTrigger>
  );
}
