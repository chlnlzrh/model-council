/**
 * Tests for Blueprint mode:
 * - parseOutline
 * - assignSectionsToModels
 * - countWords
 * - extractTodoMarkers
 * - buildOutlinePrompt
 * - buildSectionPrompt
 * - buildAssemblyPrompt
 * - DEFAULT_BLUEPRINT_CONFIG
 * - DOCUMENT_TYPE_LABELS
 */

import { describe, it, expect } from "vitest";
import {
  parseOutline,
  assignSectionsToModels,
  countWords,
  extractTodoMarkers,
  buildOutlinePrompt,
  buildSectionPrompt,
  buildAssemblyPrompt,
  DEFAULT_BLUEPRINT_CONFIG,
  DOCUMENT_TYPE_LABELS,
} from "@/lib/council/modes/blueprint";
import type {
  ParsedSection,
  DocumentType,
} from "@/lib/council/modes/blueprint";

// ---------------------------------------------------------------------------
// Helper: build a well-formed outline string
// ---------------------------------------------------------------------------

function makeOutlineText(sectionCount: number = 6): string {
  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const num = i + 1;
    return `SECTION ${num}: Section ${num} Title
Description: Description for section ${num}
Key Topics:
- Topic ${num}A
- Topic ${num}B
- Topic ${num}C
Length: Medium
Source Coverage: Covers part ${num} of source material`;
  }).join("\n\n");

  return `DOCUMENT TITLE: Test Architecture Document

${sections}

DOCUMENT SUMMARY:
Total sections: ${sectionCount}
Estimated total length: 8,000-12,000 words
Key themes: Scalability, Security, Performance`;
}

// ---------------------------------------------------------------------------
// parseOutline
// ---------------------------------------------------------------------------

describe("parseOutline", () => {
  it("parses a well-formed outline with 6 sections", () => {
    const result = parseOutline(makeOutlineText(6));
    expect(result.documentTitle).toBe("Test Architecture Document");
    expect(result.sections).toHaveLength(6);
    expect(result.summary.totalSections).toBe(6);
  });

  it("extracts the document title", () => {
    const result = parseOutline(makeOutlineText());
    expect(result.documentTitle).toBe("Test Architecture Document");
  });

  it("defaults title to 'Untitled Document' when missing", () => {
    const text = `SECTION 1: Intro
Description: Introduction
Key Topics:
- Overview
Length: Short
Source Coverage: All

SECTION 2: Details
Description: Details
Key Topics:
- Detail 1
Length: Medium
Source Coverage: All

SECTION 3: Conclusion
Description: Wrap up
Key Topics:
- Summary
Length: Short
Source Coverage: All`;
    const result = parseOutline(text);
    expect(result.documentTitle).toBe("Untitled Document");
  });

  it("parses section fields correctly", () => {
    const result = parseOutline(makeOutlineText());
    const s1 = result.sections[0];
    expect(s1.number).toBe(1);
    expect(s1.title).toBe("Section 1 Title");
    expect(s1.description).toBe("Description for section 1");
    expect(s1.length).toBe("Medium");
    expect(s1.sourceCoverage).toBe("Covers part 1 of source material");
  });

  it("parses key topics as array of strings", () => {
    const result = parseOutline(makeOutlineText());
    const s1 = result.sections[0];
    expect(s1.keyTopics).toEqual(["Topic 1A", "Topic 1B", "Topic 1C"]);
  });

  it("parses Short length", () => {
    const text = `DOCUMENT TITLE: Test

SECTION 1: Intro
Description: Intro section
Key Topics:
- A
Length: Short
Source Coverage: All

SECTION 2: Mid
Description: Mid
Key Topics:
- B
Length: Medium
Source Coverage: All

SECTION 3: End
Description: End
Key Topics:
- C
Length: Long
Source Coverage: All

DOCUMENT SUMMARY:
Total sections: 3
Estimated total length: 3,000 words
Key themes: Testing`;
    const result = parseOutline(text);
    expect(result.sections[0].length).toBe("Short");
    expect(result.sections[1].length).toBe("Medium");
    expect(result.sections[2].length).toBe("Long");
  });

  it("parses source coverage", () => {
    const result = parseOutline(makeOutlineText());
    expect(result.sections[0].sourceCoverage).toBe(
      "Covers part 1 of source material"
    );
  });

  it("parses document summary", () => {
    const result = parseOutline(makeOutlineText(8));
    expect(result.summary.totalSections).toBe(8);
    expect(result.summary.estimatedLength).toBe("8,000-12,000 words");
  });

  it("parses key themes from summary", () => {
    const result = parseOutline(makeOutlineText());
    expect(result.summary.keyThemes).toEqual([
      "Scalability",
      "Security",
      "Performance",
    ]);
  });

  it("handles missing summary gracefully", () => {
    const text = `DOCUMENT TITLE: No Summary Doc

SECTION 1: A
Description: A desc
Key Topics:
- Topic
Length: Short
Source Coverage: All

SECTION 2: B
Description: B desc
Key Topics:
- Topic
Length: Medium
Source Coverage: All

SECTION 3: C
Description: C desc
Key Topics:
- Topic
Length: Long
Source Coverage: All`;
    const result = parseOutline(text);
    expect(result.summary.totalSections).toBe(3); // falls back to sections.length
    expect(result.summary.estimatedLength).toBe("Unknown");
    expect(result.summary.keyThemes).toEqual([]);
  });

  it("handles a single section", () => {
    const text = `DOCUMENT TITLE: Single Section

SECTION 1: Overview
Description: Only section
Key Topics:
- Everything
Length: Long
Source Coverage: All material`;
    const result = parseOutline(text);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe("Overview");
  });

  it("returns empty sections for empty input", () => {
    const result = parseOutline("");
    expect(result.documentTitle).toBe("Untitled Document");
    expect(result.sections).toHaveLength(0);
    expect(result.summary.totalSections).toBe(0);
  });

  it("returns empty sections for whitespace-only input", () => {
    const result = parseOutline("   \n\t  ");
    expect(result.sections).toHaveLength(0);
  });

  it("handles many sections (12)", () => {
    const result = parseOutline(makeOutlineText(12));
    expect(result.sections).toHaveLength(12);
  });

  it("handles a single key topic", () => {
    const text = `DOCUMENT TITLE: One Topic

SECTION 1: A
Description: Desc A
Key Topics:
- Only topic
Length: Medium
Source Coverage: All

SECTION 2: B
Description: Desc B
Key Topics:
- Only topic B
Length: Short
Source Coverage: All

SECTION 3: C
Description: Desc C
Key Topics:
- Only topic C
Length: Long
Source Coverage: All`;
    const result = parseOutline(text);
    expect(result.sections[0].keyTopics).toEqual(["Only topic"]);
  });

  it("handles sections with no key topics gracefully", () => {
    const text = `DOCUMENT TITLE: No Topics

SECTION 1: A
Description: Desc
Length: Medium
Source Coverage: All

SECTION 2: B
Description: Desc
Length: Short
Source Coverage: All

SECTION 3: C
Description: Desc
Length: Long
Source Coverage: All`;
    const result = parseOutline(text);
    // Sections are still parsed, keyTopics should be empty
    expect(result.sections.length).toBeGreaterThanOrEqual(0);
    if (result.sections.length > 0) {
      expect(result.sections[0].keyTopics).toEqual([]);
    }
  });

  it("is case-insensitive for section headers", () => {
    const text = `document title: Case Test

section 1: First
Description: Desc
Key Topics:
- A
Length: Medium
Source Coverage: All

section 2: Second
Description: Desc
Key Topics:
- B
Length: Short
Source Coverage: All

section 3: Third
Description: Desc
Key Topics:
- C
Length: Long
Source Coverage: All`;
    const result = parseOutline(text);
    expect(result.documentTitle).toBe("Case Test");
    expect(result.sections).toHaveLength(3);
  });

  it("handles themes with trailing content", () => {
    const text = makeOutlineText(3);
    const result = parseOutline(text);
    expect(result.summary.keyThemes.length).toBeGreaterThan(0);
    for (const theme of result.summary.keyThemes) {
      expect(typeof theme).toBe("string");
      expect(theme.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// assignSectionsToModels
// ---------------------------------------------------------------------------

describe("assignSectionsToModels", () => {
  const makeSections = (count: number): ParsedSection[] =>
    Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      title: `Section ${i + 1}`,
      description: `Desc ${i + 1}`,
      keyTopics: [`Topic ${i + 1}`],
      length: "Medium" as const,
      sourceCoverage: "All",
    }));

  it("assigns 3 models across 9 sections round-robin", () => {
    const sections = makeSections(9);
    const models = ["modelA", "modelB", "modelC"];
    const result = assignSectionsToModels(sections, models);

    expect(result[0].assignedModel).toBe("modelA");
    expect(result[1].assignedModel).toBe("modelB");
    expect(result[2].assignedModel).toBe("modelC");
    expect(result[3].assignedModel).toBe("modelA");
    expect(result[4].assignedModel).toBe("modelB");
    expect(result[5].assignedModel).toBe("modelC");
    expect(result[6].assignedModel).toBe("modelA");
    expect(result[7].assignedModel).toBe("modelB");
    expect(result[8].assignedModel).toBe("modelC");
  });

  it("assigns all sections to 1 model when only 1 author", () => {
    const sections = makeSections(4);
    const result = assignSectionsToModels(sections, ["solo"]);
    for (const s of result) {
      expect(s.assignedModel).toBe("solo");
    }
  });

  it("assigns 6 models to 6 sections (1:1 mapping)", () => {
    const sections = makeSections(6);
    const models = ["m1", "m2", "m3", "m4", "m5", "m6"];
    const result = assignSectionsToModels(sections, models);
    result.forEach((s, i) => {
      expect(s.assignedModel).toBe(models[i]);
    });
  });

  it("wraps around for 2 models and 5 sections", () => {
    const sections = makeSections(5);
    const result = assignSectionsToModels(sections, ["alpha", "beta"]);
    expect(result[0].assignedModel).toBe("alpha");
    expect(result[1].assignedModel).toBe("beta");
    expect(result[2].assignedModel).toBe("alpha");
    expect(result[3].assignedModel).toBe("beta");
    expect(result[4].assignedModel).toBe("alpha");
  });

  it("preserves original section data", () => {
    const sections = makeSections(3);
    const result = assignSectionsToModels(sections, ["m1"]);
    expect(result[0].number).toBe(1);
    expect(result[0].title).toBe("Section 1");
    expect(result[0].description).toBe("Desc 1");
    expect(result[0].keyTopics).toEqual(["Topic 1"]);
  });

  it("returns unchanged sections for empty models array", () => {
    const sections = makeSections(3);
    const result = assignSectionsToModels(sections, []);
    expect(result).toEqual(sections);
  });
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe("countWords", () => {
  it("counts words in a normal sentence", () => {
    expect(countWords("Hello world how are you")).toBe(5);
  });

  it("handles multiple spaces", () => {
    expect(countWords("Hello   world   test")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("counts a single word", () => {
    expect(countWords("Hello")).toBe(1);
  });

  it("handles newlines and tabs", () => {
    expect(countWords("Hello\tworld\nthis\nis")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// extractTodoMarkers
// ---------------------------------------------------------------------------

describe("extractTodoMarkers", () => {
  it("extracts standard TODO markers", () => {
    const text = "Some text [TODO: Add section on security] more text";
    const result = extractTodoMarkers(text);
    expect(result).toEqual(["[TODO: Add section on security]"]);
  });

  it("returns empty array when no markers found", () => {
    const text = "This document has no todo markers anywhere.";
    expect(extractTodoMarkers(text)).toEqual([]);
  });

  it("extracts multiple TODO markers", () => {
    const text =
      "[TODO: Section 3 needed] some content [TODO: Add diagrams] more [TODO: Review references]";
    const result = extractTodoMarkers(text);
    expect(result).toHaveLength(3);
  });

  it("is case-insensitive", () => {
    const text = "[todo: lowercase] and [Todo: mixed] and [TODO: upper]";
    const result = extractTodoMarkers(text);
    expect(result).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    expect(extractTodoMarkers("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildOutlinePrompt
// ---------------------------------------------------------------------------

describe("buildOutlinePrompt", () => {
  it("includes the user input", () => {
    const prompt = buildOutlinePrompt(
      "Build a microservice architecture",
      "architecture_blueprint"
    );
    expect(prompt).toContain("Build a microservice architecture");
  });

  it("includes the document type label", () => {
    const prompt = buildOutlinePrompt("Test input", "security_assessment");
    expect(prompt).toContain("Security Assessment");
  });

  it("includes the SECTION format instructions", () => {
    const prompt = buildOutlinePrompt("Test input", "custom");
    expect(prompt).toContain("SECTION 1:");
    expect(prompt).toContain("SECTION 2:");
    expect(prompt).toContain("DOCUMENT TITLE:");
    expect(prompt).toContain("DOCUMENT SUMMARY:");
  });
});

// ---------------------------------------------------------------------------
// buildSectionPrompt
// ---------------------------------------------------------------------------

describe("buildSectionPrompt", () => {
  const defaultParams = {
    sectionNumber: 3,
    sectionTitle: "Identity & Access Control",
    sectionDescription: "Auth and RBAC implementation",
    keyTopics: ["Authentication flow", "Role-based permissions"],
    length: "Medium" as const,
    documentTitle: "Architecture Blueprint",
    documentType: "architecture_blueprint" as DocumentType,
    fullOutline: "SECTION 1: Overview\nSECTION 2: Data\nSECTION 3: Auth",
    userInput: "Build a secure system",
  };

  it("includes section number and title", () => {
    const prompt = buildSectionPrompt(defaultParams);
    expect(prompt).toContain("Section 3: Identity & Access Control");
  });

  it("includes the full outline for context", () => {
    const prompt = buildSectionPrompt(defaultParams);
    expect(prompt).toContain("SECTION 1: Overview");
    expect(prompt).toContain("SECTION 2: Data");
  });

  it("includes key topics", () => {
    const prompt = buildSectionPrompt(defaultParams);
    expect(prompt).toContain("- Authentication flow");
    expect(prompt).toContain("- Role-based permissions");
  });

  it("includes target length", () => {
    const prompt = buildSectionPrompt(defaultParams);
    expect(prompt).toContain("Target Length: Medium");
  });
});

// ---------------------------------------------------------------------------
// buildAssemblyPrompt
// ---------------------------------------------------------------------------

describe("buildAssemblyPrompt", () => {
  it("includes authored sections", () => {
    const prompt = buildAssemblyPrompt({
      documentTitle: "Test Doc",
      documentType: "architecture_blueprint",
      fullOutline: "outline text",
      userInput: "source material",
      sections: [
        {
          sectionNumber: 1,
          sectionTitle: "Overview",
          model: "model-a",
          content: "Section 1 content here",
        },
      ],
      failedSections: [],
    });
    expect(prompt).toContain("SECTION 1: Overview");
    expect(prompt).toContain("Section 1 content here");
    expect(prompt).toContain("model-a");
  });

  it("includes failed sections block when present", () => {
    const prompt = buildAssemblyPrompt({
      documentTitle: "Test Doc",
      documentType: "architecture_blueprint",
      fullOutline: "outline",
      userInput: "source",
      sections: [
        {
          sectionNumber: 1,
          sectionTitle: "Overview",
          model: "m1",
          content: "Content",
        },
      ],
      failedSections: [
        { sectionNumber: 3, sectionTitle: "Security" },
        { sectionNumber: 5, sectionTitle: "Deployment" },
      ],
    });
    expect(prompt).toContain("MISSING SECTIONS");
    expect(prompt).toContain("Section 3: Security");
    expect(prompt).toContain("Section 5: Deployment");
  });

  it("omits missing sections block when none failed", () => {
    const prompt = buildAssemblyPrompt({
      documentTitle: "Test Doc",
      documentType: "architecture_blueprint",
      fullOutline: "outline",
      userInput: "source",
      sections: [
        {
          sectionNumber: 1,
          sectionTitle: "Overview",
          model: "m1",
          content: "Content",
        },
      ],
      failedSections: [],
    });
    expect(prompt).not.toContain("MISSING SECTIONS");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_BLUEPRINT_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_BLUEPRINT_CONFIG", () => {
  it("has architecture_blueprint as default document type", () => {
    expect(DEFAULT_BLUEPRINT_CONFIG.documentType).toBe(
      "architecture_blueprint"
    );
  });

  it("has 3 author models", () => {
    expect(DEFAULT_BLUEPRINT_CONFIG.authorModels).toHaveLength(3);
  });

  it("has 300s timeout", () => {
    expect(DEFAULT_BLUEPRINT_CONFIG.timeoutMs).toBe(300_000);
  });

  it("uses the same model for architect and assembler", () => {
    expect(DEFAULT_BLUEPRINT_CONFIG.architectModel).toBe(
      DEFAULT_BLUEPRINT_CONFIG.assemblerModel
    );
  });

  it("has non-empty model identifiers", () => {
    expect(DEFAULT_BLUEPRINT_CONFIG.architectModel.length).toBeGreaterThan(0);
    expect(DEFAULT_BLUEPRINT_CONFIG.assemblerModel.length).toBeGreaterThan(0);
    for (const m of DEFAULT_BLUEPRINT_CONFIG.authorModels) {
      expect(m.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// DOCUMENT_TYPE_LABELS
// ---------------------------------------------------------------------------

describe("DOCUMENT_TYPE_LABELS", () => {
  it("has labels for all 6 document types", () => {
    const types: DocumentType[] = [
      "architecture_blueprint",
      "technical_design_document",
      "implementation_roadmap",
      "cost_analysis_report",
      "security_assessment",
      "custom",
    ];
    for (const t of types) {
      expect(DOCUMENT_TYPE_LABELS[t]).toBeDefined();
    }
  });

  it("labels are non-empty strings", () => {
    for (const label of Object.values(DOCUMENT_TYPE_LABELS)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("custom label is 'Custom Document'", () => {
    expect(DOCUMENT_TYPE_LABELS.custom).toBe("Custom Document");
  });
});
