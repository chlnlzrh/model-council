/**
 * Tests for the shared multi-mode infrastructure:
 * - Mode registry
 * - Type validation
 * - Mode config validation
 */

import { describe, it, expect } from "vitest";
import {
  MODE_REGISTRY,
  getModeDefinition,
  isValidMode,
  getModesByFamily,
  getModeIds,
  validateModelCount,
} from "@/lib/council/modes";
import {
  DELIBERATION_MODES,
  type DeliberationMode,
  type ModeFamily,
} from "@/lib/council/types";

// ---------------------------------------------------------------------------
// Mode Registry
// ---------------------------------------------------------------------------

describe("MODE_REGISTRY", () => {
  it("has exactly 15 modes", () => {
    expect(Object.keys(MODE_REGISTRY)).toHaveLength(15);
  });

  it("has an entry for every mode in DELIBERATION_MODES", () => {
    for (const mode of DELIBERATION_MODES) {
      expect(MODE_REGISTRY[mode]).toBeDefined();
      expect(MODE_REGISTRY[mode].id).toBe(mode);
    }
  });

  it("every mode has required fields", () => {
    for (const def of Object.values(MODE_REGISTRY)) {
      expect(def.id).toBeTruthy();
      expect(def.name).toBeTruthy();
      expect(def.family).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.minModels).toBeGreaterThanOrEqual(2);
      expect(def.maxModels).toBeGreaterThanOrEqual(def.minModels);
      expect(typeof def.requiresSpecialRole).toBe("boolean");
      expect(typeof def.supportsMultiTurn).toBe("boolean");
      expect(def.estimatedDurationMs).toBeGreaterThan(0);
    }
  });

  it("council mode matches expected values", () => {
    const council = MODE_REGISTRY.council;
    expect(council.name).toBe("Council");
    expect(council.family).toBe("evaluation");
    expect(council.minModels).toBe(3);
    expect(council.requiresSpecialRole).toBe(true);
    expect(council.supportsMultiTurn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getModeDefinition
// ---------------------------------------------------------------------------

describe("getModeDefinition", () => {
  it("returns definition for valid modes", () => {
    const def = getModeDefinition("vote");
    expect(def).not.toBeNull();
    expect(def!.id).toBe("vote");
    expect(def!.name).toBe("Vote");
  });

  it("returns null for invalid modes", () => {
    expect(getModeDefinition("invalid")).toBeNull();
    expect(getModeDefinition("")).toBeNull();
    expect(getModeDefinition("COUNCIL")).toBeNull(); // case sensitive
  });
});

// ---------------------------------------------------------------------------
// isValidMode
// ---------------------------------------------------------------------------

describe("isValidMode", () => {
  it("returns true for all 15 valid modes", () => {
    const validModes: string[] = [
      "council", "vote", "jury", "debate", "delphi",
      "red_team", "chain", "specialist_panel", "blueprint",
      "peer_review", "tournament", "confidence_weighted",
      "decompose", "brainstorm", "fact_check",
    ];
    for (const mode of validModes) {
      expect(isValidMode(mode)).toBe(true);
    }
  });

  it("returns false for invalid strings", () => {
    expect(isValidMode("invalid")).toBe(false);
    expect(isValidMode("")).toBe(false);
    expect(isValidMode("Council")).toBe(false);
    expect(isValidMode("red-team")).toBe(false); // dash vs underscore
  });
});

// ---------------------------------------------------------------------------
// getModesByFamily
// ---------------------------------------------------------------------------

describe("getModesByFamily", () => {
  it("returns evaluation family modes", () => {
    const modes = getModesByFamily("evaluation");
    const ids = modes.map((m) => m.id);
    expect(ids).toContain("council");
    expect(ids).toContain("vote");
    expect(ids).toContain("jury");
    expect(ids).toContain("debate");
    expect(ids).toContain("delphi");
    expect(modes).toHaveLength(5);
  });

  it("returns adversarial family modes", () => {
    const modes = getModesByFamily("adversarial");
    expect(modes).toHaveLength(1);
    expect(modes[0].id).toBe("red_team");
  });

  it("returns sequential family modes", () => {
    const modes = getModesByFamily("sequential");
    expect(modes).toHaveLength(1);
    expect(modes[0].id).toBe("chain");
  });

  it("returns role_based family modes", () => {
    const modes = getModesByFamily("role_based");
    const ids = modes.map((m) => m.id);
    expect(ids).toContain("specialist_panel");
    expect(ids).toContain("blueprint");
    expect(ids).toContain("peer_review");
    expect(modes).toHaveLength(3);
  });

  it("returns algorithmic family modes", () => {
    const modes = getModesByFamily("algorithmic");
    const ids = modes.map((m) => m.id);
    expect(ids).toContain("tournament");
    expect(ids).toContain("confidence_weighted");
    expect(ids).toContain("decompose");
    expect(modes).toHaveLength(3);
  });

  it("returns creative family modes", () => {
    const modes = getModesByFamily("creative");
    expect(modes).toHaveLength(1);
    expect(modes[0].id).toBe("brainstorm");
  });

  it("returns verification family modes", () => {
    const modes = getModesByFamily("verification");
    expect(modes).toHaveLength(1);
    expect(modes[0].id).toBe("fact_check");
  });

  it("returns empty array for unknown family", () => {
    expect(getModesByFamily("unknown" as ModeFamily)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getModeIds
// ---------------------------------------------------------------------------

describe("getModeIds", () => {
  it("returns all 15 mode IDs", () => {
    const ids = getModeIds();
    expect(ids).toHaveLength(15);
    expect(ids).toContain("council");
    expect(ids).toContain("fact_check");
  });

  it("returns a non-empty tuple (first element guaranteed)", () => {
    const ids = getModeIds();
    expect(ids[0]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// validateModelCount
// ---------------------------------------------------------------------------

describe("validateModelCount", () => {
  it("accepts valid model counts", () => {
    expect(validateModelCount("council", 3).valid).toBe(true);
    expect(validateModelCount("council", 5).valid).toBe(true);
    expect(validateModelCount("council", 7).valid).toBe(true);
    expect(validateModelCount("chain", 2).valid).toBe(true);
    expect(validateModelCount("chain", 6).valid).toBe(true);
  });

  it("rejects too few models", () => {
    const result = validateModelCount("council", 2);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at least 3");
  });

  it("rejects too many models", () => {
    const result = validateModelCount("council", 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("at most 7");
  });

  it("validates edge cases for each mode", () => {
    // Red team: min 2, max 3
    expect(validateModelCount("red_team", 1).valid).toBe(false);
    expect(validateModelCount("red_team", 2).valid).toBe(true);
    expect(validateModelCount("red_team", 3).valid).toBe(true);
    expect(validateModelCount("red_team", 4).valid).toBe(false);

    // Tournament: min 5, max 9
    expect(validateModelCount("tournament", 4).valid).toBe(false);
    expect(validateModelCount("tournament", 5).valid).toBe(true);
    expect(validateModelCount("tournament", 9).valid).toBe(true);
    expect(validateModelCount("tournament", 10).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DELIBERATION_MODES array
// ---------------------------------------------------------------------------

describe("DELIBERATION_MODES", () => {
  it("has 15 entries", () => {
    expect(DELIBERATION_MODES).toHaveLength(15);
  });

  it("matches MODE_REGISTRY keys", () => {
    const registryKeys = Object.keys(MODE_REGISTRY).sort();
    const modesArray = [...DELIBERATION_MODES].sort();
    expect(modesArray).toEqual(registryKeys);
  });

  it("is a readonly array", () => {
    // TypeScript enforces this at compile time; runtime check that it's an array
    expect(Array.isArray(DELIBERATION_MODES)).toBe(true);
  });
});
