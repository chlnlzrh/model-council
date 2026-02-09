"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useCouncilStream } from "@/hooks/use-council-stream";
import type { StageStatus } from "@/hooks/use-council-stream";
import { Stage1Panel } from "./stage1-panel";
import { Stage2Panel } from "./stage2-panel";
import { Stage3Panel } from "./stage3-panel";
import { ChatInput } from "./chat-input";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface CouncilViewProps {
  onTitleChange?: (title: string) => void;
  onConversationCreated?: (id: string, title: string) => void;
  councilModels?: string[];
  chairmanModel?: string;
  loadConversationId?: string | null;
}

export function CouncilView({
  onTitleChange,
  onConversationCreated,
  councilModels,
  chairmanModel,
  loadConversationId,
}: CouncilViewProps) {
  const stream = useCouncilStream();
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [activeTab, setActiveTab] = useState("responses");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);

  // Build model index map from stage 1 responses for consistent colors
  const modelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    stream.stage1.forEach((r, i) => map.set(r.model, i));
    return map;
  }, [stream.stage1]);

  // Load conversation from DB when loadConversationId changes
  useEffect(() => {
    if (!loadConversationId) {
      // New conversation — reset everything
      setHistory([]);
      stream.reset();
      return;
    }

    let cancelled = false;
    setLoadingConversation(true);
    stream.reset();

    fetch(`/api/conversations/${loadConversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;

        // Build history from loaded messages
        const msgs: HistoryMessage[] = [];
        for (const msg of data.messages ?? []) {
          if (msg.role === "user") {
            msgs.push({ role: "user", content: msg.content });
          } else if (msg.stages?.stage3) {
            msgs.push({
              role: "assistant",
              content: msg.stages.stage3.response,
            });
          }
        }
        setHistory(msgs);
        stream.setConversationId(loadConversationId);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversationId]);

  // Auto-switch to latest completed stage tab
  useEffect(() => {
    if (stream.stageStatus.stage3 === "done") setActiveTab("synthesis");
    else if (stream.stageStatus.stage2 === "done") setActiveTab("rankings");
    else if (stream.stageStatus.stage1 === "done") setActiveTab("responses");
  }, [stream.stageStatus]);

  // Notify parent when conversation is created by SSE
  useEffect(() => {
    if (stream.conversationId && onConversationCreated) {
      onConversationCreated(stream.conversationId, "New Council");
    }
  }, [stream.conversationId, onConversationCreated]);

  // Notify parent of title changes
  useEffect(() => {
    if (stream.title && onTitleChange) {
      onTitleChange(stream.title);
    }
    if (stream.title && stream.conversationId && onConversationCreated) {
      onConversationCreated(stream.conversationId, stream.title);
    }
  }, [stream.title, onTitleChange, stream.conversationId, onConversationCreated]);

  // When stage 3 completes, add the current turn to history
  useEffect(() => {
    if (stream.stage3 && stream.stageStatus.stage3 === "done" && !stream.isLoading) {
      // The synthesis is now part of the conversation history
    }
  }, [stream.stage3, stream.stageStatus.stage3, stream.isLoading]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, stream.stage1, stream.stage3, stream.isLoading]);

  const handleSend = useCallback(
    (message: string) => {
      // Add user message to history
      setHistory((prev) => [...prev, { role: "user", content: message }]);

      // If we already have a conversationId (from loading or previous turn), use it
      stream.sendMessage(
        message,
        councilModels,
        chairmanModel,
        stream.conversationId ?? undefined
      );
    },
    [councilModels, chairmanModel, stream]
  );

  // When stream completes with a synthesis, add it to history
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !stream.isLoading && stream.stage3) {
      setHistory((prev) => [
        ...prev,
        { role: "assistant", content: stream.stage3!.response },
      ]);
    }
    prevLoadingRef.current = stream.isLoading;
  }, [stream.isLoading, stream.stage3]);

  const hasActiveResponse =
    stream.isLoading ||
    stream.stage1.length > 0 ||
    stream.stage3 !== null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* Empty state */}
          {history.length === 0 && !stream.isLoading && !loadingConversation && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="text-3xl opacity-20 mb-3">&#9878;</div>
              <h2 className="text-sm font-semibold text-foreground">
                Ask the Council
              </h2>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Type a question below. Multiple AI models will respond
                independently, rank each other&apos;s answers, and a chairman
                will synthesize the best response.
              </p>
            </div>
          )}

          {loadingConversation && (
            <div className="flex justify-center py-12">
              <p className="text-xs text-muted-foreground animate-pulse">
                Loading conversation...
              </p>
            </div>
          )}

          {/* Conversation history */}
          {history.map((msg, i) => (
            <div key={i}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="rounded-xl rounded-br-sm bg-foreground px-3 py-2 text-xs text-background max-w-[70%]">
                    {msg.content}
                  </div>
                </div>
              ) : (
                // Previous assistant synthesis (collapsed, no stage details)
                <div className="rounded-xl border border-border bg-card p-3">
                  <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Active council response card (current turn, with stage tabs) */}
          {hasActiveResponse && (
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
