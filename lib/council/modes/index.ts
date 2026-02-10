/**
 * Mode Registry — metadata and dispatcher for all 15 deliberation modes.
 *
 * Each mode has a ModeDefinition with constraints, and a handler function
 * that receives a ReadableStreamDefaultController + request data and
 * runs the mode-specific pipeline.
 */

import type { ModeDefinition, DeliberationMode, ModeFamily } from "../types";

// ---------------------------------------------------------------------------
// Mode Registry
// ---------------------------------------------------------------------------

export const MODE_REGISTRY: Record<DeliberationMode, ModeDefinition> = {
  council: {
    id: "council",
    name: "Council",
    family: "evaluation",
    description:
      "Models answer, rank each other anonymously, then a chairman synthesizes.",
    minModels: 3,
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: true,
    estimatedDurationMs: 120_000,
  },
  vote: {
    id: "vote",
    name: "Vote",
    family: "evaluation",
    description:
      "Models answer, vote for the best, tiebreaker by chairman.",
    minModels: 3,
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: true,
    estimatedDurationMs: 90_000,
  },
  jury: {
    id: "jury",
    name: "Jury",
    family: "evaluation",
    description:
      "Models evaluate an existing answer on 5 dimensions, foreman delivers verdict.",
    minModels: 4,
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 90_000,
  },
  debate: {
    id: "debate",
    name: "Debate",
    family: "evaluation",
    description:
      "Models answer, see others' responses, revise, then vote on revised answers.",
    minModels: 3,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  delphi: {
    id: "delphi",
    name: "Delphi",
    family: "evaluation",
    description:
      "Iterative anonymous rounds with statistical feedback until convergence.",
    minModels: 4,
    maxModels: 8,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 300_000,
  },
  red_team: {
    id: "red_team",
    name: "Red Team",
    family: "adversarial",
    description: "Adversarial loop: generate, attack, defend, judge.",
    minModels: 2,
    maxModels: 3,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  chain: {
    id: "chain",
    name: "Chain",
    family: "sequential",
    description: "Sequential improvement: draft, improve, refine, polish.",
    minModels: 2,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 240_000,
  },
  specialist_panel: {
    id: "specialist_panel",
    name: "Specialist Panel",
    family: "role_based",
    description:
      "Role-assigned expert analysis, cross-review, and synthesis.",
    minModels: 3,
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 150_000,
  },
  blueprint: {
    id: "blueprint",
    name: "Blueprint",
    family: "role_based",
    description:
      "Outline, parallel section expansion, and assembly into a unified document.",
    minModels: 2,
    maxModels: 8,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 300_000,
  },
  peer_review: {
    id: "peer_review",
    name: "Peer Review",
    family: "role_based",
    description:
      "Independent reviews with scoring rubric, consolidated into a unified report.",
    minModels: 3,
    maxModels: 7,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 150_000,
  },
  tournament: {
    id: "tournament",
    name: "Tournament",
    family: "algorithmic",
    description:
      "Bracket-style elimination: pairwise judging until a winner emerges.",
    minModels: 5,
    maxModels: 9,
    requiresSpecialRole: true,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  confidence_weighted: {
    id: "confidence_weighted",
    name: "Confidence-Weighted",
    family: "algorithmic",
    description:
      "Models answer with self-assessed confidence, weighted synthesis.",
    minModels: 2,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: true,
    estimatedDurationMs: 90_000,
  },
  decompose: {
    id: "decompose",
    name: "Decompose",
    family: "algorithmic",
    description:
      "Planner breaks question into sub-tasks, models solve parts, assembler reunifies.",
    minModels: 2,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  brainstorm: {
    id: "brainstorm",
    name: "Brainstorm",
    family: "creative",
    description:
      "Generate ideas freely, cluster, score, refine top cluster.",
    minModels: 3,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
  fact_check: {
    id: "fact_check",
    name: "Fact-Check",
    family: "verification",
    description:
      "Generate content, extract claims, independently verify, produce evidence report.",
    minModels: 3,
    maxModels: 6,
    requiresSpecialRole: false,
    supportsMultiTurn: false,
    estimatedDurationMs: 180_000,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get mode definition or null if invalid. */
export function getModeDefinition(
  mode: string
): ModeDefinition | null {
  return MODE_REGISTRY[mode as DeliberationMode] ?? null;
}

/** Check if a mode string is a valid DeliberationMode. */
export function isValidMode(mode: string): mode is DeliberationMode {
  return mode in MODE_REGISTRY;
}

/** Get all modes in a given family. */
export function getModesByFamily(family: ModeFamily): ModeDefinition[] {
  return Object.values(MODE_REGISTRY).filter((m) => m.family === family);
}

/** Get all mode IDs as an array (for Zod enum validation). */
export function getModeIds(): [DeliberationMode, ...DeliberationMode[]] {
  const ids = Object.keys(MODE_REGISTRY) as DeliberationMode[];
  return ids as [DeliberationMode, ...DeliberationMode[]];
}

/** Validate model count against mode constraints. */
export function validateModelCount(
  mode: DeliberationMode,
  modelCount: number
): { valid: boolean; error?: string } {
  const def = MODE_REGISTRY[mode];
  if (modelCount < def.minModels) {
    return {
      valid: false,
      error: `${def.name} requires at least ${def.minModels} models, got ${modelCount}.`,
    };
  }
  if (modelCount > def.maxModels) {
    return {
      valid: false,
      error: `${def.name} allows at most ${def.maxModels} models, got ${modelCount}.`,
    };
  }
  return { valid: true };
}
