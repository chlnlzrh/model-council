"use client";

/**
 * Generic SSE client hook for all deliberation modes.
 *
 * Unlike useCouncilStream (which has fixed stage1/stage2/stage3 state),
 * this hook stores mode-specific stage data in a generic Map, allowing
 * each mode to define its own state shape.
 *
 * Usage:
 *   const { stages, sendMessage, ... } = useDeliberationStream();
 *   sendMessage("vote", "Which framework?", { models: [...] });
 */

import { useState, useCallback, useRef } from "react";
import type { DeliberationMode, SSEEvent } from "@/lib/council/types";

export type StageStatus = "pending" | "loading" | "done" | "error";

export interface DeliberationStreamState {
  mode: DeliberationMode | null;
  conversationId: string | null;
  messageId: string | null;
  /** Mode-specific stage data: event type → payload */
  stages: Record<string, unknown>;
  /** Ordered list of completed event types (for rendering order) */
  eventLog: Array<{ type: string; timestamp: number }>;
  currentStage: string | null;
  isLoading: boolean;
  error: string | null;
  elapsedMs: number;
  title: string | null;
}

const INITIAL_STATE: DeliberationStreamState = {
  mode: null,
  conversationId: null,
  messageId: null,
  stages: {},
  eventLog: [],
  currentStage: null,
  isLoading: false,
  error: null,
  elapsedMs: 0,
  title: null,
};

export function useDeliberationStream() {
  const [state, setState] = useState<DeliberationStreamState>(INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setState((prev) => ({
        ...prev,
        elapsedMs: Date.now() - startTimeRef.current,
      }));
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const sendMessage = useCallback(
    async (
      mode: DeliberationMode,
      question: string,
      modeConfig?: Record<string, unknown>,
      existingConversationId?: string
    ) => {
      setState((prev) => ({
        ...INITIAL_STATE,
        mode,
        conversationId: existingConversationId ?? prev.conversationId,
        isLoading: true,
      }));
      startTimer();

      try {
        const body: Record<string, unknown> = { question, mode };
        if (modeConfig) body.modeConfig = modeConfig;
        if (existingConversationId)
          body.conversationId = existingConversationId;

        const response = await fetch("/api/council/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.json().catch(() => null);
          throw new Error(
            errorBody?.error ?? `HTTP ${response.status}: ${response.statusText}`
          );
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const dataLine = line.trim();
            if (!dataLine.startsWith("data: ")) continue;

            const json = dataLine.slice(6);
            let event: SSEEvent;
            try {
              event = JSON.parse(json) as SSEEvent;
            } catch {
              continue;
            }

            setState((prev) => applyDeliberationEvent(prev, event));
          }
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error";
        setState((prev) => ({
          ...prev,
          error: message,
          isLoading: false,
        }));
      } finally {
        stopTimer();
      }
    },
    [startTimer, stopTimer]
  );

  const reset = useCallback(() => {
    stopTimer();
    setState(INITIAL_STATE);
  }, [stopTimer]);

  const setConversationId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, conversationId: id }));
  }, []);

  return { ...state, sendMessage, reset, setConversationId };
}

/**
 * Generic event handler that stores all events in the stages map.
 * Mode-specific UI components read from stages[eventType].
 */
function applyDeliberationEvent(
  prev: DeliberationStreamState,
  event: SSEEvent
): DeliberationStreamState {
  const now = Date.now();

  switch (event.type) {
    // --- Shared events ---
    case "title_complete": {
      const titleData = event.data as { title: string };
      return { ...prev, title: titleData.title };
    }

    case "complete":
      return {
        ...prev,
        isLoading: false,
        currentStage: null,
      };

    case "error":
      return {
        ...prev,
        error: event.message ?? "Unknown error",
        isLoading: false,
        currentStage: null,
      };

    // --- Mode-specific events: store in stages map ---
    default: {
      // Extract conversationId/messageId from *_start events
      let conversationId = prev.conversationId;
      let messageId = prev.messageId;
      const data = event.data as Record<string, unknown> | undefined;

      if (data?.conversationId) {
        conversationId = data.conversationId as string;
      }
      if (data?.messageId) {
        messageId = data.messageId as string;
      }

      // Determine if this is a "start" event (sets currentStage)
      const isStartEvent = event.type.endsWith("_start");
      // Accumulate array data for events that repeat (e.g. specialist_complete)
      const existingData = prev.stages[event.type];
      let stageData: unknown;
      if (existingData && Array.isArray(existingData)) {
        stageData = [...existingData, event.data];
      } else if (existingData && event.data) {
        // Convert to array if we get a second event of the same type
        stageData = [existingData, event.data];
      } else {
        stageData = event.data ?? {};
      }

      return {
        ...prev,
        conversationId,
        messageId,
        currentStage: isStartEvent ? event.type : prev.currentStage,
        stages: {
          ...prev.stages,
          [event.type]: stageData,
        },
        eventLog: [...prev.eventLog, { type: event.type, timestamp: now }],
      };
    }
  }
}
