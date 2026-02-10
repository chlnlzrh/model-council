/**
 * Tests for the Chain mode:
 * - countWords
 * - getMandateDetails
 * - isValidMandate
 * - buildDraftPrompt
 * - buildImprovePrompt
 * - DEFAULT_CHAIN_STEPS / DEFAULT_CHAIN_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  countWords,
  getMandateDetails,
  isValidMandate,
  buildDraftPrompt,
  buildImprovePrompt,
  DEFAULT_CHAIN_STEPS,
  DEFAULT_CHAIN_CONFIG,
} from "@/lib/council/modes/chain";

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe("countWords", () => {
  it("counts words in a simple sentence", () => {
    expect(countWords("Hello world")).toBe(2);
  });

  it("handles multiple spaces", () => {
    expect(countWords("Hello   world   test")).toBe(3);
  });

  it("handles tabs and newlines", () => {
    expect(countWords("Hello\tworld\nthis\nis\ta\ntest")).toBe(6);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(countWords("   \t\n  ")).toBe(0);
  });

  it("handles leading and trailing whitespace", () => {
    expect(countWords("  Hello world  ")).toBe(2);
  });

  it("counts words in markdown content", () => {
    const md = `# Heading

This is a paragraph with **bold** and *italic* text.

- Item one
- Item two`;
    // Splits on whitespace: #, Heading, This, is, a, paragraph, with, **bold**, and, *italic*, text., -, Item, one, -, Item, two = 17
    expect(countWords(md)).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// getMandateDetails
// ---------------------------------------------------------------------------

describe("getMandateDetails", () => {
  it("returns correct details for 'draft'", () => {
    const mandate = getMandateDetails("draft");
    expect(mandate.key).toBe("draft");
    expect(mandate.display).toBe("Draft");
    expect(mandate.details).toContain("Comprehensive first pass");
  });

  it("returns correct details for 'structure_depth'", () => {
    const mandate = getMandateDetails("structure_depth");
    expect(mandate.display).toBe("Structure & Depth");
    expect(mandate.details).toContain("logical flow");
  });

  it("returns correct details for 'accuracy_completeness'", () => {
    const mandate = getMandateDetails("accuracy_completeness");
    expect(mandate.display).toBe("Accuracy & Completeness");
    expect(mandate.details).toContain("factual claims");
  });

  it("returns correct details for 'polish_format'", () => {
    const mandate = getMandateDetails("polish_format");
    expect(mandate.display).toBe("Polish & Format");
    expect(mandate.details).toContain("readability");
  });

  it("returns correct details for 'security_review'", () => {
    const mandate = getMandateDetails("security_review");
    expect(mandate.display).toBe("Security Review");
    expect(mandate.details).toContain("security vulnerabilities");
  });

  it("returns correct details for 'cost_analysis'", () => {
    const mandate = getMandateDetails("cost_analysis");
    expect(mandate.display).toBe("Cost Analysis");
    expect(mandate.details).toContain("cost estimates");
  });

  it("returns correct details for 'accessibility'", () => {
    const mandate = getMandateDetails("accessibility");
    expect(mandate.display).toBe("Accessibility");
    expect(mandate.details).toContain("WCAG");
  });

  it("returns correct details for 'performance'", () => {
    const mandate = getMandateDetails("performance");
    expect(mandate.display).toBe("Performance");
    expect(mandate.details).toContain("benchmarks");
  });

  it("handles custom mandate with provided text", () => {
    const mandate = getMandateDetails("custom", "Add real-world examples");
    expect(mandate.key).toBe("custom");
    expect(mandate.display).toBe("Custom");
    expect(mandate.details).toBe("Add real-world examples");
  });

  it("handles custom mandate without provided text", () => {
    const mandate = getMandateDetails("custom");
    expect(mandate.key).toBe("custom");
    expect(mandate.details).toContain("custom improvements");
  });

  it("handles unknown mandate key gracefully", () => {
    const mandate = getMandateDetails("unknown_mandate");
    expect(mandate.key).toBe("unknown_mandate");
    expect(mandate.display).toBe("unknown_mandate");
    expect(mandate.details).toContain("unknown_mandate");
  });
});

// ---------------------------------------------------------------------------
// isValidMandate
// ---------------------------------------------------------------------------

describe("isValidMandate", () => {
  it("returns true for all library mandates", () => {
    const validKeys = [
      "draft", "structure_depth", "accuracy_completeness",
      "polish_format", "security_review", "cost_analysis",
      "accessibility", "performance",
    ];
    for (const key of validKeys) {
      expect(isValidMandate(key)).toBe(true);
    }
  });

  it("returns true for 'custom'", () => {
    expect(isValidMandate("custom")).toBe(true);
  });

  it("returns false for unknown keys", () => {
    expect(isValidMandate("unknown")).toBe(false);
    expect(isValidMandate("")).toBe(false);
    expect(isValidMandate("Draft")).toBe(false); // case sensitive
  });
});

// ---------------------------------------------------------------------------
// buildDraftPrompt
// ---------------------------------------------------------------------------

describe("buildDraftPrompt", () => {
  it("includes the user query", () => {
    const prompt = buildDraftPrompt("Explain microservices architecture");
    expect(prompt).toContain("Explain microservices architecture");
  });

  it("mentions sequential quality chain", () => {
    const prompt = buildDraftPrompt("Test");
    expect(prompt).toContain("sequential quality chain");
  });

  it("instructs to prioritize completeness", () => {
    const prompt = buildDraftPrompt("Test");
    expect(prompt).toContain("completeness");
    expect(prompt).toContain("coverage");
  });

  it("instructs not to add AI disclaimers", () => {
    const prompt = buildDraftPrompt("Test");
    expect(prompt).toContain("Do not add disclaimers");
  });
});

// ---------------------------------------------------------------------------
// buildImprovePrompt
// ---------------------------------------------------------------------------

describe("buildImprovePrompt", () => {
  const mandate = getMandateDetails("structure_depth");

  it("includes the user query", () => {
    const prompt = buildImprovePrompt(
      "Design a REST API", "Previous content here", 2, 4, mandate
    );
    expect(prompt).toContain("Design a REST API");
  });

  it("includes the previous output", () => {
    const prompt = buildImprovePrompt(
      "Q", "This is the previous draft content.", 2, 4, mandate
    );
    expect(prompt).toContain("This is the previous draft content.");
  });

  it("includes step number and total", () => {
    const prompt = buildImprovePrompt("Q", "Prev", 3, 5, mandate);
    expect(prompt).toContain("step 3 of 5");
  });

  it("includes the mandate display name", () => {
    const prompt = buildImprovePrompt("Q", "Prev", 2, 4, mandate);
    expect(prompt).toContain("Structure & Depth");
  });

  it("includes the mandate details", () => {
    const prompt = buildImprovePrompt("Q", "Prev", 2, 4, mandate);
    expect(prompt).toContain("logical flow");
  });

  it("includes rules about building on previous version", () => {
    const prompt = buildImprovePrompt("Q", "Prev", 2, 4, mandate);
    expect(prompt).toContain("Build on the previous version");
    expect(prompt).toContain("Do NOT start from scratch");
    expect(prompt).toContain("Preserve what is already good");
  });

  it("includes skipped step note when provided", () => {
    const prompt = buildImprovePrompt(
      "Q", "Prev", 3, 4, mandate,
      [{ step: 2, mandate: "Accuracy & Completeness" }]
    );
    expect(prompt).toContain("Step 2 (Accuracy & Completeness) was skipped");
    expect(prompt).toContain("processing error");
  });

  it("handles multiple skipped steps", () => {
    const prompt = buildImprovePrompt(
      "Q", "Prev", 4, 5, mandate,
      [
        { step: 2, mandate: "Accuracy & Completeness" },
        { step: 3, mandate: "Polish & Format" },
      ]
    );
    expect(prompt).toContain("Step 2 (Accuracy & Completeness)");
    expect(prompt).toContain("Step 3 (Polish & Format)");
    expect(prompt).toContain("those mandates");
  });

  it("does not include skipped note when no steps skipped", () => {
    const prompt = buildImprovePrompt("Q", "Prev", 2, 4, mandate);
    expect(prompt).not.toContain("skipped");
    expect(prompt).not.toContain("processing error");
  });

  it("references previous step number correctly", () => {
    const prompt = buildImprovePrompt("Q", "Prev", 3, 4, mandate);
    expect(prompt).toContain("from step 2");
  });

  it("works with custom mandate", () => {
    const custom = getMandateDetails("custom", "Add code examples in Python");
    const prompt = buildImprovePrompt("Q", "Prev", 2, 3, custom);
    expect(prompt).toContain("Custom");
    expect(prompt).toContain("Add code examples in Python");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CHAIN_STEPS / DEFAULT_CHAIN_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_CHAIN_STEPS", () => {
  it("has 4 steps by default", () => {
    expect(DEFAULT_CHAIN_STEPS).toHaveLength(4);
  });

  it("first step is a draft mandate", () => {
    expect(DEFAULT_CHAIN_STEPS[0].mandate).toBe("draft");
  });

  it("all steps have a model", () => {
    for (const step of DEFAULT_CHAIN_STEPS) {
      expect(step.model.length).toBeGreaterThan(0);
    }
  });

  it("all steps have a valid mandate", () => {
    for (const step of DEFAULT_CHAIN_STEPS) {
      expect(isValidMandate(step.mandate)).toBe(true);
    }
  });

  it("has diverse mandates across steps", () => {
    const mandates = DEFAULT_CHAIN_STEPS.map((s) => s.mandate);
    const unique = new Set(mandates);
    expect(unique.size).toBe(4); // all different
  });
});

describe("DEFAULT_CHAIN_CONFIG", () => {
  it("has the default steps", () => {
    expect(DEFAULT_CHAIN_CONFIG.steps).toBe(DEFAULT_CHAIN_STEPS);
  });

  it("has a timeout", () => {
    expect(DEFAULT_CHAIN_CONFIG.timeoutMs).toBeGreaterThan(0);
  });
});
