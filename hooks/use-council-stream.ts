"use client";

import { useState, useCallback, useRef } from "react";
import type {
  Stage1Response,
  Stage2Response,
  Stage3Response,
  Stage2Metadata,
  SSEEvent,
} from "@/lib/council/types";

export type StageStatus = "pending" | "loading" | "done";

export interface CouncilStreamState {
  stage1: Stage1Response[];
  stage2: Stage2Response[];
  stage2Metadata: Stage2Metadata | null;
  stage3: Stage3Response | null;
  title: string | null;
  conversationId: string | null;
  messageId: string | null;
  stageStatus: {
    stage1: StageStatus;
    stage2: StageStatus;
    stage3: StageStatus;
  };
  currentStage: number; // 0 = idle, 1/2/3 = active stage
  isLoading: boolean;
  error: string | null;
  elapsedMs: number;
}

const INITIAL_STATE: CouncilStreamState = {
  stage1: [],
  stage2: [],
  stage2Metadata: null,
  stage3: null,
  title: null,
  conversationId: null,
  messageId: null,
  stageStatus: { stage1: "pending", stage2: "pending", stage3: "pending" },
  currentStage: 0,
  isLoading: false,
  error: null,
  elapsedMs: 0,
};

export function useCouncilStream() {
  const [state, setState] = useState<CouncilStreamState>(INITIAL_STATE);
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
      question: string,
      councilModels?: string[],
      chairmanModel?: string,
      existingConversationId?: string
    ) => {
      // For follow-ups, preserve conversationId but reset stage data
      setState((prev) => ({
        ...INITIAL_STATE,
        conversationId: existingConversationId ?? prev.conversationId,
        isLoading: true,
      }));
      startTimer();

      try {
        const body: Record<string, unknown> = { question };
        if (councilModels) body.councilModels = councilModels;
        if (chairmanModel) body.chairmanModel = chairmanModel;

        // Use existing conversation ID for follow-ups
        const convId = existingConversationId;
        if (convId) body.conversationId = convId;

        const response = await fetch("/api/council/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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

            setState((prev) => applyEvent(prev, event));
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

  // Set conversationId externally (e.g. when loading a conversation)
  const setConversationId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, conversationId: id }));
  }, []);

  return { ...state, sendMessage, reset, setConversationId };
}

function applyEvent(
  prev: CouncilStreamState,
  event: SSEEvent
): CouncilStreamState {
  switch (event.type) {
    case "stage1_start": {
      const startData = event.data as {
        conversationId?: string;
        messageId?: string;
      } | undefined;
      return {
        ...prev,
        currentStage: 1,
        conversationId: startData?.conversationId ?? prev.conversationId,
        messageId: startData?.messageId ?? prev.messageId,
        stageStatus: { ...prev.stageStatus, stage1: "loading" },
      };
    }

    case "stage1_complete":
      return {
        ...prev,
        stage1: event.data as Stage1Response[],
        stageStatus: { ...prev.stageStatus, stage1: "done" },
      };

    case "stage2_start":
      return {
        ...prev,
        currentStage: 2,
        stageStatus: { ...prev.stageStatus, stage2: "loading" },
      };

    case "stage2_complete":
      return {
        ...prev,
        stage2: event.data as Stage2Response[],
        stage2Metadata: (event.metadata as Stage2Metadata) ?? null,
        stageStatus: { ...prev.stageStatus, stage2: "done" },
      };

    case "stage3_start":
      return {
        ...prev,
        currentStage: 3,
        stageStatus: { ...prev.stageStatus, stage3: "loading" },
      };

    case "stage3_complete":
      return {
        ...prev,
        stage3: event.data as Stage3Response,
        stageStatus: { ...prev.stageStatus, stage3: "done" },
      };

    case "title_complete": {
      const titleData = event.data as { title: string };
      return { ...prev, title: titleData.title };
    }

    case "complete":
      return { ...prev, isLoading: false, currentStage: 0 };

    case "error":
      return {
        ...prev,
        error: event.message ?? "Unknown error",
        isLoading: false,
        currentStage: 0,
      };

    default:
      return prev;
  }
}
