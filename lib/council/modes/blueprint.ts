/**
 * Blueprint Mode — Outline, parallel section expansion, and assembly.
 *
 * Three-phase pipeline for long-form document generation:
 *   Phase 1: Architect model creates a structured outline (6-12 sections)
 *   Phase 2: Author models expand sections in parallel (round-robin assignment)
 *   Phase 3: Assembler model integrates everything into a cohesive document
 *
 * See docs/modes/09-blueprint.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocumentType =
  | "architecture_blueprint"
  | "technical_design_document"
  | "implementation_roadmap"
  | "cost_analysis_report"
  | "security_assessment"
  | "custom";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  architecture_blueprint: "Architecture Blueprint",
  technical_design_document: "Technical Design Document",
  implementation_roadmap: "Implementation Roadmap",
  cost_analysis_report: "Cost Analysis Report",
  security_assessment: "Security Assessment",
  custom: "Custom Document",
};

export type SectionLength = "Short" | "Medium" | "Long";

export interface BlueprintConfig {
  documentType: DocumentType;
  architectModel: string;
  authorModels: string[];
  assemblerModel: string;
  timeoutMs: number;
}

export const DEFAULT_BLUEPRINT_CONFIG: BlueprintConfig = {
  documentType: "architecture_blueprint",
  architectModel: "anthropic/claude-opus-4-6",
  authorModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  assemblerModel: "anthropic/claude-opus-4-6",
  timeoutMs: 300_000,
};

export interface ParsedSection {
  number: number;
  title: string;
  description: string;
  keyTopics: string[];
  length: SectionLength;
  sourceCoverage: string;
  assignedModel?: string;
}

export interface ParsedOutline {
  documentTitle: string;
  sections: ParsedSection[];
  summary: {
    totalSections: number;
    estimatedLength: string;
    keyThemes: string[];
  };
}

export interface OutlineResult {
  model: string;
  documentTitle: string;
  documentType: DocumentType;
  rawOutline: string;
  parsedSections: ParsedSection[];
  totalSections: number;
  estimatedLength: string;
  keyThemes: string[];
  responseTimeMs: number;
}

export interface SectionResult {
  sectionNumber: number;
  sectionTitle: string;
  model: string;
  content: string;
  wordCount: number;
  keyTopicsCovered: string[];
  responseTimeMs: number;
}

export interface FailedSection {
  sectionNumber: number;
  sectionTitle: string;
  model: string;
  error: string;
}

export interface AssemblyResult {
  model: string;
  document: string;
  wordCount: number;
  hasTodoMarkers: boolean;
  todoMarkers: string[];
  responseTimeMs: number;
}

export interface BlueprintResult {
  outline: OutlineResult;
  sections: SectionResult[];
  failedSections: FailedSection[];
  assembly: AssemblyResult;
  title?: string;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse structured outline text into a ParsedOutline.
 *
 * Extracts DOCUMENT TITLE, SECTION blocks, and DOCUMENT SUMMARY.
 * Falls back to sensible defaults for missing/malformed fields.
 */
export function parseOutline(text: string): ParsedOutline {
  if (!text || !text.trim()) {
    return {
      documentTitle: "Untitled Document",
      sections: [],
      summary: {
        totalSections: 0,
        estimatedLength: "Unknown",
        keyThemes: [],
      },
    };
  }

  // Extract document title
  const titleMatch = text.match(/DOCUMENT TITLE:\s*(.+)/i);
  const documentTitle = titleMatch ? titleMatch[1].trim() : "Untitled Document";

  // Extract sections using boundary-based splitting
  const sections: ParsedSection[] = [];
  const sectionPattern = /SECTION\s+(\d+):\s*(.+)/gi;
  const sectionStarts: Array<{ index: number; num: number; title: string }> = [];
  let sMatch;

  while ((sMatch = sectionPattern.exec(text)) !== null) {
    sectionStarts.push({
      index: sMatch.index,
      num: parseInt(sMatch[1], 10),
      title: sMatch[2].trim(),
    });
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i];
    const end = i + 1 < sectionStarts.length
      ? sectionStarts[i + 1].index
      : text.length;
    const block = text.slice(start.index, end);

    // Parse fields from the block
    const descMatch = block.match(/Description:\s*(.+)/i);
    const description = descMatch ? descMatch[1].trim() : "";

    // Key Topics: multi-line dash items
    const keyTopics: string[] = [];
    const topicsHeader = block.match(/Key Topics:\s*\n/i);
    if (topicsHeader) {
      const afterTopics = block.slice(
        (topicsHeader.index ?? 0) + topicsHeader[0].length
      );
      const lines = afterTopics.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("-")) {
          keyTopics.push(trimmed.replace(/^-\s*/, "").trim());
        } else if (trimmed && !trimmed.startsWith("-")) {
          break; // End of topics list
        }
      }
    }

    // Length
    const lengthMatch = block.match(/Length:\s*(Short|Medium|Long)/i);
    const length: SectionLength = lengthMatch
      ? (lengthMatch[1].charAt(0).toUpperCase() + lengthMatch[1].slice(1).toLowerCase() as SectionLength)
      : "Medium";

    // Source Coverage
    const coverageMatch = block.match(/Source Coverage:\s*(.+)/i);
    const sourceCoverage = coverageMatch ? coverageMatch[1].trim() : "";

    sections.push({
      number: start.num,
      title: start.title,
      description,
      keyTopics,
      length,
      sourceCoverage,
    });
  }

  // Extract summary
  const totalMatch = text.match(/Total sections:\s*(\d+)/i);
  const lengthEstMatch = text.match(/Estimated total length:\s*(.+)/i);
  const themesMatch = text.match(/Key themes:\s*(.+)/i);

  const keyThemes = themesMatch
    ? themesMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    documentTitle,
    sections,
    summary: {
      totalSections: totalMatch ? parseInt(totalMatch[1], 10) : sections.length,
      estimatedLength: lengthEstMatch ? lengthEstMatch[1].trim() : "Unknown",
      keyThemes,
    },
  };
}

/**
 * Assign sections to author models using round-robin distribution.
 */
export function assignSectionsToModels(
  sections: ParsedSection[],
  authorModels: string[]
): ParsedSection[] {
  if (authorModels.length === 0) return sections;
  return sections.map((section, index) => ({
    ...section,
    assignedModel: authorModels[index % authorModels.length],
  }));
}

/**
 * Count words in a text string.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Extract [TODO: ...] markers from assembled document text.
 */
export function extractTodoMarkers(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\[TODO:\s*[^\]]+\]/gi);
  return matches ?? [];
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the outline prompt for the architect model.
 */
export function buildOutlinePrompt(
  userInput: string,
  documentType: DocumentType
): string {
  const typeLabel = DOCUMENT_TYPE_LABELS[documentType];

  return `You are a senior technical architect creating a document blueprint. Your task is to analyze the source material and produce a detailed, well-structured outline for a ${typeLabel}.

SOURCE MATERIAL:
${userInput}

Create a detailed outline with 6-12 sections. Each section must follow this exact format:

DOCUMENT TITLE: [descriptive title for the entire document]

SECTION 1: [section title]
Description: [what this section covers and its purpose]
Key Topics:
- [topic 1]
- [topic 2]
- [topic 3]
Length: [Short|Medium|Long]
Source Coverage: [which parts of the source material this section draws from]

SECTION 2: [section title]
Description: [what this section covers]
Key Topics:
- [topic 1]
- [topic 2]
Length: [Short|Medium|Long]
Source Coverage: [which parts of the source material]

... continue for all sections ...

DOCUMENT SUMMARY:
Total sections: [count]
Estimated total length: [e.g., "8,000-12,000 words"]
Key themes: [3-5 key themes across the document]

Rules:
1. Sections must flow logically — each builds on the previous.
2. No significant overlap between sections.
3. Every part of the source material must be covered by at least one section.
4. Use "Short" (200-500 words), "Medium" (500-1000 words), or "Long" (1000-2000 words) for length estimates.
5. Aim for 6-12 sections. Fewer than 6 means the source material is not being covered thoroughly. More than 12 means sections are too granular.`;
}

/**
 * Build the section expansion prompt for an author model.
 */
export function buildSectionPrompt(params: {
  sectionNumber: number;
  sectionTitle: string;
  sectionDescription: string;
  keyTopics: string[];
  length: SectionLength;
  documentTitle: string;
  documentType: DocumentType;
  fullOutline: string;
  userInput: string;
}): string {
  const typeLabel = DOCUMENT_TYPE_LABELS[params.documentType];
  const topicsList = params.keyTopics.map((t) => `- ${t}`).join("\n");

  return `You are authoring Section ${params.sectionNumber} of a ${typeLabel}. Write ONLY your assigned section — do not write any other sections.

DOCUMENT TITLE: ${params.documentTitle}

FULL OUTLINE (for context only — do NOT write other sections):
${params.fullOutline}

YOUR SECTION ASSIGNMENT:
Section ${params.sectionNumber}: ${params.sectionTitle}
Description: ${params.sectionDescription}
Key Topics:
${topicsList}
Target Length: ${params.length}

SOURCE MATERIAL:
${params.userInput}

Rules:
1. Write ONLY Section ${params.sectionNumber}. Do not include content for any other section.
2. Start with the heading: ## Section ${params.sectionNumber}: ${params.sectionTitle}
3. Cover ALL key topics listed in your assignment.
4. Use "See Section X" placeholders for cross-references to other sections.
5. Target the specified length (Short: 200-500 words, Medium: 500-1000 words, Long: 1000-2000 words).
6. Use professional technical writing style appropriate for a ${typeLabel}.
7. Include sub-headings (### level) to organize your section.
8. If the source material does not provide enough information for a topic, note it as "[Requires additional input]".`;
}

/**
 * Build the assembly prompt for the assembler model.
 */
export function buildAssemblyPrompt(params: {
  documentTitle: string;
  documentType: DocumentType;
  fullOutline: string;
  userInput: string;
  sections: Array<{
    sectionNumber: number;
    sectionTitle: string;
    model: string;
    content: string;
  }>;
  failedSections: Array<{
    sectionNumber: number;
    sectionTitle: string;
  }>;
}): string {
  const typeLabel = DOCUMENT_TYPE_LABELS[params.documentType];

  const sectionsText = params.sections
    .map(
      (s) =>
        `--- SECTION ${s.sectionNumber}: ${s.sectionTitle} (authored by ${s.model}) ---\n${s.content}`
    )
    .join("\n\n");

  let failedBlock = "";
  if (params.failedSections.length > 0) {
    const failedList = params.failedSections
      .map((f) => `- Section ${f.sectionNumber}: ${f.sectionTitle}`)
      .join("\n");
    failedBlock = `\nMISSING SECTIONS (authors failed to produce these):\n${failedList}\n`;
  }

  return `You are assembling a ${typeLabel} from independently-authored sections into a unified, polished document. The sections were written by different authors and need integration.

DOCUMENT TITLE: ${params.documentTitle}

ORIGINAL OUTLINE:
${params.fullOutline}

SOURCE MATERIAL:
${params.userInput}

AUTHORED SECTIONS:
${sectionsText}
${failedBlock}
Your tasks:
1. **Terminology Consistency:** Ensure the same concepts use the same terms throughout. Fix any inconsistencies.
2. **Cross-References:** Replace "See Section X" placeholders with proper cross-references. Add new cross-references where sections relate.
3. **Transitions:** Add brief transition paragraphs between sections to create natural flow.
4. **Deduplication:** If multiple sections cover the same ground, consolidate and remove redundancy.
5. **Executive Summary:** Write a 3-5 paragraph executive summary at the beginning that covers key findings, recommendations, and scope.
6. **Table of Contents:** Generate a table of contents with section numbers and titles.
7. **Missing Coverage:** If any section failed or if the outline identified topics not covered, add TODO markers: \`[TODO: Section on X needed]\`.
8. **Formatting:** Ensure consistent heading levels, list styles, and formatting throughout.

Output the complete assembled document starting with the executive summary, then table of contents, then all sections in order.`;
}

// ---------------------------------------------------------------------------
// Pipeline — Non-streaming
// ---------------------------------------------------------------------------

/**
 * Run the full Blueprint pipeline without SSE streaming.
 * Used for testing and batch processing.
 */
export async function runFullBlueprint(
  question: string,
  config: BlueprintConfig = DEFAULT_BLUEPRINT_CONFIG
): Promise<BlueprintResult> {
  // Phase 1: Outline
  const outlinePrompt = buildOutlinePrompt(question, config.documentType);
  const outlineResult = await queryModel(
    config.architectModel,
    outlinePrompt,
    config.timeoutMs
  );

  if (!outlineResult) {
    throw new Error("Architect model failed to produce an outline.");
  }

  const parsed = parseOutline(outlineResult.content);

  if (parsed.sections.length === 0) {
    // Fallback: wrap raw text as a single section
    parsed.sections.push({
      number: 1,
      title: "Full Document",
      description: "Complete document content",
      keyTopics: [],
      length: "Long",
      sourceCoverage: "All source material",
    });
  }

  // Truncate if > 20 sections
  if (parsed.sections.length > 20) {
    parsed.sections = parsed.sections.slice(0, 20);
  }

  const assignedSections = assignSectionsToModels(
    parsed.sections,
    config.authorModels
  );

  const outline: OutlineResult = {
    model: config.architectModel,
    documentTitle: parsed.documentTitle,
    documentType: config.documentType,
    rawOutline: outlineResult.content,
    parsedSections: assignedSections,
    totalSections: assignedSections.length,
    estimatedLength: parsed.summary.estimatedLength,
    keyThemes: parsed.summary.keyThemes,
    responseTimeMs: outlineResult.responseTimeMs,
  };

  // Phase 2: Expand sections in parallel
  const sectionPromises = assignedSections.map((section) =>
    queryModel(
      section.assignedModel!,
      buildSectionPrompt({
        sectionNumber: section.number,
        sectionTitle: section.title,
        sectionDescription: section.description,
        keyTopics: section.keyTopics,
        length: section.length,
        documentTitle: parsed.documentTitle,
        documentType: config.documentType,
        fullOutline: outlineResult.content,
        userInput: question,
      }),
      config.timeoutMs
    )
  );

  const sectionResults = await Promise.allSettled(sectionPromises);

  const sections: SectionResult[] = [];
  const failedSections: FailedSection[] = [];

  sectionResults.forEach((result, index) => {
    const section = assignedSections[index];
    if (
      result.status === "fulfilled" &&
      result.value &&
      result.value.content.trim()
    ) {
      sections.push({
        sectionNumber: section.number,
        sectionTitle: section.title,
        model: section.assignedModel!,
        content: result.value.content,
        wordCount: countWords(result.value.content),
        keyTopicsCovered: section.keyTopics,
        responseTimeMs: result.value.responseTimeMs,
      });
    } else {
      const error =
        result.status === "rejected"
          ? String(result.reason)
          : "Model returned null or empty response";
      failedSections.push({
        sectionNumber: section.number,
        sectionTitle: section.title,
        model: section.assignedModel!,
        error,
      });
    }
  });

  if (sections.length === 0) {
    throw new Error("All section authors failed to produce content.");
  }

  // Phase 3: Assemble
  const assemblyPrompt = buildAssemblyPrompt({
    documentTitle: parsed.documentTitle,
    documentType: config.documentType,
    fullOutline: outlineResult.content,
    userInput: question,
    sections: sections.map((s) => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.sectionTitle,
      model: s.model,
      content: s.content,
    })),
    failedSections: failedSections.map((f) => ({
      sectionNumber: f.sectionNumber,
      sectionTitle: f.sectionTitle,
    })),
  });

  const assemblyQueryResult = await queryModel(
    config.assemblerModel,
    assemblyPrompt,
    config.timeoutMs
  );

  let assemblyDocument: string;
  let assemblyTimeMs: number;

  if (assemblyQueryResult && assemblyQueryResult.content.trim()) {
    assemblyDocument = assemblyQueryResult.content;
    assemblyTimeMs = assemblyQueryResult.responseTimeMs;
  } else {
    // Fallback: concatenate sections with headers
    assemblyDocument = sections
      .sort((a, b) => a.sectionNumber - b.sectionNumber)
      .map((s) => `## Section ${s.sectionNumber}: ${s.sectionTitle}\n\n${s.content}`)
      .join("\n\n---\n\n");
    assemblyTimeMs = 0;
  }

  const todoMarkers = extractTodoMarkers(assemblyDocument);

  return {
    outline,
    sections,
    failedSections,
    assembly: {
      model: config.assemblerModel,
      document: assemblyDocument,
      wordCount: countWords(assemblyDocument),
      hasTodoMarkers: todoMarkers.length > 0,
      todoMarkers,
      responseTimeMs: assemblyTimeMs,
    },
  };
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Blueprint pipeline, emitting SSE events via the controller.
 * Returns stage data for DB persistence.
 */
export async function handleBlueprintStream(
  _controller: ReadableStreamDefaultController,
  _encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: BlueprintConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // --- blueprint_start ---
  emit({
    type: "blueprint_start",
    data: {
      conversationId,
      messageId,
      mode: "blueprint",
      documentType: config.documentType,
    },
  });

  // --- Phase 1: Outline ---
  emit({ type: "outline_start", data: {} });

  const outlinePrompt = buildOutlinePrompt(question, config.documentType);
  const outlineResult = await queryModel(
    config.architectModel,
    outlinePrompt,
    config.timeoutMs
  );

  if (!outlineResult) {
    emit({
      type: "error",
      message: "Architect model failed to produce an outline. Pipeline aborted.",
    });
    return stages;
  }

  let parsed = parseOutline(outlineResult.content);

  // Handle edge cases
  if (parsed.sections.length === 0 && outlineResult.content.trim()) {
    // Wrap raw text as a single section
    parsed = {
      ...parsed,
      sections: [
        {
          number: 1,
          title: "Full Document",
          description: "Complete document content",
          keyTopics: [],
          length: "Long",
          sourceCoverage: "All source material",
        },
      ],
    };
  }

  if (parsed.sections.length > 20) {
    parsed = {
      ...parsed,
      sections: parsed.sections.slice(0, 20),
    };
  }

  if (parsed.sections.length > 0 && parsed.sections.length < 3) {
    // Save the outline but emit error — too few sections
    stages.push({
      stageType: "outline",
      stageOrder: 0,
      model: config.architectModel,
      role: "architect",
      content: outlineResult.content,
      parsedData: {
        documentTitle: parsed.documentTitle,
        documentType: config.documentType,
        sections: parsed.sections,
        totalSections: parsed.sections.length,
        estimatedLength: parsed.summary.estimatedLength,
        keyThemes: parsed.summary.keyThemes,
        responseTimeMs: outlineResult.responseTimeMs,
      },
      responseTimeMs: outlineResult.responseTimeMs,
    });

    emit({
      type: "error",
      message: `Outline produced too few sections (${parsed.sections.length}, minimum 3 required).`,
    });
    return stages;
  }

  if (parsed.sections.length === 0) {
    emit({
      type: "error",
      message: "Architect produced an empty outline. Pipeline aborted.",
    });
    return stages;
  }

  // Assign models round-robin
  const assignedSections = assignSectionsToModels(
    parsed.sections,
    config.authorModels
  );

  const outlineData: OutlineResult = {
    model: config.architectModel,
    documentTitle: parsed.documentTitle,
    documentType: config.documentType,
    rawOutline: outlineResult.content,
    parsedSections: assignedSections,
    totalSections: assignedSections.length,
    estimatedLength: parsed.summary.estimatedLength,
    keyThemes: parsed.summary.keyThemes,
    responseTimeMs: outlineResult.responseTimeMs,
  };

  emit({
    type: "outline_complete",
    data: {
      data: {
        documentTitle: parsed.documentTitle,
        documentType: config.documentType,
        sections: assignedSections.map((s) => ({
          number: s.number,
          title: s.title,
          description: s.description,
          keyTopics: s.keyTopics,
          length: s.length,
          assignedModel: s.assignedModel,
        })),
        totalSections: assignedSections.length,
        estimatedLength: parsed.summary.estimatedLength,
        keyThemes: parsed.summary.keyThemes,
        architectModel: config.architectModel,
        responseTimeMs: outlineResult.responseTimeMs,
      },
    },
  });

  stages.push({
    stageType: "outline",
    stageOrder: 0,
    model: config.architectModel,
    role: "architect",
    content: outlineResult.content,
    parsedData: {
      documentTitle: parsed.documentTitle,
      documentType: config.documentType,
      sections: assignedSections,
      totalSections: assignedSections.length,
      estimatedLength: parsed.summary.estimatedLength,
      keyThemes: parsed.summary.keyThemes,
      responseTimeMs: outlineResult.responseTimeMs,
    },
    responseTimeMs: outlineResult.responseTimeMs,
  });

  // --- Phase 2: Expand sections in parallel ---
  emit({
    type: "expansion_start",
    data: { totalSections: assignedSections.length },
  });

  const sectionPromises = assignedSections.map((section) =>
    queryModel(
      section.assignedModel!,
      buildSectionPrompt({
        sectionNumber: section.number,
        sectionTitle: section.title,
        sectionDescription: section.description,
        keyTopics: section.keyTopics,
        length: section.length,
        documentTitle: parsed.documentTitle,
        documentType: config.documentType,
        fullOutline: outlineResult.content,
        userInput: question,
      }),
      config.timeoutMs
    )
  );

  const sectionResults = await Promise.allSettled(sectionPromises);

  const successfulSections: SectionResult[] = [];
  const failedSections: FailedSection[] = [];

  // Process results in order, emit per section
  sectionResults.forEach((result, index) => {
    const section = assignedSections[index];
    if (
      result.status === "fulfilled" &&
      result.value &&
      result.value.content.trim()
    ) {
      const sectionData: SectionResult = {
        sectionNumber: section.number,
        sectionTitle: section.title,
        model: section.assignedModel!,
        content: result.value.content,
        wordCount: countWords(result.value.content),
        keyTopicsCovered: section.keyTopics,
        responseTimeMs: result.value.responseTimeMs,
      };
      successfulSections.push(sectionData);

      emit({
        type: "section_complete",
        data: {
          data: {
            ...sectionData,
            index,
            totalSections: assignedSections.length,
          },
        },
      });

      stages.push({
        stageType: `section_${section.number}`,
        stageOrder: section.number,
        model: section.assignedModel!,
        role: "author",
        content: result.value.content,
        parsedData: {
          sectionNumber: section.number,
          sectionTitle: section.title,
          wordCount: sectionData.wordCount,
          keyTopicsCovered: section.keyTopics,
          targetLength: section.length,
          responseTimeMs: result.value.responseTimeMs,
        },
        responseTimeMs: result.value.responseTimeMs,
      });
    } else {
      const error =
        result.status === "rejected"
          ? String(result.reason)
          : "Model returned null or empty response";
      failedSections.push({
        sectionNumber: section.number,
        sectionTitle: section.title,
        model: section.assignedModel!,
        error,
      });
    }
  });

  if (successfulSections.length === 0) {
    emit({
      type: "error",
      message: "All section authors failed to produce content.",
    });
    return stages;
  }

  emit({
    type: "all_sections_complete",
    data: {
      data: {
        sections: successfulSections.map((s) => ({
          sectionNumber: s.sectionNumber,
          sectionTitle: s.sectionTitle,
          model: s.model,
          content: s.content,
          wordCount: s.wordCount,
          responseTimeMs: s.responseTimeMs,
        })),
        failedSections: failedSections.map((f) => ({
          sectionNumber: f.sectionNumber,
          sectionTitle: f.sectionTitle,
          model: f.model,
          error: f.error,
        })),
        totalSucceeded: successfulSections.length,
        totalFailed: failedSections.length,
      },
    },
  });

  // --- Phase 3: Assemble ---
  emit({ type: "assembly_start", data: {} });

  const assemblyPrompt = buildAssemblyPrompt({
    documentTitle: parsed.documentTitle,
    documentType: config.documentType,
    fullOutline: outlineResult.content,
    userInput: question,
    sections: successfulSections.map((s) => ({
      sectionNumber: s.sectionNumber,
      sectionTitle: s.sectionTitle,
      model: s.model,
      content: s.content,
    })),
    failedSections: failedSections.map((f) => ({
      sectionNumber: f.sectionNumber,
      sectionTitle: f.sectionTitle,
    })),
  });

  const assemblyQueryResult = await queryModel(
    config.assemblerModel,
    assemblyPrompt,
    config.timeoutMs
  );

  let assemblyDocument: string;
  let assemblyTimeMs: number;

  if (assemblyQueryResult && assemblyQueryResult.content.trim()) {
    assemblyDocument = assemblyQueryResult.content;
    assemblyTimeMs = assemblyQueryResult.responseTimeMs;
  } else {
    // Fallback: concatenate successful sections with headers
    assemblyDocument = successfulSections
      .sort((a, b) => a.sectionNumber - b.sectionNumber)
      .map(
        (s) =>
          `## Section ${s.sectionNumber}: ${s.sectionTitle}\n\n${s.content}`
      )
      .join("\n\n---\n\n");
    assemblyTimeMs = 0;

    if (failedSections.length > 0) {
      const todoBlock = failedSections
        .map(
          (f) =>
            `[TODO: Section ${f.sectionNumber} on ${f.sectionTitle} needed]`
        )
        .join("\n");
      assemblyDocument += `\n\n---\n\n## Missing Sections\n\n${todoBlock}`;
    }
  }

  const todoMarkers = extractTodoMarkers(assemblyDocument);

  const assemblyResult: AssemblyResult = {
    model: config.assemblerModel,
    document: assemblyDocument,
    wordCount: countWords(assemblyDocument),
    hasTodoMarkers: todoMarkers.length > 0,
    todoMarkers,
    responseTimeMs: assemblyTimeMs,
  };

  emit({
    type: "assembly_complete",
    data: {
      data: {
        model: assemblyResult.model,
        document: assemblyResult.document,
        wordCount: assemblyResult.wordCount,
        hasTodoMarkers: assemblyResult.hasTodoMarkers,
        responseTimeMs: assemblyResult.responseTimeMs,
      },
    },
  });

  stages.push({
    stageType: "assembly",
    stageOrder: 13,
    model: config.assemblerModel,
    role: "assembler",
    content: assemblyDocument,
    parsedData: {
      documentTitle: outlineData.documentTitle,
      totalWordCount: assemblyResult.wordCount,
      sectionsAssembled: successfulSections.length,
      sectionsMissing: failedSections.length,
      hasTodoMarkers: assemblyResult.hasTodoMarkers,
      todoMarkers,
      responseTimeMs: assemblyTimeMs,
    },
    responseTimeMs: assemblyTimeMs,
  });

  // Note: title generation and "complete" event are handled by the route dispatcher.

  return stages;
}
