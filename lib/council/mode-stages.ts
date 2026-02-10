/**
 * Mode stage metadata — maps each DeliberationMode to its stage progression.
 *
 * Used by ChatInput for dynamic stage labels and progress display,
 * and by mode panels to understand expected event sequences.
 */

import type { DeliberationMode } from "./types";

interface StageInfo {
  event: string;
  label: string;
}

const MODE_STAGES: Record<DeliberationMode, StageInfo[]> = {
  council: [
    { event: "stage1_start", label: "Collecting responses" },
    { event: "stage2_start", label: "Ranking responses" },
    { event: "stage3_start", label: "Synthesizing" },
  ],
  vote: [
    { event: "stage1_start", label: "Collecting responses" },
    { event: "vote_start", label: "Collecting votes" },
    { event: "winner_start", label: "Announcing winner" },
  ],
  debate: [
    { event: "round1_start", label: "Initial answers" },
    { event: "revision_start", label: "Revising answers" },
    { event: "vote_start", label: "Voting on answers" },
  ],
  jury: [
    { event: "present_start", label: "Presenting content" },
    { event: "deliberation_start", label: "Jurors deliberating" },
    { event: "verdict_start", label: "Delivering verdict" },
  ],
  specialist_panel: [
    { event: "specialist_start", label: "Specialists analyzing" },
    { event: "cross_review_start", label: "Cross-reviewing" },
    { event: "synthesis_start", label: "Synthesizing reports" },
  ],
  peer_review: [
    { event: "review_start", label: "Reviewing" },
    { event: "all_reviews_start", label: "Compiling reviews" },
    { event: "consolidation_start", label: "Consolidating feedback" },
  ],
  delphi: [
    { event: "classify_start", label: "Classifying question" },
    { event: "round_start", label: "Collecting estimates" },
    { event: "synthesis_start", label: "Synthesizing consensus" },
  ],
  red_team: [
    { event: "generate_start", label: "Generating content" },
    { event: "attack_start", label: "Red team attacking" },
    { event: "defend_start", label: "Defending content" },
    { event: "synthesize_start", label: "Hardening output" },
  ],
  chain: [
    { event: "chain_start", label: "Starting pipeline" },
    { event: "chain_step_start", label: "Processing step" },
  ],
  decompose: [
    { event: "plan_start", label: "Planning sub-tasks" },
    { event: "task_start", label: "Solving sub-tasks" },
    { event: "assembly_start", label: "Assembling answer" },
  ],
  tournament: [
    { event: "tournament_start", label: "Setting up bracket" },
    { event: "round_start", label: "Running matches" },
    { event: "final_start", label: "Championship match" },
  ],
  brainstorm: [
    { event: "ideation_start", label: "Generating ideas" },
    { event: "clustering_start", label: "Clustering ideas" },
    { event: "scoring_start", label: "Scoring & refining" },
  ],
  fact_check: [
    { event: "extract_start", label: "Extracting claims" },
    { event: "verify_start", label: "Verifying claims" },
    { event: "report_start", label: "Writing report" },
  ],
  confidence_weighted: [
    { event: "answer_start", label: "Collecting answers" },
    { event: "all_answers_start", label: "Weighting by confidence" },
    { event: "synthesis_start", label: "Synthesizing" },
  ],
  blueprint: [
    { event: "outline_start", label: "Creating outline" },
    { event: "author_start", label: "Writing sections" },
    { event: "assembly_start", label: "Assembling document" },
  ],
};

/**
 * Get a human-readable stage label for the current SSE event type.
 * Falls back to a generic label if the event isn't in the map.
 */
export function getModeStageLabel(
  mode: DeliberationMode,
  currentStage: string | null
): string {
  if (!currentStage) return "Processing";
  const stages = MODE_STAGES[mode];
  const match = stages.find((s) => s.event === currentStage);
  return match?.label ?? "Processing";
}

/**
 * Get the total number of expected stages for a mode.
 */
export function getModeStageTotalCount(mode: DeliberationMode): number {
  return MODE_STAGES[mode].length;
}

/**
 * Get the 1-based index of the current stage within the mode's progression.
 * Returns 0 if not found.
 */
export function getModeStageIndex(
  mode: DeliberationMode,
  currentStage: string | null
): number {
  if (!currentStage) return 0;
  const stages = MODE_STAGES[mode];
  const idx = stages.findIndex((s) => s.event === currentStage);
  return idx >= 0 ? idx + 1 : 0;
}

/**
 * Get all stage definitions for a mode.
 */
export function getModeStages(mode: DeliberationMode): StageInfo[] {
  return MODE_STAGES[mode];
}
