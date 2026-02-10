import type { DeliberationMode } from "@/lib/council/types";

export interface ModePanelProps {
  mode: DeliberationMode;
  stages: Record<string, unknown>;
  eventLog: Array<{ type: string; timestamp: number }>;
  isLoading: boolean;
  currentStage: string | null;
}
