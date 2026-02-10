"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useCouncilStream } from "@/hooks/use-council-stream";
import { useDeliberationStream } from "@/hooks/use-deliberation-stream";
import type { StageStatus } from "@/hooks/use-council-stream";
import type { DeliberationMode } from "@/lib/council/types";
import { getModeDefinition } from "@/lib/council/modes/index";
import { getModeStageLabel, getModeStageIndex, getModeStageTotalCount } from "@/lib/council/mode-stages";
import { getModePanel } from "./mode-panels/index";
import { Stage1Panel } from "./stage1-panel";
import { Stage2Panel } from "./stage2-panel";
import { Stage3Panel } from "./stage3-panel";
import { ChatInput } from "./chat-input";
import { ModePicker } from "./mode-picker";
import { Download } from "lucide-react";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface DeliberationViewProps {
  mode: DeliberationMode;
  onModeChange: (mode: DeliberationMode) => void;
  onTitleChange?: (title: string) => void;
  onConversationCreated?: (id: string, title: string, mode?: string) => void;
  councilModels?: string[];
  chairmanModel?: string;
  loadConversationId?: string | null;
}

export function DeliberationView({
  mode,
  onModeChange,
  onTitleChange,
  onConversationCreated,
  councilModels,
  chairmanModel,
  loadConversationId,
}: DeliberationViewProps) {
  const isCouncil = mode === "council";

  if (isCouncil) {
    return (
      <CouncilModeView
        mode={mode}
        onModeChange={onModeChange}
        onTitleChange={onTitleChange}
        onConversationCreated={onConversationCreated}
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        loadConversationId={loadConversationId}
      />
    );
  }

  return (
    <GenericModeView
      mode={mode}
      onModeChange={onModeChange}
      onTitleChange={onTitleChange}
      onConversationCreated={onConversationCreated}
      councilModels={councilModels}
      chairmanModel={chairmanModel}
      loadConversationId={loadConversationId}
    />
  );
}

/**
 * Council mode — uses existing useCouncilStream + Stage1/2/3 panels.
 * This is essentially the original CouncilView logic.
 */
function CouncilModeView({
  mode,
  onModeChange,
  onTitleChange,
  onConversationCreated,
  councilModels,
  chairmanModel,
  loadConversationId,
}: DeliberationViewProps) {
  const stream = useCouncilStream();
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [activeTab, setActiveTab] = useState("responses");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [modeLocked, setModeLocked] = useState(false);

  const modelIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    stream.stage1.forEach((r, i) => map.set(r.model, i));
    return map;
  }, [stream.stage1]);

  // Load conversation
  useEffect(() => {
    if (!loadConversationId) {
      setHistory([]);
      setModeLocked(false);
      stream.reset();
      return;
    }

    let cancelled = false;
    setLoadingConversation(true);
    setModeLocked(true);
    stream.reset();

    fetch(`/api/conversations/${loadConversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const msgs: HistoryMessage[] = [];
        for (const msg of data.messages ?? []) {
          if (msg.role === "user") {
            msgs.push({ role: "user", content: msg.content });
          } else if (msg.stages?.stage3) {
            msgs.push({ role: "assistant", content: msg.stages.stage3.response });
          }
        }
        setHistory(msgs);
        stream.setConversationId(loadConversationId);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversationId]);

  useEffect(() => {
    if (stream.stageStatus.stage3 === "done") setActiveTab("synthesis");
    else if (stream.stageStatus.stage2 === "done") setActiveTab("rankings");
    else if (stream.stageStatus.stage1 === "done") setActiveTab("responses");
  }, [stream.stageStatus]);

  useEffect(() => {
    if (stream.conversationId && onConversationCreated) {
      onConversationCreated(stream.conversationId, "New Council", mode);
    }
  }, [stream.conversationId, onConversationCreated, mode]);

  useEffect(() => {
    if (stream.title && onTitleChange) onTitleChange(stream.title);
    if (stream.title && stream.conversationId && onConversationCreated) {
      onConversationCreated(stream.conversationId, stream.title, mode);
    }
  }, [stream.title, onTitleChange, stream.conversationId, onConversationCreated, mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, stream.stage1, stream.stage3, stream.isLoading]);

  const handleSend = useCallback(
    (message: string) => {
      setHistory((prev) => [...prev, { role: "user", content: message }]);
      setModeLocked(true);
      stream.sendMessage(message, councilModels, chairmanModel, stream.conversationId ?? undefined);
    },
    [councilModels, chairmanModel, stream]
  );

  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !stream.isLoading && stream.stage3) {
      setHistory((prev) => [...prev, { role: "assistant", content: stream.stage3!.response }]);
    }
    prevLoadingRef.current = stream.isLoading;
  }, [stream.isLoading, stream.stage3]);

  const handleExport = useCallback(() => {
    const id = stream.conversationId ?? loadConversationId;
    if (!id) return;
    window.open(`/api/conversations/${id}/export`, "_blank");
  }, [stream.conversationId, loadConversationId]);

  const canExport = !stream.isLoading && history.length > 0 && (stream.conversationId || loadConversationId);
  const hasActiveResponse = stream.isLoading || stream.stage1.length > 0 || stream.stage3 !== null;

  // Stage info for chat input
  const stageIndex = stream.currentStage;
  const stageLabel = stageIndex > 0
    ? getModeStageLabel("council", `stage${stageIndex}_start`)
    : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {canExport && (
        <div className="flex items-center justify-between px-4 pt-2">
          <ModePickerWrapper mode={mode} onModeChange={onModeChange} disabled={modeLocked} />
          <ExportButton onClick={handleExport} />
        </div>
      )}
      {!canExport && (
        <div className="flex items-center px-4 pt-2">
          <ModePickerWrapper mode={mode} onModeChange={onModeChange} disabled={modeLocked} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {history.length === 0 && !stream.isLoading && !loadingConversation && (
            <EmptyState mode={mode} />
          )}

          {loadingConversation && <LoadingState />}

          {history.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {hasActiveResponse && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full justify-start rounded-none border-b border-border bg-transparent px-2">
                  <StageTab value="responses" label="Responses" status={stream.stageStatus.stage1} />
                  <StageTab value="rankings" label="Rankings" status={stream.stageStatus.stage2} />
                  <StageTab value="synthesis" label="Synthesis" status={stream.stageStatus.stage3} />
                </TabsList>
                <div className="p-4">
                  <TabsContent value="responses" className="mt-0">
                    <Stage1Panel responses={stream.stage1} status={stream.stageStatus.stage1} />
                  </TabsContent>
                  <TabsContent value="rankings" className="mt-0">
                    <Stage2Panel rankings={stream.stage2} metadata={stream.stage2Metadata} status={stream.stageStatus.stage2} modelIndexMap={modelIndexMap} />
                  </TabsContent>
                  <TabsContent value="synthesis" className="mt-0">
                    <Stage3Panel synthesis={stream.stage3} status={stream.stageStatus.stage3} modelCount={stream.stage1.length} />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatInput
        onSend={handleSend}
        isLoading={stream.isLoading}
        mode={mode}
        stageName={stageLabel}
        stageIndex={stageIndex}
        stageTotal={getModeStageTotalCount(mode)}
        elapsedMs={stream.elapsedMs}
      />
    </div>
  );
}

/**
 * Generic mode view — uses useDeliberationStream + dynamic mode panels.
 */
function GenericModeView({
  mode,
  onModeChange,
  onTitleChange,
  onConversationCreated,
  councilModels,
  loadConversationId,
}: DeliberationViewProps) {
  const stream = useDeliberationStream();
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [modeLocked, setModeLocked] = useState(false);

  const ModePanel = getModePanel(mode);

  // Load conversation
  useEffect(() => {
    if (!loadConversationId) {
      setHistory([]);
      setModeLocked(false);
      stream.reset();
      return;
    }

    let cancelled = false;
    setLoadingConversation(true);
    setModeLocked(true);
    stream.reset();

    fetch(`/api/conversations/${loadConversationId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;

        const msgs: HistoryMessage[] = [];
        for (const msg of data.messages ?? []) {
          if (msg.role === "user") {
            msgs.push({ role: "user", content: msg.content });
          } else if (msg.stages?.deliberationStages) {
            // Extract last meaningful content for history display
            const stageData = msg.stages.deliberationStages as Record<string, unknown>;
            const lastContent = extractLastContent(stageData);
            if (lastContent) {
              msgs.push({ role: "assistant", content: lastContent });
            }
          }
        }
        setHistory(msgs);
        stream.setConversationId(loadConversationId);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingConversation(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversationId]);

  useEffect(() => {
    if (stream.conversationId && onConversationCreated) {
      onConversationCreated(stream.conversationId, "New Session", mode);
    }
  }, [stream.conversationId, onConversationCreated, mode]);

  useEffect(() => {
    if (stream.title && onTitleChange) onTitleChange(stream.title);
    if (stream.title && stream.conversationId && onConversationCreated) {
      onConversationCreated(stream.conversationId, stream.title, mode);
    }
  }, [stream.title, onTitleChange, stream.conversationId, onConversationCreated, mode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, stream.stages, stream.isLoading]);

  const handleSend = useCallback(
    (message: string) => {
      setHistory((prev) => [...prev, { role: "user", content: message }]);
      setModeLocked(true);
      stream.sendMessage(
        mode,
        message,
        councilModels ? { models: councilModels } : undefined,
        stream.conversationId ?? undefined
      );
    },
    [mode, councilModels, stream]
  );

  // When stream completes, add synthesis/result to history
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !stream.isLoading) {
      const lastContent = extractLastContent(stream.stages);
      if (lastContent) {
        setHistory((prev) => [...prev, { role: "assistant", content: lastContent }]);
      }
    }
    prevLoadingRef.current = stream.isLoading;
  }, [stream.isLoading, stream.stages]);

  const handleExport = useCallback(() => {
    const id = stream.conversationId ?? loadConversationId;
    if (!id) return;
    window.open(`/api/conversations/${id}/export`, "_blank");
  }, [stream.conversationId, loadConversationId]);

  const canExport = !stream.isLoading && history.length > 0 && (stream.conversationId || loadConversationId);
  const hasActiveStages = stream.isLoading || Object.keys(stream.stages).length > 0;

  const stageIndex = stream.currentStage
    ? getModeStageIndex(mode, stream.currentStage)
    : 0;
  const stageLabel = stream.currentStage
    ? getModeStageLabel(mode, stream.currentStage)
    : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-2">
        <ModePickerWrapper mode={mode} onModeChange={onModeChange} disabled={modeLocked} />
        {canExport && <ExportButton onClick={handleExport} />}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {history.length === 0 && !stream.isLoading && !loadingConversation && (
            <EmptyState mode={mode} />
          )}

          {loadingConversation && <LoadingState />}

          {history.map((msg, i) => (
            <MessageBubble key={i} message={msg} />
          ))}

          {hasActiveStages && ModePanel && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <ModePanel
                mode={mode}
                stages={stream.stages}
                eventLog={stream.eventLog}
                isLoading={stream.isLoading}
                currentStage={stream.currentStage}
              />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatInput
        onSend={handleSend}
        isLoading={stream.isLoading}
        mode={mode}
        stageName={stageLabel}
        stageIndex={stageIndex}
        stageTotal={getModeStageTotalCount(mode)}
        elapsedMs={stream.elapsedMs}
      />
    </div>
  );
}

// --- Shared sub-components ---

function ModePickerWrapper({
  mode,
  onModeChange,
  disabled,
}: {
  mode: DeliberationMode;
  onModeChange: (mode: DeliberationMode) => void;
  disabled: boolean;
}) {
  return <ModePicker selected={mode} onSelect={onModeChange} disabled={disabled} />;
}

function ExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="Export as Markdown"
    >
      <Download className="h-3.5 w-3.5" />
      Export
    </button>
  );
}

function EmptyState({ mode }: { mode: DeliberationMode }) {
  const def = getModeDefinition(mode);
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="text-3xl opacity-20 mb-3">&#9878;</div>
      <h2 className="text-sm font-semibold text-foreground">
        {def ? `Ask the ${def.name}` : "Ask a Question"}
      </h2>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
        {def?.description ?? "Type a question below to start."}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex justify-center py-12">
      <p className="text-xs text-muted-foreground animate-pulse">Loading conversation...</p>
    </div>
  );
}

function MessageBubble({ message }: { message: HistoryMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="rounded-xl rounded-br-sm bg-foreground px-3 py-2 text-xs text-background max-w-[70%]">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
        <ReactMarkdown>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}

function StageTab({ value, label, status }: { value: string; label: string; status: StageStatus }) {
  return (
    <TabsTrigger value={value} className="gap-1.5 text-[11px] data-[state=active]:shadow-none">
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

/**
 * Extract the last meaningful content from stages for history display.
 * Tries synthesis/verdict/winner/assembly/report/hardened output in priority order.
 */
function extractLastContent(stages: Record<string, unknown>): string | null {
  const priorityKeys = [
    "synthesis_complete",
    "synthesize_complete",
    "verdict_complete",
    "winner_declared",
    "assembly_complete",
    "report_complete",
    "consolidation_complete",
    "champion_declared",
    "all_answers_complete",
    "scoring_complete",
    "refinement_complete",
  ];

  for (const key of priorityKeys) {
    const data = stages[key] as Record<string, unknown> | undefined;
    if (!data) continue;

    const content =
      data.response ??
      data.synthesizedAnswer ??
      data.integratedAssessment ??
      data.consolidatedFeedback ??
      data.hardenedOutput ??
      data.winnerResponse ??
      data.assembledDocument ??
      data.finalAnswer ??
      data.report ??
      data.finalVerdict ??
      data.champion;

    if (content && typeof content === "string") return content;
  }

  return null;
}
