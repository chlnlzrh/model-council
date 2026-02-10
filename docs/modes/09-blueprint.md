# 09 — Blueprint Mode

> Outline, parallel section expansion, and assembly into a unified document.

**Family:** Role-Based
**Status:** Specified (Pre-Implementation)
**Min Models:** 2 (1 architect/assembler + 1 author)
**Max Models:** 1 architect + 6 authors + 1 assembler
**Multi-turn:** No

---

## A. Requirements

### Functional

1. User submits source material and selects a document type.
2. **Stage 1 — Outline:** An architect model creates a document skeleton with 6-12 sections, each with title, description, key topics, estimated length, and source coverage.
3. **Stage 2 — Expand:** The skeleton is parsed into individual section briefs. Sections are distributed round-robin across available author models. All sections are expanded in parallel. Each author sees the full outline for context but writes only their assigned section.
4. **Stage 3 — Assemble:** An assembly model receives all expanded sections plus the outline. It ensures terminology consistency, fixes cross-references, adds transitions between sections, deduplicates overlapping content, writes an executive summary, and generates a table of contents. Missing or failed sections are noted with TODO markers.
5. A title is generated for new conversations.
6. All results are saved to the database.

### Non-Functional

- Stage 1 is a single model call (architect).
- Stage 2 completes in the time of the slowest section expansion (parallel).
- Stage 3 is a single model call (assembler).
- Total pipeline target: under 300 seconds (longer due to document generation depth).

### Model Constraints

- Minimum 2 models: 1 architect/assembler (same model) + 1 author.
- Maximum 8 models: 1 architect + 6 authors + 1 assembler.
- The architect and assembler may be the same model (recommended for consistency).
- Author models are assigned sections round-robin.

### What Makes It Distinct

- Purpose-built for long-form document generation (5000+ words).
- Three-phase pipeline mirrors professional writing: outline, draft, edit.
- Parallel section authoring across multiple models maximizes throughput.
- Assembly stage ensures cohesion across independently authored sections.
- Structured outline parsing enables deterministic section assignment.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 1 | Outline | No | User input + document type | `OutlineResult` (parsed skeleton) |
| 2 | Expand | Yes | Per-section: full outline + section brief + source material | `SectionResult[]` |
| 3 | Assemble | No | All sections + outline + source material | `AssemblyResult` |

### Data Flow

```
User Input + Document Type
    |
Stage 1: buildOutlinePrompt(userInput, documentType) -> queryModel(architectModel)
    | OutlineResult (parsed into section briefs)
    | Validate: 3-20 sections, reject if <3 or >20
Stage 2: For each section:
    assignModel(sectionIndex, authorModels) -> round-robin
    buildSectionPrompt(outline, sectionBrief, userInput) -> queryModel(assignedAuthor)
    All sections run in parallel via Promise.allSettled()
    | SectionResult[]
Stage 3: buildAssemblyPrompt(outline, sections, userInput) -> queryModel(assemblerModel)
    | AssemblyResult
generateTitle() -> save to DB -> stream to client
```

### Document Types

```typescript
type DocumentType =
  | "architecture_blueprint"
  | "technical_design_document"
  | "implementation_roadmap"
  | "cost_analysis_report"
  | "security_assessment"
  | "custom";

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  architecture_blueprint: "Architecture Blueprint",
  technical_design_document: "Technical Design Document",
  implementation_roadmap: "Implementation Roadmap",
  cost_analysis_report: "Cost Analysis Report",
  security_assessment: "Security Assessment",
  custom: "Custom Document",
};
```

### Prompt Templates

**Outline Prompt** (`buildOutlinePrompt`):

```
You are a senior technical architect creating a document blueprint. Your task is to analyze the source material and produce a detailed, well-structured outline for a {{DOCUMENT_TYPE}}.

SOURCE MATERIAL:
{{USER_INPUT}}

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
5. Aim for 6-12 sections. Fewer than 6 means the source material is not being covered thoroughly. More than 12 means sections are too granular.
```

**Section Expansion Prompt** (`buildSectionPrompt`):

```
You are authoring Section {{SECTION_NUMBER}} of a {{DOCUMENT_TYPE}}. Write ONLY your assigned section — do not write any other sections.

DOCUMENT TITLE: {{DOCUMENT_TITLE}}

FULL OUTLINE (for context only — do NOT write other sections):
{{FULL_OUTLINE}}

YOUR SECTION ASSIGNMENT:
Section {{SECTION_NUMBER}}: {{SECTION_TITLE}}
Description: {{SECTION_DESCRIPTION}}
Key Topics:
{{#each KEY_TOPICS}}
- {{this}}
{{/each}}
Target Length: {{LENGTH}}

SOURCE MATERIAL:
{{USER_INPUT}}

Rules:
1. Write ONLY Section {{SECTION_NUMBER}}. Do not include content for any other section.
2. Start with the heading: ## Section {{SECTION_NUMBER}}: {{SECTION_TITLE}}
3. Cover ALL key topics listed in your assignment.
4. Use "See Section X" placeholders for cross-references to other sections.
5. Target the specified length (Short: 200-500 words, Medium: 500-1000 words, Long: 1000-2000 words).
6. Use professional technical writing style appropriate for a {{DOCUMENT_TYPE}}.
7. Include sub-headings (### level) to organize your section.
8. If the source material does not provide enough information for a topic, note it as "[Requires additional input]".
```

**Assembly Prompt** (`buildAssemblyPrompt`):

```
You are assembling a {{DOCUMENT_TYPE}} from independently-authored sections into a unified, polished document. The sections were written by different authors and need integration.

DOCUMENT TITLE: {{DOCUMENT_TITLE}}

ORIGINAL OUTLINE:
{{FULL_OUTLINE}}

SOURCE MATERIAL:
{{USER_INPUT}}

AUTHORED SECTIONS:
{{#each SECTIONS}}
--- SECTION {{SECTION_NUMBER}}: {{SECTION_TITLE}} (authored by {{MODEL}}) ---
{{CONTENT}}

{{/each}}

{{#if FAILED_SECTIONS}}
MISSING SECTIONS (authors failed to produce these):
{{#each FAILED_SECTIONS}}
- Section {{SECTION_NUMBER}}: {{SECTION_TITLE}}
{{/each}}
{{/if}}

Your tasks:
1. **Terminology Consistency:** Ensure the same concepts use the same terms throughout. Fix any inconsistencies.
2. **Cross-References:** Replace "See Section X" placeholders with proper cross-references. Add new cross-references where sections relate.
3. **Transitions:** Add brief transition paragraphs between sections to create natural flow.
4. **Deduplication:** If multiple sections cover the same ground, consolidate and remove redundancy.
5. **Executive Summary:** Write a 3-5 paragraph executive summary at the beginning that covers key findings, recommendations, and scope.
6. **Table of Contents:** Generate a table of contents with section numbers and titles.
7. **Missing Coverage:** If any section failed or if the outline identified topics not covered, add TODO markers: `[TODO: Section on X needed]`.
8. **Formatting:** Ensure consistent heading levels, list styles, and formatting throughout.

Output the complete assembled document starting with the executive summary, then table of contents, then all sections in order.
```

**Title Prompt**: Reuses shared `buildTitlePrompt(userInput)`.

### Outline Parser

```typescript
interface ParsedOutline {
  documentTitle: string;
  sections: ParsedSection[];
  summary: {
    totalSections: number;
    estimatedLength: string;
    keyThemes: string[];
  };
}

interface ParsedSection {
  number: number;
  title: string;
  description: string;
  keyTopics: string[];
  length: "Short" | "Medium" | "Long";
  sourceCoverage: string;
  assignedModel?: string;       // set during round-robin assignment
}

function parseOutline(text: string): ParsedOutline {
  // Extract document title
  const titleMatch = text.match(/DOCUMENT TITLE:\s*(.+)/i);
  const documentTitle = titleMatch ? titleMatch[1].trim() : "Untitled Document";

  // Extract sections using regex
  const sectionRegex = /SECTION\s+(\d+):\s*(.+)\nDescription:\s*(.+)\nKey Topics:\s*\n((?:- .+\n?)+)Length:\s*(Short|Medium|Long)\nSource Coverage:\s*(.+)/gi;
  const sections: ParsedSection[] = [];
  let match;

  while ((match = sectionRegex.exec(text)) !== null) {
    const keyTopics = match[4]
      .split("\n")
      .map(line => line.replace(/^-\s*/, "").trim())
      .filter(Boolean);

    sections.push({
      number: parseInt(match[1], 10),
      title: match[2].trim(),
      description: match[3].trim(),
      keyTopics,
      length: match[5].trim() as "Short" | "Medium" | "Long",
      sourceCoverage: match[6].trim(),
    });
  }

  // Extract summary
  const totalMatch = text.match(/Total sections:\s*(\d+)/i);
  const lengthMatch = text.match(/Estimated total length:\s*(.+)/i);
  const themesMatch = text.match(/Key themes:\s*(.+)/i);

  return {
    documentTitle,
    sections,
    summary: {
      totalSections: totalMatch ? parseInt(totalMatch[1], 10) : sections.length,
      estimatedLength: lengthMatch ? lengthMatch[1].trim() : "Unknown",
      keyThemes: themesMatch
        ? themesMatch[1].split(",").map(t => t.trim())
        : [],
    },
  };
}
```

### Round-Robin Assignment

```typescript
function assignSectionsToModels(
  sections: ParsedSection[],
  authorModels: string[]
): ParsedSection[] {
  return sections.map((section, index) => ({
    ...section,
    assignedModel: authorModels[index % authorModels.length],
  }));
}
```

---

## C. SSE Event Sequence

```
1. blueprint_start          -> { conversationId, messageId, mode: "blueprint", documentType: string }
2. outline_start            -> {}
3. outline_complete         -> { data: OutlineCompletePayload }
4. expansion_start          -> { totalSections: number }
5. section_complete         -> { data: SectionCompletePayload }    // emitted per section as each finishes
   ... (repeated for each section)
6. all_sections_complete    -> { data: AllSectionsPayload }
7. assembly_start           -> {}
8. assembly_complete        -> { data: AssemblyCompletePayload }
9. title_complete           -> { data: { title: string } }         // new conversations only
10. complete                -> {}
```

On error at any point:
```
error -> { message: string }
```

### TypeScript Payload Interfaces

```typescript
// blueprint_start
interface BlueprintStartPayload {
  conversationId: string;
  messageId: string;
  mode: "blueprint";
  documentType: string;
}

// outline_complete
interface OutlineCompletePayload {
  data: {
    documentTitle: string;
    documentType: string;
    sections: Array<{
      number: number;
      title: string;
      description: string;
      keyTopics: string[];
      length: "Short" | "Medium" | "Long";
      assignedModel: string;
    }>;
    totalSections: number;
    estimatedLength: string;
    keyThemes: string[];
    architectModel: string;
    responseTimeMs: number;
  };
}

// section_complete (emitted per section as each finishes)
interface SectionCompletePayload {
  data: {
    sectionNumber: number;
    sectionTitle: string;
    model: string;
    content: string;
    wordCount: number;
    keyTopicsCovered: string[];
    responseTimeMs: number;
    index: number;              // 0-based position in section list
    totalSections: number;
  };
}

// all_sections_complete
interface AllSectionsPayload {
  data: {
    sections: Array<{
      sectionNumber: number;
      sectionTitle: string;
      model: string;
      content: string;
      wordCount: number;
      responseTimeMs: number;
    }>;
    failedSections: Array<{
      sectionNumber: number;
      sectionTitle: string;
      model: string;
      error: string;
    }>;
    totalSucceeded: number;
    totalFailed: number;
  };
}

// assembly_complete
interface AssemblyCompletePayload {
  data: {
    model: string;
    document: string;           // full assembled document text
    wordCount: number;
    hasTodoMarkers: boolean;
    responseTimeMs: number;
  };
}

// title_complete (shared)
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface BlueprintStreamRequest {
  question: string;                   // source material for the document
  mode: "blueprint";
  conversationId?: string;
  modeConfig: {
    documentType: DocumentType;
    architectModel: string;           // model for outline generation
    authorModels: string[];           // models for section expansion (round-robin)
    assemblerModel: string;           // model for final assembly
    timeoutMs?: number;
  };
}
```

### Zod Validation

```typescript
const blueprintRequestSchema = z.object({
  question: z.string()
    .min(1, "Source material is required")
    .max(200_000, "Source material must be under 200,000 characters"),
  mode: z.literal("blueprint"),
  conversationId: z.string().optional(),
  modeConfig: z.object({
    documentType: z.enum([
      "architecture_blueprint",
      "technical_design_document",
      "implementation_roadmap",
      "cost_analysis_report",
      "security_assessment",
      "custom",
    ]),
    architectModel: z.string().min(1, "Architect model is required"),
    authorModels: z.array(z.string().min(1))
      .min(1, "At least 1 author model is required")
      .max(6, "Maximum 6 author models allowed"),
    assemblerModel: z.string().min(1, "Assembler model is required"),
    timeoutMs: z.number().min(60_000).max(600_000).optional(),
  }),
});
```

### Default Configuration

```typescript
const DEFAULT_BLUEPRINT_CONFIG = {
  documentType: "architecture_blueprint" as DocumentType,
  architectModel: "anthropic/claude-opus-4-6",
  authorModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  assemblerModel: "anthropic/claude-opus-4-6",
  timeoutMs: 300_000,
};
```

### Example Requests

Architecture blueprint:
```json
{
  "question": "We need to design a real-time collaborative document editor supporting 10,000 concurrent users. Tech stack: React frontend, Node.js backend, PostgreSQL. Requirements include: real-time cursor tracking, conflict resolution, version history, offline editing with sync, role-based access control, and audit logging. The system must handle documents up to 50MB with sub-100ms sync latency...",
  "mode": "blueprint",
  "modeConfig": {
    "documentType": "architecture_blueprint",
    "architectModel": "anthropic/claude-opus-4-6",
    "authorModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro"
    ],
    "assemblerModel": "anthropic/claude-opus-4-6"
  }
}
```

Security assessment with many authors:
```json
{
  "question": "[Full application description and architecture details for security review]...",
  "mode": "blueprint",
  "modeConfig": {
    "documentType": "security_assessment",
    "architectModel": "openai/o3",
    "authorModels": [
      "anthropic/claude-opus-4-6",
      "openai/o3",
      "google/gemini-2.5-pro",
      "perplexity/sonar-pro"
    ],
    "assemblerModel": "openai/o3"
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface BlueprintResult {
  outline: OutlineResult;
  sections: SectionResult[];
  failedSections: FailedSection[];
  assembly: AssemblyResult;
  title?: string;
}

interface OutlineResult {
  model: string;
  documentTitle: string;
  documentType: DocumentType;
  rawOutline: string;               // full outline text
  parsedSections: ParsedSection[];
  totalSections: number;
  estimatedLength: string;
  keyThemes: string[];
  responseTimeMs: number;
}

interface SectionResult {
  sectionNumber: number;
  sectionTitle: string;
  model: string;
  content: string;                  // section text
  wordCount: number;
  keyTopicsCovered: string[];       // topics from outline that were addressed
  responseTimeMs: number;
}

interface FailedSection {
  sectionNumber: number;
  sectionTitle: string;
  model: string;
  error: string;
}

interface AssemblyResult {
  model: string;
  document: string;                 // full assembled document
  wordCount: number;
  hasTodoMarkers: boolean;          // true if [TODO: ...] markers present
  responseTimeMs: number;
}
```

### UI Display

- **Outline Stage:** Displayed as a structured tree view showing document title, section numbers/titles with assigned models, estimated lengths as badges (Short/Medium/Long), and key themes as tags. Expandable to show full section descriptions and key topics.
- **Section Expansion:** Progress bar showing N/M sections complete. Each section card appears as it completes, showing section title, author model, word count, and expandable content. Failed sections are shown with error indicators.
- **Assembly:** The final assembled document is the primary displayed response in the chat. Includes a floating table of contents for navigation. TODO markers are highlighted in yellow for visibility.
- **Metadata Panel:** Side panel showing document statistics: total word count, sections completed vs. failed, models used, total pipeline time.

### DB Storage

Uses the `deliberation_stages` table:

| `stageType` | `stageOrder` | `model` | `role` | `content` | `parsedData` |
|-------------|:------------:|---------|--------|-----------|--------------|
| `"outline"` | 0 | architect model ID | `"architect"` | Full outline text | `OutlineParsedData` |
| `"section_1"` | 1 | author model ID | `"author"` | Section 1 expanded text | `SectionParsedData` |
| `"section_2"` | 2 | author model ID | `"author"` | Section 2 expanded text | `SectionParsedData` |
| ... | ... | ... | ... | ... | ... |
| `"section_12"` | 12 | author model ID | `"author"` | Section 12 expanded text | `SectionParsedData` |
| `"assembly"` | 13 | assembler model ID | `"assembler"` | Full assembled document | `AssemblyParsedData` |

Note: Section stageOrder values are 1-12 (matching section numbers). The outline is stageOrder 0 and assembly is stageOrder 13 (always last, regardless of section count).

### parsedData JSONB Examples

**Outline stage (`stageType: "outline"`):**
```json
{
  "documentTitle": "Real-Time Collaborative Editor Architecture",
  "documentType": "architecture_blueprint",
  "sections": [
    {
      "number": 1,
      "title": "System Overview & Requirements",
      "description": "High-level architecture and core requirements",
      "keyTopics": ["Functional requirements", "Non-functional requirements", "System boundaries"],
      "length": "Medium",
      "assignedModel": "anthropic/claude-opus-4-6"
    },
    {
      "number": 2,
      "title": "Real-Time Synchronization Engine",
      "description": "CRDT-based conflict resolution and sync architecture",
      "keyTopics": ["CRDT selection", "Operation transformation", "Sync protocol"],
      "length": "Long",
      "assignedModel": "openai/o3"
    },
    {
      "number": 3,
      "title": "Identity & Access Control",
      "description": "Authentication, authorization, and RBAC implementation",
      "keyTopics": ["Authentication flow", "Role-based permissions", "Document sharing"],
      "length": "Medium",
      "assignedModel": "google/gemini-2.5-pro"
    }
  ],
  "totalSections": 10,
  "estimatedLength": "8,000-12,000 words",
  "keyThemes": [
    "Real-time collaboration",
    "Conflict resolution",
    "Scalability",
    "Security",
    "Offline support"
  ],
  "responseTimeMs": 8500
}
```

**Section stage (`stageType: "section_3"`):**
```json
{
  "sectionNumber": 3,
  "sectionTitle": "Identity & Access Control",
  "wordCount": 1250,
  "keyTopicsCovered": [
    "Authentication flow",
    "Role-based permissions",
    "Document sharing"
  ],
  "targetLength": "Medium",
  "responseTimeMs": 5200
}
```

**Assembly stage (`stageType: "assembly"`):**
```json
{
  "documentTitle": "Real-Time Collaborative Editor Architecture",
  "totalWordCount": 9800,
  "sectionsAssembled": 10,
  "sectionsMissing": 0,
  "hasTodoMarkers": false,
  "todoMarkers": [],
  "crossReferencesAdded": 12,
  "responseTimeMs": 12400
}
```

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| Architect model fails | Emit `error` event. Pipeline aborts. Fatal — cannot proceed without an outline. |
| Outline produces fewer than 3 sections | Emit `error` event: "Outline produced too few sections (minimum 3 required)." Architect output is still saved. |
| Outline produces more than 20 sections | Truncate to first 20 sections. Log warning. Proceed with truncated outline. |
| Outline produces 13-20 sections | Warn user but proceed. More than 12 sections increases pipeline time and context window pressure. |
| Outline parsing fails entirely | Use raw outline text as a single section. Assembly receives one large section. |
| Some section authors fail (but 2+ succeed) | Continue with successful sections. Failed sections are noted in `failedSections`. Assembly is informed which sections are missing and writes them or adds TODO markers. |
| All section authors fail | Emit `error` event: "All section authors failed." Outline is saved. |
| Only 1 section author succeeds | Proceed to assembly with the single section. Assembler writes missing sections or marks TODOs. |
| Section author writes wrong section | Content is included as-is under its assigned section number. Assembler may notice and reorganize during assembly. |
| Section author writes multiple sections | Content is included as-is. Assembler handles deduplication. |
| Assembly model fails | Emit `error` event. Fallback: concatenate all successful sections in order with basic headers. Save concatenation as the assistant message. |
| Context window overflow during assembly | Use condensed sections: section summary (first 200 words) + key points for each section, instead of full text. Note this in the assembly metadata. |
| Source material exceeds 200,000 characters | Rejected at validation with 400 error. |
| Document type is "custom" | Proceed with generic outline prompt (no type-specific guidance). |
| Round-robin with 1 author model | All sections assigned to the same model. Still runs in parallel (model handles concurrent requests via OpenRouter). |
| Conversation mode mismatch | If `conversationId` references a conversation with `mode != "blueprint"`, return 400 error. |

---

## G. Database Schema

Uses the shared `deliberation_stages` table (see `00-shared-infrastructure.md`):

```typescript
// deliberation_stages rows for a single Blueprint pipeline execution
[
  // Stage 0: Outline
  {
    id: "uuid-1",
    messageId: "msg-789",
    stageType: "outline",
    stageOrder: 0,
    model: "anthropic/claude-opus-4-6",
    role: "architect",
    content: "DOCUMENT TITLE: Real-Time Collaborative Editor Architecture\n\nSECTION 1: System Overview...",
    parsedData: {
      documentTitle: "Real-Time Collaborative Editor Architecture",
      documentType: "architecture_blueprint",
      sections: [
        { number: 1, title: "System Overview & Requirements", length: "Medium", assignedModel: "anthropic/claude-opus-4-6" },
        { number: 2, title: "Real-Time Synchronization Engine", length: "Long", assignedModel: "openai/o3" },
        { number: 3, title: "Identity & Access Control", length: "Medium", assignedModel: "google/gemini-2.5-pro" },
        { number: 4, title: "Data Layer & Persistence", length: "Long", assignedModel: "anthropic/claude-opus-4-6" },
        { number: 5, title: "Offline Editing & Sync", length: "Medium", assignedModel: "openai/o3" },
        { number: 6, title: "Frontend Architecture", length: "Medium", assignedModel: "google/gemini-2.5-pro" },
        { number: 7, title: "Infrastructure & Deployment", length: "Medium", assignedModel: "anthropic/claude-opus-4-6" },
        { number: 8, title: "Monitoring & Observability", length: "Short", assignedModel: "openai/o3" },
        { number: 9, title: "Security Hardening", length: "Medium", assignedModel: "google/gemini-2.5-pro" },
        { number: 10, title: "Migration & Rollout Plan", length: "Short", assignedModel: "anthropic/claude-opus-4-6" },
      ],
      totalSections: 10,
      estimatedLength: "8,000-12,000 words",
      keyThemes: ["Real-time collaboration", "Conflict resolution", "Scalability", "Security", "Offline support"],
      responseTimeMs: 8500,
    },
    responseTimeMs: 8500,
  },

  // Stages 1-10: Section expansions (one row per section)
  {
    id: "uuid-2",
    messageId: "msg-789",
    stageType: "section_1",
    stageOrder: 1,
    model: "anthropic/claude-opus-4-6",
    role: "author",
    content: "## Section 1: System Overview & Requirements\n\nThis document describes the architecture...",
    parsedData: {
      sectionNumber: 1,
      sectionTitle: "System Overview & Requirements",
      wordCount: 780,
      keyTopicsCovered: ["Functional requirements", "Non-functional requirements", "System boundaries"],
      targetLength: "Medium",
      responseTimeMs: 4200,
    },
    responseTimeMs: 4200,
  },
  {
    id: "uuid-3",
    messageId: "msg-789",
    stageType: "section_2",
    stageOrder: 2,
    model: "openai/o3",
    role: "author",
    content: "## Section 2: Real-Time Synchronization Engine\n\nThe synchronization engine...",
    parsedData: {
      sectionNumber: 2,
      sectionTitle: "Real-Time Synchronization Engine",
      wordCount: 1580,
      keyTopicsCovered: ["CRDT selection", "Operation transformation", "Sync protocol"],
      targetLength: "Long",
      responseTimeMs: 6100,
    },
    responseTimeMs: 6100,
  },
  // ... sections 3 through 10 follow the same pattern ...

  // Stage 13: Assembly (always stageOrder 13 regardless of section count)
  {
    id: "uuid-12",
    messageId: "msg-789",
    stageType: "assembly",
    stageOrder: 13,
    model: "anthropic/claude-opus-4-6",
    role: "assembler",
    content: "# Real-Time Collaborative Editor Architecture\n\n## Executive Summary\n\nThis architecture blueprint...",
    parsedData: {
      documentTitle: "Real-Time Collaborative Editor Architecture",
      totalWordCount: 9800,
      sectionsAssembled: 10,
      sectionsMissing: 0,
      hasTodoMarkers: false,
      todoMarkers: [],
      crossReferencesAdded: 12,
      responseTimeMs: 12400,
    },
    responseTimeMs: 12400,
  },
]
```

### Indexes

Covered by the shared index on `deliberation_stages(message_id, stage_order)` defined in `00-shared-infrastructure.md`.

### Query Patterns

```typescript
// Load full blueprint result for a message
async function loadBlueprintResult(messageId: string): Promise<BlueprintResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder);

  const outlineStage = stages.find(s => s.stageType === "outline");
  const sectionStages = stages
    .filter(s => s.stageType.startsWith("section_"))
    .sort((a, b) => a.stageOrder - b.stageOrder);
  const assemblyStage = stages.find(s => s.stageType === "assembly");

  const outlineParsed = outlineStage?.parsedData as OutlineParsedData;

  return {
    outline: {
      model: outlineStage!.model!,
      documentTitle: outlineParsed.documentTitle,
      documentType: outlineParsed.documentType as DocumentType,
      rawOutline: outlineStage!.content,
      parsedSections: outlineParsed.sections,
      totalSections: outlineParsed.totalSections,
      estimatedLength: outlineParsed.estimatedLength,
      keyThemes: outlineParsed.keyThemes,
      responseTimeMs: outlineStage!.responseTimeMs!,
    },
    sections: sectionStages.map(s => {
      const parsed = s.parsedData as SectionParsedData;
      return {
        sectionNumber: parsed.sectionNumber,
        sectionTitle: parsed.sectionTitle,
        model: s.model!,
        content: s.content,
        wordCount: parsed.wordCount,
        keyTopicsCovered: parsed.keyTopicsCovered,
        responseTimeMs: s.responseTimeMs!,
      };
    }),
    failedSections: [], // failures are not persisted as rows
    assembly: {
      model: assemblyStage!.model!,
      document: assemblyStage!.content,
      wordCount: (assemblyStage?.parsedData as AssemblyParsedData).totalWordCount,
      hasTodoMarkers: (assemblyStage?.parsedData as AssemblyParsedData).hasTodoMarkers,
      responseTimeMs: assemblyStage!.responseTimeMs!,
    },
  };
}
```

### Conversation-Level Storage

```typescript
// conversations table
{ id, userId, title, mode: "blueprint", createdAt, updatedAt }

// messages table
{ id, conversationId, role: "user", content: sourceInput }
{ id, conversationId, role: "assistant", content: assembledDocument }
```

The assistant message `content` is the assembler's full document output, ensuring the complete document is accessible from the conversation view.
