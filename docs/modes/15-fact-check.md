# 15 — Fact-Check Mode

> Extract, verify, report. Multi-phase verification pipeline for factual claims.

**Family:** Verification
**Status:** Specified
**Min Models:** 3 (1 generator or user content + 1 extractor + 1 checker; extractor may double as checker)
**Max Models:** 1 generator + 1 extractor + 4 checkers + 1 reporter (7 total)
**Multi-turn:** No
**Stages:** Generate (optional) + Extract + Verify (parallel) + Report

---

## A. Requirements

### Functional

1. User submits either a question (to generate content) or existing content to fact-check.
2. **Phase 1 — Generate (optional):** If the user provides a question rather than content, a generator model produces a comprehensive response. If the user provides `contentToCheck`, this phase is skipped.
3. **Phase 2 — Extract Claims:** An extractor model analyzes the content and produces a numbered list of discrete, verifiable factual claims. Each claim includes the exact assertion, surrounding context, and claim type (STATISTIC, DATE, ATTRIBUTION, TECHNICAL, COMPARISON, CAUSAL).
4. **Phase 3 — Verify Claims:** Each checker model independently evaluates ALL extracted claims. For each claim: VERIFIED (confirms accuracy with evidence), DISPUTED (provides counter-evidence and correction), or UNVERIFIABLE (cannot determine truth with available knowledge). All checkers run in parallel. Server-side consensus calculation determines majority verdict per claim.
5. **Phase 4 — Report:** A reporter model receives all verification results and produces: a reliability score (0-100), an evidence table with consensus status per claim, detailed findings grouped by verdict, and an annotated version of the original content with inline status markers.
6. A title is generated for new conversations.
7. All results are saved to the database via the `deliberation_stages` table.

### Non-Functional

- Phase 1 (if needed) is a single model call.
- Phase 2 is a single sequential model call (extractor).
- Phase 3 completes in the time of the slowest checker (parallel).
- Phase 4 is a single sequential model call (reporter).
- Per-stage timeout: 120 seconds.
- Global pipeline timeout: 600 seconds.
- Total pipeline target: under 180 seconds.

### Model Constraints

- Minimum 3 models. At minimum: extractor + 1 checker + reporter. Extractor and reporter may be the same model. A checker may also serve as reporter.
- Maximum 7 models: 1 generator + 1 extractor + 4 checkers + 1 reporter.
- Generator is only required when `contentToCheck` is not provided.
- Checker models SHOULD be diverse (different providers) for independent verification.
- Using the same model as both generator and checker is allowed but triggers a bias warning.

### What Makes It Distinct

- Structured claim extraction separates individual assertions for granular verification.
- Independent parallel verification from multiple models prevents single-model bias.
- Consensus mechanism (majority verdict) provides robust accuracy assessment.
- Quantitative reliability score (0-100) gives an at-a-glance content quality measure.
- Annotated content output maps verification results back to the original text.
- Claim typing (STATISTIC, DATE, etc.) enables domain-specific accuracy expectations.

---

## B. Pipeline Design

### Stages

| Stage | Name | Parallel? | Input | Output |
|-------|------|-----------|-------|--------|
| 0 | Generate | No (optional) | User question | Content text |
| 1 | Extract | No | Content text | `ExtractedClaim[]` |
| 2 | Verify | Yes | All claims + content | `ClaimVerification[]` per checker |
| 3 | Report | No | Consensus results | `FactCheckReport` |

### Data Flow

```
User Input (question OR contentToCheck)
    |
    v
Phase 0 (optional): queryModel(generatorModel, generatePrompt)
    | content string
    v
Phase 1: queryModel(extractorModel, extractionPrompt(content))
    | parseClaims() → ExtractedClaim[]
    | if claims.length === 0 → skip to report with "no verifiable claims"
    v
Phase 2: queryModelsParallel(checkerModels, verificationPrompt(claims, content))
    | parseVerifications() per checker → ClaimVerification[]
    | calculateConsensus(claims, allVerifications) → ClaimConsensus[]
    v
Phase 3: queryModel(reporterModel, reportPrompt(content, consensus))
    | FactCheckReport with reliability score, evidence table, annotated content
    v
generateTitle() → save to DB → stream to client
```

### Prompt Templates

**Generate Prompt** (`buildGeneratePrompt` — used only if no `contentToCheck`):

```
Answer the following question comprehensively. Include specific facts, statistics, dates, and claims where relevant. Aim for accuracy, but provide a thorough response.

QUESTION:
{{userQuery}}

Provide a detailed, factual response:
```

**Claim Extraction Prompt** (`buildExtractionPrompt`):

```
You are a claim extraction engine. Analyze the following content and identify ALL verifiable factual claims. A "claim" is a discrete assertion that could theoretically be checked for accuracy.

CONTENT:
{{CONTENT}}

Extract each verifiable claim. Include:
- Specific factual statements (dates, numbers, statistics)
- Cause-and-effect assertions
- Comparisons and rankings
- Attributed statements ("X said Y")
- Technical claims

Do NOT include:
- Opinions or subjective assessments
- Hedged statements ("might", "could", "possibly")
- Tautologies or definitions
- Future predictions

Format:

CLAIM 1: [exact claim as stated in the content]
Context: [surrounding sentence for reference]
Type: [STATISTIC|DATE|ATTRIBUTION|TECHNICAL|COMPARISON|CAUSAL]

CLAIM 2: [exact claim]
Context: [surrounding sentence]
Type: [type]

...

EXTRACTION SUMMARY:
Total claims: [count]
By type: [breakdown]
```

**Verification Prompt** (`buildVerificationPrompt`):

```
You are a fact-checker. Verify each of the following claims extracted from a piece of content. For EACH claim, determine its accuracy based on your knowledge.

ORIGINAL CONTENT (for context):
{{CONTENT}}

CLAIMS TO VERIFY:
{{#each CLAIMS}}
CLAIM {{id}}: {{claim}}
Context: {{context}}
Type: {{type}}

{{/each}}

For EACH claim, provide:
- Verdict: VERIFIED (accurate) / DISPUTED (inaccurate or misleading) / UNVERIFIABLE (cannot determine)
- Evidence: Your reasoning and any supporting or contradicting information
- If DISPUTED: The correct information
- Confidence: HIGH / MEDIUM / LOW

Format:

VERIFICATION {{id}}: {{VERDICT}}
Evidence: [your reasoning]
Correction: [correct information if DISPUTED, otherwise "N/A"]
Confidence: [HIGH|MEDIUM|LOW]

...

VERIFICATION SUMMARY:
Verified: [count]
Disputed: [count]
Unverifiable: [count]
```

**Report Prompt** (`buildReportPrompt`):

```
You are producing a fact-check report for the following content.

ORIGINAL CONTENT:
{{CONTENT}}

CLAIM VERIFICATION RESULTS:
{{#each CONSENSUS}}
CLAIM {{claimId}}: "{{claim}}"
Type: {{type}}
Consensus Verdict: {{consensusVerdict}} ({{agreementRate}}% agreement among {{checkerCount}} checkers)
{{#each verdicts}}
- {{checkerModel}}: {{verdict}} ({{confidence}}) — {{evidence}}
{{/each}}
{{#if correction}}Consensus Correction: {{correction}}{{/if}}

{{/each}}

STATISTICS:
- Total claims extracted: {{totalClaims}}
- Independent checkers: {{checkerCount}}
- Verified: {{verifiedCount}}, Disputed: {{disputedCount}}, Unverifiable: {{unverifiableCount}}

Produce:

# Fact-Check Report

## Content Summary
[1-2 sentence summary of what was fact-checked]

## Overall Reliability Score: [0-100]
[Brief justification. Scoring guide: 90-100 = highly reliable, 70-89 = mostly reliable with minor issues, 50-69 = mixed accuracy, 30-49 = significant inaccuracies, 0-29 = unreliable]

## Evidence Table

| # | Claim | Type | Verdict | Agreement | Correction |
|---|-------|------|---------|:---------:|-----------|
{{#each CONSENSUS}}
| {{claimId}} | {{claim}} | {{type}} | {{consensusVerdict}} | {{agreementRate}}% | {{correction or "—"}} |
{{/each}}

## Detailed Findings

### Verified Claims ({{verifiedCount}})
[List each verified claim with brief supporting evidence from the checkers]

### Disputed Claims ({{disputedCount}})
[List each disputed claim with the correction and contradicting evidence]

### Unverifiable Claims ({{unverifiableCount}})
[List each unverifiable claim with explanation of why verification was not possible]

## Annotated Content
[The original content reproduced with inline markers placed after each identified claim: [VERIFIED] for verified, [DISPUTED] for disputed, [UNVERIFIABLE] for unverifiable]

## Methodology
- Claims extracted by: {{extractorModel}}
- Independent checkers: {{checkerModels}}
- Consensus method: Majority verdict (ties broken conservatively toward DISPUTED)
- Report generated by: {{reporterModel}}
```

### Parser Functions

```typescript
interface ExtractedClaim {
  id: string;            // "claim_1", "claim_2", etc.
  claim: string;         // exact factual assertion
  context: string;       // surrounding sentence for reference
  type: "STATISTIC" | "DATE" | "ATTRIBUTION" | "TECHNICAL" | "COMPARISON" | "CAUSAL";
}

function parseClaims(text: string): ExtractedClaim[] {
  // Regex: /CLAIM\s+(\d+):\s*(.+)\nContext:\s*(.+)\nType:\s*(STATISTIC|DATE|ATTRIBUTION|TECHNICAL|COMPARISON|CAUSAL)/gi
  // Returns array with auto-generated IDs: claim_1, claim_2, ...
  // Fallback: split by "CLAIM" keyword and parse each block
}

interface ClaimVerification {
  claimId: string;       // matches ExtractedClaim.id
  verdict: "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";
  evidence: string;
  correction: string | null;    // only populated if DISPUTED
  confidence: "HIGH" | "MEDIUM" | "LOW";
  checkerModel: string;
}

function parseVerifications(
  text: string,
  model: string,
  expectedClaimIds: string[]
): ClaimVerification[] {
  // Regex: /VERIFICATION\s+(claim_\d+):\s*(VERIFIED|DISPUTED|UNVERIFIABLE)\nEvidence:\s*([\s\S]*?)\nCorrection:\s*([\s\S]*?)\nConfidence:\s*(HIGH|MEDIUM|LOW)/gi
  // Validate that all expected claim IDs have a corresponding verification
  // Missing claims treated as UNVERIFIABLE with evidence "Checker did not address this claim"
}

interface ClaimConsensus {
  claimId: string;
  claim: string;
  context: string;
  type: string;
  verdicts: ClaimVerification[];
  consensusVerdict: "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";
  consensusConfidence: "HIGH" | "MEDIUM" | "LOW";
  agreementRate: number;   // percentage of checkers agreeing with consensus (0-100)
  correction: string | null;  // majority correction if DISPUTED
}

function calculateConsensus(
  claims: ExtractedClaim[],
  allVerifications: ClaimVerification[][]  // outer = per checker, inner = per claim
): ClaimConsensus[] {
  // For each claim:
  //   1. Count verdicts: { VERIFIED: n, DISPUTED: n, UNVERIFIABLE: n }
  //   2. Majority verdict wins
  //   3. Tie between VERIFIED and DISPUTED → DISPUTED (conservative)
  //   4. Tie involving UNVERIFIABLE → the other verdict wins
  //   5. Three-way tie → DISPUTED (most conservative)
  //   6. Agreement rate = count(majority) / total checkers * 100
  //   7. Consensus confidence = most common confidence among majority-verdict checkers
  //   8. Correction = most common correction text among DISPUTED verdicts (if consensus is DISPUTED)
}
```

---

## C. SSE Event Sequence

```
 1. factcheck_start         → { conversationId, messageId, config }
 2. generate_start          → {}                   // only if generating content
 3. generate_complete       → { model, content, responseTimeMs }
 4. extract_start           → {}
 5. extract_complete        → { model, claims, totalClaims, typeBreakdown, responseTimeMs }
 6. verify_start            → { checkerCount, claimCount }
 7. checker_complete        → { model, verifications, summary, responseTimeMs }
    (repeated per checker as each finishes — up to 4 events)
 8. all_checkers_complete   → { consensus }
 9. report_start            → {}
10. report_complete         → { model, reliabilityScore, summary, responseTimeMs }
11. title_complete          → { title }
12. complete                → {}
```

On error at any point:
```
error → { message: string }
```

Special case — no verifiable claims extracted:
```
 4. extract_start           → {}
 5. extract_complete        → { model, claims: [], totalClaims: 0, responseTimeMs }
 6. report_start            → {}    // skip verification entirely
 7. report_complete         → { model, reliabilityScore: null, summary: { verified: 0, disputed: 0, unverifiable: 0, note: "No verifiable claims identified" }, responseTimeMs }
 8. title_complete          → { title }
 9. complete                → {}
```

### TypeScript Payload Interfaces

```typescript
// factcheck_start
interface FactCheckStartPayload {
  conversationId: string;
  messageId: string;
  config: {
    contentSource: "generated" | "user_provided";
    generatorModel?: string;
    extractorModel: string;
    checkerModels: string[];
    reporterModel: string;
  };
}

// generate_complete (optional)
interface GenerateCompletePayload {
  model: string;
  content: string;
  responseTimeMs: number;
}

// extract_complete
interface ExtractCompletePayload {
  model: string;
  claims: Array<{
    id: string;
    claim: string;
    type: string;
  }>;
  totalClaims: number;
  typeBreakdown: Record<string, number>;
  responseTimeMs: number;
}

// verify_start
interface VerifyStartPayload {
  checkerCount: number;
  claimCount: number;
}

// checker_complete (per checker)
interface CheckerCompletePayload {
  model: string;
  verifications: Array<{
    claimId: string;
    verdict: "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";
    confidence: "HIGH" | "MEDIUM" | "LOW";
  }>;
  summary: {
    verified: number;
    disputed: number;
    unverifiable: number;
  };
  responseTimeMs: number;
}

// all_checkers_complete
interface AllCheckersCompletePayload {
  consensus: Array<{
    claimId: string;
    claim: string;
    consensusVerdict: "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";
    agreementRate: number;
    correction: string | null;
  }>;
}

// report_complete
interface ReportCompletePayload {
  model: string;
  reliabilityScore: number | null;  // null if no claims extracted
  summary: {
    verified: number;
    disputed: number;
    unverifiable: number;
    note?: string;
  };
  responseTimeMs: number;
}

// title_complete
interface TitleCompletePayload {
  data: { title: string };
}
```

---

## D. Input Format

### Request Body

```typescript
interface FactCheckStreamRequest {
  question: string;                    // question to generate, OR description of what to check
  mode: "fact_check";
  conversationId?: string;
  modeConfig?: FactCheckConfig;
}

interface FactCheckConfig {
  contentToCheck?: string;             // if provided, skip generation phase
  generatorModel?: string;            // required if no contentToCheck
  extractorModel?: string;
  checkerModels?: string[];           // 1-4 checker models
  reporterModel?: string;
  maxContentLength?: number;          // truncate content, default 20_000
  timeoutMs?: number;                 // per-stage timeout, default 120_000
}
```

### Zod Validation

```typescript
const factCheckConfigSchema = z.object({
  contentToCheck: z.string().optional(),
  generatorModel: z.string().optional(),
  extractorModel: z.string().optional(),
  checkerModels: z.array(z.string()).min(1).max(4).optional(),
  reporterModel: z.string().optional(),
  maxContentLength: z.number().min(500).max(50_000).default(20_000),
  timeoutMs: z.number().min(30_000).max(180_000).default(120_000),
}).refine(
  (data) => data.contentToCheck || data.generatorModel,
  { message: "Either contentToCheck or generatorModel must be provided" }
).optional();

const factCheckRequestSchema = z.object({
  question: z.string().min(1, "Question or content description is required"),
  mode: z.literal("fact_check"),
  conversationId: z.string().optional(),
  modeConfig: factCheckConfigSchema,
});
```

### Example Requests

Fact-check generated content:
```json
{
  "question": "What are the key facts about the history of the Internet?",
  "mode": "fact_check",
  "modeConfig": {
    "generatorModel": "openai/o3",
    "extractorModel": "anthropic/claude-opus-4-6",
    "checkerModels": ["google/gemini-2.5-pro", "meta-llama/llama-4-maverick", "anthropic/claude-sonnet-4"],
    "reporterModel": "anthropic/claude-opus-4-6"
  }
}
```

Fact-check user-provided content:
```json
{
  "question": "Fact-check this article about climate change statistics",
  "mode": "fact_check",
  "modeConfig": {
    "contentToCheck": "Global temperatures have risen by 1.1 degrees Celsius since pre-industrial times. The Paris Agreement was signed in 2015 by 196 countries. CO2 levels reached 421 ppm in 2023, the highest in 800,000 years. China produces 30% of global emissions...",
    "extractorModel": "anthropic/claude-opus-4-6",
    "checkerModels": ["openai/o3", "google/gemini-2.5-pro"],
    "reporterModel": "anthropic/claude-opus-4-6"
  }
}
```

Minimal (defaults):
```json
{
  "question": "What are the health benefits of intermittent fasting?",
  "mode": "fact_check",
  "modeConfig": {
    "generatorModel": "openai/o3"
  }
}
```

---

## E. Output Format

### Result Interface

```typescript
interface FactCheckResult {
  content: {
    source: "generated" | "user_provided";
    model?: string;          // only if generated
    text: string;
    responseTimeMs?: number; // only if generated
  };
  extraction: {
    model: string;
    claims: ExtractedClaim[];
    typeBreakdown: Record<string, number>;
    responseTimeMs: number;
  };
  verification: {
    checkers: Array<{
      model: string;
      verifications: ClaimVerification[];
      summary: { verified: number; disputed: number; unverifiable: number };
      responseTimeMs: number;
    }>;
    consensus: ClaimConsensus[];
  };
  report: {
    model: string;
    reliabilityScore: number | null;
    reportText: string;
    summary: {
      verified: number;
      disputed: number;
      unverifiable: number;
    };
    responseTimeMs: number;
  };
  title?: string;
}
```

### UI Display

- **Phase 1 (Content):** The content being fact-checked displayed as readable text in a bordered card. If generated, shows the generator model name and response time. If user-provided, labeled "User Content."
- **Phase 2 (Claims):** Claims highlighted inline within the content as they are extracted — each claim underlined with a numbered superscript. A sidebar panel shows the full claims list grouped by type (STATISTIC, DATE, etc.) with type badges color-coded. Claim count badge animates as extraction completes.
- **Phase 3 (Verification):** Each claim in the sidebar gets a status icon that updates in real-time as checkers complete: spinner (pending), green check (VERIFIED), red X (DISPUTED), gray question mark (UNVERIFIABLE). Expandable accordion per claim reveals each checker's evidence and confidence. Agreement rate shown as a small progress bar per claim.
- **Phase 4 (Report):** Reliability score displayed prominently as a circular gauge (green 70-100, amber 40-69, red 0-39). Evidence table below with sortable columns. Annotated content section with inline markers ([VERIFIED], [DISPUTED], [UNVERIFIABLE]) styled with background colors. Detailed findings in collapsible sections grouped by verdict category.
- **Metrics Bar:** Total claims, reliability score, checker consensus rate (average agreement across all claims), breakdown by verdict (pie chart or stacked bar).

### DB Storage

All data stored in `deliberation_stages` table:

| stageType | stageOrder | model | role | content | parsedData |
|-----------|------------|-------|------|---------|------------|
| `generate` | 0 | generator model | `generator` | generated content text | `GenerateParsedData` |
| `extract` | 1 | extractor model | `extractor` | raw extraction text | `ExtractionParsedData` |
| `verify_0` | 10 | checker model 0 | `checker` | raw verification text | `VerificationParsedData` |
| `verify_1` | 11 | checker model 1 | `checker` | raw verification text | `VerificationParsedData` |
| `verify_2` | 12 | checker model 2 | `checker` | raw verification text | `VerificationParsedData` |
| `verify_3` | 13 | checker model 3 | `checker` | raw verification text | `VerificationParsedData` |
| `report` | 99 | reporter model | `reporter` | full report text | `ReportParsedData` |

Note: `generate` stage (order 0) is only present when content was generated, not when user provided `contentToCheck`.

---

## F. Edge Cases

| Scenario | Handling |
|----------|----------|
| No verifiable claims found | Extractor returns 0 claims. Skip verification and report phases. Report notes "No verifiable factual claims were identified in this content." Reliability score is `null`. |
| All claims verified | Reliability score 90-100. Report notes high factual accuracy. |
| All claims disputed | Reliability score 0-20. Report warns of significant inaccuracies. |
| A single checker fails | Proceed with remaining checkers. Need minimum 1 valid checker. Note reduced checker count in report metadata. |
| All checkers fail | Emit `error` event: "All verification checkers failed." Extraction data is still saved. |
| Extraction model fails | Fatal error — cannot proceed without claims. Emit `error`: "Claim extraction failed. Cannot proceed with verification." Save content stage if it was generated. |
| Reporter model fails | Fallback: output raw consensus table as a formatted markdown table with claim, verdict, agreement rate, and correction columns. Set `parsedData.fallback = true`. |
| Content too long (> maxContentLength) | Truncate to `maxContentLength` characters (default 20,000). Append note: "[Content truncated to {{maxContentLength}} characters. Claims beyond this point were not analyzed.]" |
| Content is opinion with few facts | Extractor correctly identifies few claims. Report notes "Limited verifiable factual content. This content is primarily opinion or analysis." Reliability score based on whatever claims exist. |
| Claim is ambiguous (checkers split evenly) | Reported as DISPUTED with LOW consensus confidence and low agreement rate. Report calls out the split specifically. |
| Generator and checker are the same model | Allow but emit warning in `factcheck_start` config: `{ biasWarning: "Generator and checker share model — results may be biased toward confirming generated content." }` |
| Very few claims (1-2) | Proceed normally. Report notes "Limited number of verifiable claims." Small sample size means reliability score may not be representative. |
| Checker provides verdict for wrong claim ID | Best-effort matching by claim number. Unmatched verdicts are dropped. Missing verdicts treated as UNVERIFIABLE. |
| Duplicate claims extracted | Deduplicate by exact string match before verification. If claims are similar but not identical, both proceed. |
| Per-stage timeout (120s) | Generate: use user question as fallback content. Extract: fatal, apply extraction failure handling. Verify: proceed with completed checkers (need min 1). Report: apply reporter failure handling. |
| Global pipeline timeout (600s) | Complete current stage, skip remaining stages, emit partial results with available data. |
| Neither contentToCheck nor generatorModel provided | Rejected at Zod validation. Return 400: "Either contentToCheck or generatorModel must be provided." |

---

## G. Database Schema

Uses the `deliberation_stages` table exclusively (no legacy tables).

### Row Shapes

**Generate row (optional — only when content is generated):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "generate",
  stageOrder: 0,
  model: "openai/o3",
  role: "generator",
  content: "The Internet originated from ARPANET, a project funded by the U.S. Department of Defense in 1969. The first message sent was 'LO' — the system crashed before 'LOGIN' could be completed. Tim Berners-Lee invented the World Wide Web in 1989 at CERN...",
  parsedData: {
    contentSource: "generated",
    inputQuestion: "What are the key facts about the history of the Internet?",
    contentLength: 2340,
    wordCount: 387
  },
  responseTimeMs: 7200,
  createdAt: "2026-02-09T..."
}
```

**Extraction row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "extract",
  stageOrder: 1,
  model: "anthropic/claude-opus-4-6",
  role: "extractor",
  content: "CLAIM 1: ARPANET was funded by the U.S. Department of Defense in 1969\nContext: The Internet originated from ARPANET, a project funded by the U.S. Department of Defense in 1969.\nType: DATE\n\nCLAIM 2: The first message sent on ARPANET was 'LO'\nContext: The first message sent was 'LO' — the system crashed before 'LOGIN' could be completed.\nType: ATTRIBUTION\n\nCLAIM 3: Tim Berners-Lee invented the World Wide Web in 1989 at CERN\nContext: Tim Berners-Lee invented the World Wide Web in 1989 at CERN.\nType: DATE\n\n...\n\nEXTRACTION SUMMARY:\nTotal claims: 12\nBy type: DATE: 4, STATISTIC: 3, ATTRIBUTION: 2, TECHNICAL: 2, COMPARISON: 1",
  parsedData: {
    claims: [
      {
        id: "claim_1",
        claim: "ARPANET was funded by the U.S. Department of Defense in 1969",
        context: "The Internet originated from ARPANET, a project funded by the U.S. Department of Defense in 1969.",
        type: "DATE"
      },
      {
        id: "claim_2",
        claim: "The first message sent on ARPANET was 'LO'",
        context: "The first message sent was 'LO' — the system crashed before 'LOGIN' could be completed.",
        type: "ATTRIBUTION"
      },
      {
        id: "claim_3",
        claim: "Tim Berners-Lee invented the World Wide Web in 1989 at CERN",
        context: "Tim Berners-Lee invented the World Wide Web in 1989 at CERN.",
        type: "DATE"
      }
    ],
    totalClaims: 12,
    typeBreakdown: {
      DATE: 4,
      STATISTIC: 3,
      ATTRIBUTION: 2,
      TECHNICAL: 2,
      COMPARISON: 1
    }
  },
  responseTimeMs: 9400,
  createdAt: "2026-02-09T..."
}
```

**Verification row (one per checker):**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "verify_0",
  stageOrder: 10,
  model: "google/gemini-2.5-pro",
  role: "checker",
  content: "VERIFICATION claim_1: VERIFIED\nEvidence: ARPANET was indeed funded by ARPA (Advanced Research Projects Agency), part of the U.S. Department of Defense. The first ARPANET link was established on October 29, 1969.\nCorrection: N/A\nConfidence: HIGH\n\nVERIFICATION claim_2: VERIFIED\nEvidence: The first message on ARPANET was intended to be 'LOGIN' but the system crashed after 'LO'. This occurred on October 29, 1969, between UCLA and SRI.\nCorrection: N/A\nConfidence: HIGH\n\nVERIFICATION claim_3: DISPUTED\nEvidence: Tim Berners-Lee proposed the World Wide Web in 1989 but the first website went live in 1991. 'Invented' is slightly misleading — he proposed the concept in 1989 and implemented it by 1991.\nCorrection: Tim Berners-Lee proposed the World Wide Web in 1989; the first website launched in 1991.\nConfidence: MEDIUM\n\n...\n\nVERIFICATION SUMMARY:\nVerified: 9\nDisputed: 2\nUnverifiable: 1",
  parsedData: {
    verifications: [
      {
        claimId: "claim_1",
        verdict: "VERIFIED",
        evidence: "ARPANET was indeed funded by ARPA, part of the U.S. Department of Defense. First link established October 29, 1969.",
        correction: null,
        confidence: "HIGH"
      },
      {
        claimId: "claim_2",
        verdict: "VERIFIED",
        evidence: "First message intended to be 'LOGIN' but crashed after 'LO'. October 29, 1969, between UCLA and SRI.",
        correction: null,
        confidence: "HIGH"
      },
      {
        claimId: "claim_3",
        verdict: "DISPUTED",
        evidence: "Berners-Lee proposed the WWW in 1989 but the first website went live in 1991.",
        correction: "Tim Berners-Lee proposed the World Wide Web in 1989; the first website launched in 1991.",
        confidence: "MEDIUM"
      }
    ],
    summary: {
      verified: 9,
      disputed: 2,
      unverifiable: 1
    }
  },
  responseTimeMs: 11300,
  createdAt: "2026-02-09T..."
}
```

**Report row:**
```typescript
{
  id: "uuid",
  messageId: "msg-uuid",
  stageType: "report",
  stageOrder: 99,
  model: "anthropic/claude-opus-4-6",
  role: "reporter",
  content: "# Fact-Check Report\n\n## Content Summary\nA comprehensive overview of Internet history covering ARPANET origins, key milestones, and modern developments.\n\n## Overall Reliability Score: 78\nMostly reliable with minor inaccuracies in dating and attribution. Core narrative is sound.\n\n## Evidence Table\n\n| # | Claim | Type | Verdict | Agreement | Correction |\n|---|-------|------|---------|:---------:|------------|\n| claim_1 | ARPANET funded by DoD in 1969 | DATE | VERIFIED | 100% | — |\n| claim_2 | First message was 'LO' | ATTRIBUTION | VERIFIED | 100% | — |\n| claim_3 | Berners-Lee invented WWW in 1989 | DATE | DISPUTED | 67% | Proposed in 1989, first site 1991 |\n...\n\n## Detailed Findings\n...\n\n## Annotated Content\n...\n\n## Methodology\n...",
  parsedData: {
    reliabilityScore: 78,
    verified: 9,
    disputed: 2,
    unverifiable: 1,
    totalClaims: 12,
    checkerCount: 3,
    averageAgreementRate: 85.2
  },
  responseTimeMs: 14100,
  createdAt: "2026-02-09T..."
}
```

### Indexes

The shared index from `00-shared-infrastructure.md` applies:
```sql
CREATE INDEX idx_deliberation_stages_message ON deliberation_stages(message_id, stage_order);
```

### Querying Pattern

To reconstruct a complete Fact-Check result from the database:

```typescript
async function loadFactCheckResult(messageId: string): Promise<FactCheckResult> {
  const stages = await db
    .select()
    .from(deliberationStages)
    .where(eq(deliberationStages.messageId, messageId))
    .orderBy(deliberationStages.stageOrder, deliberationStages.createdAt);

  const generateStage = stages.find((s) => s.stageType === "generate");
  const extractStage = stages.find((s) => s.stageType === "extract");
  const verifyStages = stages.filter((s) => s.stageType.startsWith("verify_"));
  const reportStage = stages.find((s) => s.stageType === "report");

  // Reconstruct claims from extraction stage
  const claims: ExtractedClaim[] = extractStage?.parsedData.claims ?? [];

  // Reconstruct verifications per checker
  const checkers = verifyStages.map((s) => ({
    model: s.model!,
    verifications: s.parsedData.verifications as ClaimVerification[],
    summary: s.parsedData.summary,
    responseTimeMs: s.responseTimeMs!,
  }));

  // Recalculate consensus from stored verifications
  const consensus = calculateConsensus(
    claims,
    checkers.map((c) => c.verifications)
  );

  return {
    content: {
      source: generateStage ? "generated" : "user_provided",
      model: generateStage?.model ?? undefined,
      text: generateStage?.content ?? extractStage?.content ?? "",
      responseTimeMs: generateStage?.responseTimeMs ?? undefined,
    },
    extraction: {
      model: extractStage?.model ?? "unknown",
      claims,
      typeBreakdown: extractStage?.parsedData.typeBreakdown ?? {},
      responseTimeMs: extractStage?.responseTimeMs ?? 0,
    },
    verification: {
      checkers,
      consensus,
    },
    report: {
      model: reportStage?.model ?? "unknown",
      reliabilityScore: reportStage?.parsedData.reliabilityScore ?? null,
      reportText: reportStage?.content ?? "",
      summary: {
        verified: reportStage?.parsedData.verified ?? 0,
        disputed: reportStage?.parsedData.disputed ?? 0,
        unverifiable: reportStage?.parsedData.unverifiable ?? 0,
      },
      responseTimeMs: reportStage?.responseTimeMs ?? 0,
    },
  };
}
```
