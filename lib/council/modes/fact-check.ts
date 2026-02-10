/**
 * Fact-Check Mode — Multi-phase verification pipeline for factual claims.
 *
 * Pipeline:
 *   Phase 0 (Generate):  Optional — generate content from a question
 *   Phase 1 (Extract):   Sequential — extract discrete claims from content
 *   Phase 2 (Verify):    Parallel — each checker verifies all claims
 *   Phase 3 (Report):    Sequential — produce reliability report with score
 *
 * See docs/modes/15-fact-check.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ClaimType =
  | "STATISTIC"
  | "DATE"
  | "ATTRIBUTION"
  | "TECHNICAL"
  | "COMPARISON"
  | "CAUSAL";

export type Verdict = "VERIFIED" | "DISPUTED" | "UNVERIFIABLE";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface ExtractedClaim {
  id: string;
  claim: string;
  context: string;
  type: ClaimType;
}

export interface ClaimVerification {
  claimId: string;
  verdict: Verdict;
  evidence: string;
  correction: string | null;
  confidence: ConfidenceLevel;
  checkerModel: string;
}

export interface ClaimConsensus {
  claimId: string;
  claim: string;
  context: string;
  type: string;
  verdicts: ClaimVerification[];
  consensusVerdict: Verdict;
  consensusConfidence: ConfidenceLevel;
  agreementRate: number;
  correction: string | null;
}

export interface FactCheckConfig {
  contentToCheck?: string;
  generatorModel?: string;
  extractorModel: string;
  checkerModels: string[];
  reporterModel: string;
  maxContentLength: number;
  timeoutMs: number;
}

export const DEFAULT_FACT_CHECK_CONFIG: FactCheckConfig = {
  extractorModel: "anthropic/claude-opus-4-6",
  checkerModels: [
    "openai/o3",
    "google/gemini-2.5-pro",
    "anthropic/claude-opus-4-6",
  ],
  reporterModel: "anthropic/claude-opus-4-6",
  maxContentLength: 20_000,
  timeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// Valid claim types for validation
// ---------------------------------------------------------------------------

const VALID_CLAIM_TYPES: readonly ClaimType[] = [
  "STATISTIC",
  "DATE",
  "ATTRIBUTION",
  "TECHNICAL",
  "COMPARISON",
  "CAUSAL",
];

// ---------------------------------------------------------------------------
// Pure Functions — Parsers & Utilities
// ---------------------------------------------------------------------------

/**
 * Parse structured claim text from the extractor's response.
 *
 * Expects format:
 *   CLAIM 1: The claim text
 *   Context: Surrounding context
 *   Type: STATISTIC|DATE|ATTRIBUTION|TECHNICAL|COMPARISON|CAUSAL
 *
 * IDs are generated as `claim_${num}`.
 * Deduplicates by exact claim string.
 */
export function parseClaims(text: string): ExtractedClaim[] {
  if (!text || !text.trim()) return [];

  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();

  const blocks = text.matchAll(
    /CLAIM\s+(\d+):\s*(.+)\nContext:\s*(.+)\nType:\s*(STATISTIC|DATE|ATTRIBUTION|TECHNICAL|COMPARISON|CAUSAL)/gi
  );

  for (const match of blocks) {
    const num = parseInt(match[1], 10);
    const claim = match[2].trim();
    const context = match[3].trim();
    const rawType = match[4].toUpperCase() as ClaimType;

    // Validate claim type
    if (!VALID_CLAIM_TYPES.includes(rawType)) continue;

    // Deduplicate by exact claim string
    if (seen.has(claim)) continue;
    seen.add(claim);

    claims.push({
      id: `claim_${num}`,
      claim,
      context,
      type: rawType,
    });
  }

  return claims;
}

/**
 * Parse verification results from a checker's response.
 *
 * Expects format:
 *   VERIFICATION claim_1: VERIFIED
 *   Evidence: reasoning text
 *   Correction: N/A
 *   Confidence: HIGH
 *
 * Missing claims are treated as UNVERIFIABLE.
 * Unrecognized claim IDs are dropped.
 */
export function parseVerifications(
  text: string,
  model: string,
  expectedClaimIds: string[]
): ClaimVerification[] {
  if (!text || !text.trim()) {
    // Empty text → all expected claims UNVERIFIABLE
    return expectedClaimIds.map((claimId) => ({
      claimId,
      verdict: "UNVERIFIABLE" as Verdict,
      evidence: "Checker did not provide a response",
      correction: null,
      confidence: "LOW" as ConfidenceLevel,
      checkerModel: model,
    }));
  }

  const parsed = new Map<string, ClaimVerification>();
  const expectedSet = new Set(expectedClaimIds);

  const blocks = text.matchAll(
    /VERIFICATION\s+(claim_\d+):\s*(VERIFIED|DISPUTED|UNVERIFIABLE)\nEvidence:\s*([\s\S]*?)\nCorrection:\s*([\s\S]*?)\nConfidence:\s*(HIGH|MEDIUM|LOW)/gi
  );

  for (const match of blocks) {
    const claimId = match[1].toLowerCase();
    const verdict = match[2].toUpperCase() as Verdict;
    const evidence = match[3].trim();
    const rawCorrection = match[4].trim();
    const confidence = match[5].toUpperCase() as ConfidenceLevel;

    // Drop unrecognized claim IDs
    if (!expectedSet.has(claimId)) continue;

    // Normalize correction: "N/A", "n/a", empty → null
    const correction =
      verdict === "DISPUTED" &&
      rawCorrection &&
      rawCorrection.toLowerCase() !== "n/a"
        ? rawCorrection
        : null;

    parsed.set(claimId, {
      claimId,
      verdict,
      evidence,
      correction,
      confidence,
      checkerModel: model,
    });
  }

  // Fill missing claims as UNVERIFIABLE
  const results: ClaimVerification[] = [];
  for (const claimId of expectedClaimIds) {
    if (parsed.has(claimId)) {
      results.push(parsed.get(claimId)!);
    } else {
      results.push({
        claimId,
        verdict: "UNVERIFIABLE",
        evidence: "Checker did not address this claim",
        correction: null,
        confidence: "LOW",
        checkerModel: model,
      });
    }
  }

  return results;
}

/**
 * Calculate consensus across all checker verifications.
 *
 * Tie-breaking rules:
 *   - VERIFIED vs DISPUTED → DISPUTED (conservative)
 *   - Tie involving UNVERIFIABLE → the other verdict wins
 *   - 3-way tie → DISPUTED (most conservative)
 */
export function calculateConsensus(
  claims: ExtractedClaim[],
  allVerifications: ClaimVerification[][]
): ClaimConsensus[] {
  if (claims.length === 0) return [];

  return claims.map((claim) => {
    // Gather all verdicts for this claim across checkers
    const verdicts: ClaimVerification[] = [];
    for (const checkerVerifications of allVerifications) {
      const v = checkerVerifications.find((v) => v.claimId === claim.id);
      if (v) verdicts.push(v);
    }

    if (verdicts.length === 0) {
      return {
        claimId: claim.id,
        claim: claim.claim,
        context: claim.context,
        type: claim.type,
        verdicts: [],
        consensusVerdict: "UNVERIFIABLE" as Verdict,
        consensusConfidence: "LOW" as ConfidenceLevel,
        agreementRate: 0,
        correction: null,
      };
    }

    // Count verdicts
    const counts: Record<Verdict, number> = {
      VERIFIED: 0,
      DISPUTED: 0,
      UNVERIFIABLE: 0,
    };
    for (const v of verdicts) {
      counts[v.verdict]++;
    }

    const consensusVerdict = resolveVerdict(counts);
    const majorityCount = counts[consensusVerdict];
    const agreementRate = Math.round((majorityCount / verdicts.length) * 100);
    const consensusConfidence = resolveConfidence(verdicts, consensusVerdict);
    const correction = resolveCorrectionText(verdicts, consensusVerdict);

    return {
      claimId: claim.id,
      claim: claim.claim,
      context: claim.context,
      type: claim.type,
      verdicts,
      consensusVerdict,
      consensusConfidence,
      agreementRate,
      correction,
    };
  });
}

/**
 * Parse the reliability score from the reporter's response.
 * Returns null if not found. Clamps to 0-100.
 */
export function parseReliabilityScore(text: string): number | null {
  if (!text || !text.trim()) return null;

  const match = text.match(/Reliability Score:\s*(\d+)/i);
  if (!match) return null;

  const score = parseInt(match[1], 10);
  return Math.max(0, Math.min(100, score));
}

/**
 * Count words in a text string.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Internal Helpers (NOT exported)
// ---------------------------------------------------------------------------

/**
 * Resolve the consensus verdict from vote counts using conservative tie-breaking.
 */
function resolveVerdict(counts: Record<Verdict, number>): Verdict {
  const { VERIFIED, DISPUTED, UNVERIFIABLE } = counts;

  // Clear majority
  if (VERIFIED > DISPUTED && VERIFIED > UNVERIFIABLE) return "VERIFIED";
  if (DISPUTED > VERIFIED && DISPUTED > UNVERIFIABLE) return "DISPUTED";
  if (UNVERIFIABLE > VERIFIED && UNVERIFIABLE > DISPUTED) return "UNVERIFIABLE";

  // Tie: VERIFIED vs DISPUTED → DISPUTED (conservative)
  if (VERIFIED === DISPUTED && VERIFIED > UNVERIFIABLE) return "DISPUTED";

  // Tie involving UNVERIFIABLE → the other verdict wins
  if (VERIFIED === UNVERIFIABLE && VERIFIED > DISPUTED) return "VERIFIED";
  if (DISPUTED === UNVERIFIABLE && DISPUTED > VERIFIED) return "DISPUTED";

  // Three-way tie → DISPUTED (most conservative)
  return "DISPUTED";
}

/**
 * Resolve consensus confidence from the majority-verdict checkers.
 * Returns the most common confidence level among checkers who gave the consensus verdict.
 */
function resolveConfidence(
  verdicts: ClaimVerification[],
  consensusVerdict: Verdict
): ConfidenceLevel {
  const majorityVerdicts = verdicts.filter(
    (v) => v.verdict === consensusVerdict
  );

  if (majorityVerdicts.length === 0) return "LOW";

  const counts: Record<ConfidenceLevel, number> = {
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
  };

  for (const v of majorityVerdicts) {
    counts[v.confidence]++;
  }

  // Return the most common confidence
  if (counts.HIGH >= counts.MEDIUM && counts.HIGH >= counts.LOW) return "HIGH";
  if (counts.MEDIUM >= counts.HIGH && counts.MEDIUM >= counts.LOW)
    return "MEDIUM";
  return "LOW";
}

/**
 * Resolve the correction text from DISPUTED verdicts.
 * Returns the most common correction by frequency, or null if consensus is not DISPUTED.
 */
function resolveCorrectionText(
  verdicts: ClaimVerification[],
  consensusVerdict: Verdict
): string | null {
  if (consensusVerdict !== "DISPUTED") return null;

  const disputed = verdicts.filter(
    (v) => v.verdict === "DISPUTED" && v.correction !== null
  );

  if (disputed.length === 0) return null;

  // Count correction frequencies
  const correctionCounts = new Map<string, number>();
  for (const v of disputed) {
    const key = v.correction!;
    correctionCounts.set(key, (correctionCounts.get(key) ?? 0) + 1);
  }

  // Return the most common correction
  let maxCount = 0;
  let bestCorrection: string | null = null;
  for (const [correction, count] of correctionCounts) {
    if (count > maxCount) {
      maxCount = count;
      bestCorrection = correction;
    }
  }

  return bestCorrection;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the generate prompt for producing content from a question.
 */
export function buildGeneratePrompt(userQuery: string): string {
  return `Answer the following question comprehensively. Include specific facts, statistics, dates, and claims where relevant. Aim for accuracy, but provide a thorough response.

QUESTION:
${userQuery}

Provide a detailed, factual response:`;
}

/**
 * Build the extraction prompt for identifying verifiable claims.
 */
export function buildExtractionPrompt(content: string): string {
  return `You are a claim extraction engine. Analyze the following content and identify ALL verifiable factual claims. A "claim" is a discrete assertion that could theoretically be checked for accuracy.

CONTENT:
${content}

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
By type: [breakdown]`;
}

/**
 * Build the verification prompt for each checker.
 */
export function buildVerificationPrompt(
  content: string,
  claims: ExtractedClaim[]
): string {
  const claimList = claims
    .map(
      (claim) =>
        `CLAIM ${claim.id}: ${claim.claim}\nContext: ${claim.context}\nType: ${claim.type}`
    )
    .join("\n\n");

  return `You are a fact-checker. Verify each of the following claims extracted from a piece of content. For EACH claim, determine its accuracy based on your knowledge.

ORIGINAL CONTENT (for context):
${content}

CLAIMS TO VERIFY:
${claimList}

For EACH claim, provide:
- Verdict: VERIFIED (accurate) / DISPUTED (inaccurate or misleading) / UNVERIFIABLE (cannot determine)
- Evidence: Your reasoning and any supporting or contradicting information
- If DISPUTED: The correct information
- Confidence: HIGH / MEDIUM / LOW

Format:

VERIFICATION ${claims[0]?.id ?? "claim_1"}: [VERDICT]
Evidence: [your reasoning]
Correction: [correct information if DISPUTED, otherwise "N/A"]
Confidence: [HIGH|MEDIUM|LOW]

...

VERIFICATION SUMMARY:
Verified: [count]
Disputed: [count]
Unverifiable: [count]`;
}

/**
 * Build the report prompt for the reporter model.
 */
export function buildReportPrompt(
  content: string,
  consensus: ClaimConsensus[],
  stats: {
    totalClaims: number;
    checkerCount: number;
    verifiedCount: number;
    disputedCount: number;
    unverifiableCount: number;
    extractorModel: string;
    checkerModels: string[];
    reporterModel: string;
  }
): string {
  const consensusList = consensus
    .map((c) => {
      const verdictDetails = c.verdicts
        .map(
          (v) =>
            `- ${v.checkerModel}: ${v.verdict} (${v.confidence}) — ${v.evidence}`
        )
        .join("\n");
      const correctionLine = c.correction
        ? `Consensus Correction: ${c.correction}`
        : "";
      return `CLAIM ${c.claimId}: "${c.claim}"
Type: ${c.type}
Consensus Verdict: ${c.consensusVerdict} (${c.agreementRate}% agreement among ${stats.checkerCount} checkers)
${verdictDetails}
${correctionLine}`;
    })
    .join("\n\n");

  return `You are producing a fact-check report for the following content.

ORIGINAL CONTENT:
${content}

CLAIM VERIFICATION RESULTS:
${consensusList}

STATISTICS:
- Total claims extracted: ${stats.totalClaims}
- Independent checkers: ${stats.checkerCount}
- Verified: ${stats.verifiedCount}, Disputed: ${stats.disputedCount}, Unverifiable: ${stats.unverifiableCount}

Produce:

# Fact-Check Report

## Content Summary
[1-2 sentence summary of what was fact-checked]

## Overall Reliability Score: [0-100]
[Brief justification. Scoring guide: 90-100 = highly reliable, 70-89 = mostly reliable with minor issues, 50-69 = mixed accuracy, 30-49 = significant inaccuracies, 0-29 = unreliable]

## Evidence Table

| # | Claim | Type | Verdict | Agreement | Correction |
|---|-------|------|---------|:---------:|-----------|
[One row per claim]

## Detailed Findings

### Verified Claims (${stats.verifiedCount})
[List each verified claim with brief supporting evidence from the checkers]

### Disputed Claims (${stats.disputedCount})
[List each disputed claim with the correction and contradicting evidence]

### Unverifiable Claims (${stats.unverifiableCount})
[List each unverifiable claim with explanation of why verification was not possible]

## Annotated Content
[The original content reproduced with inline markers placed after each identified claim: [VERIFIED] for verified, [DISPUTED] for disputed, [UNVERIFIABLE] for unverifiable]

## Methodology
- Claims extracted by: ${stats.extractorModel}
- Independent checkers: ${stats.checkerModels.join(", ")}
- Consensus method: Majority verdict (ties broken conservatively toward DISPUTED)
- Report generated by: ${stats.reporterModel}`;
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Fact-Check pipeline, emitting SSE events via the controller.
 * Returns stage data for DB persistence.
 */
export async function handleFactCheckStream(
  _controller: ReadableStreamDefaultController,
  _encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: FactCheckConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, config } = params;
  const stages: DeliberationStageData[] = [];

  // Detect bias: generator in checker list
  const biasWarning =
    config.generatorModel &&
    config.checkerModels.includes(config.generatorModel)
      ? "Generator and checker share model — results may be biased toward confirming generated content."
      : undefined;

  // --- factcheck_start ---
  emit({
    type: "factcheck_start",
    data: {
      conversationId: params.conversationId,
      messageId: params.messageId,
      config: {
        contentSource: config.contentToCheck ? "user_provided" : "generated",
        generatorModel: config.generatorModel,
        extractorModel: config.extractorModel,
        checkerModels: config.checkerModels,
        reporterModel: config.reporterModel,
      },
      biasWarning,
    },
  });

  // =========================================================================
  // Phase 0 — Generate (optional)
  // =========================================================================

  let content: string;

  if (config.contentToCheck) {
    content = config.contentToCheck;
  } else {
    emit({ type: "generate_start", data: {} });

    const generatePrompt = buildGeneratePrompt(question);
    const generateResult = await queryModel(
      config.generatorModel!,
      generatePrompt,
      config.timeoutMs
    );

    if (!generateResult || !generateResult.content.trim()) {
      // Fallback: use the user question as content
      content = question;
      emit({
        type: "generate_complete",
        data: {
          model: config.generatorModel!,
          content: question,
          responseTimeMs: generateResult?.responseTimeMs ?? 0,
          fallback: true,
        },
      });

      stages.push({
        stageType: "generate",
        stageOrder: 0,
        model: config.generatorModel!,
        role: "generator",
        content: question,
        parsedData: {
          contentSource: "generated",
          inputQuestion: question,
          contentLength: question.length,
          wordCount: countWords(question),
          fallback: true,
        },
        responseTimeMs: generateResult?.responseTimeMs ?? 0,
      });
    } else {
      content = generateResult.content;

      emit({
        type: "generate_complete",
        data: {
          model: config.generatorModel!,
          content: generateResult.content,
          responseTimeMs: generateResult.responseTimeMs,
        },
      });

      stages.push({
        stageType: "generate",
        stageOrder: 0,
        model: config.generatorModel!,
        role: "generator",
        content: generateResult.content,
        parsedData: {
          contentSource: "generated",
          inputQuestion: question,
          contentLength: generateResult.content.length,
          wordCount: countWords(generateResult.content),
        },
        responseTimeMs: generateResult.responseTimeMs,
      });
    }
  }

  // Truncate content if needed
  if (content.length > config.maxContentLength) {
    content =
      content.slice(0, config.maxContentLength) +
      `\n\n[Content truncated to ${config.maxContentLength} characters. Claims beyond this point were not analyzed.]`;
  }

  // =========================================================================
  // Phase 1 — Extract (sequential)
  // =========================================================================

  emit({ type: "extract_start", data: {} });

  const extractionPrompt = buildExtractionPrompt(content);
  const extractResult = await queryModel(
    config.extractorModel,
    extractionPrompt,
    config.timeoutMs
  );

  if (!extractResult || !extractResult.content.trim()) {
    // Fatal: cannot proceed without claims
    emit({
      type: "error",
      message:
        "Claim extraction failed. Cannot proceed with verification.",
    });
    return stages;
  }

  const claims = parseClaims(extractResult.content);

  // Build type breakdown
  const typeBreakdown: Record<string, number> = {};
  for (const claim of claims) {
    typeBreakdown[claim.type] = (typeBreakdown[claim.type] ?? 0) + 1;
  }

  emit({
    type: "extract_complete",
    data: {
      model: config.extractorModel,
      claims: claims.map((c) => ({
        id: c.id,
        claim: c.claim,
        type: c.type,
      })),
      totalClaims: claims.length,
      typeBreakdown,
      responseTimeMs: extractResult.responseTimeMs,
    },
  });

  stages.push({
    stageType: "extract",
    stageOrder: 1,
    model: config.extractorModel,
    role: "extractor",
    content: extractResult.content,
    parsedData: {
      claims: claims.map((c) => ({
        id: c.id,
        claim: c.claim,
        context: c.context,
        type: c.type,
      })),
      totalClaims: claims.length,
      typeBreakdown,
    },
    responseTimeMs: extractResult.responseTimeMs,
  });

  // Edge case: 0 claims → skip verification, go to report
  if (claims.length === 0) {
    emit({ type: "report_start", data: {} });

    const noClaimsReport =
      "# Fact-Check Report\n\n## Content Summary\nNo verifiable factual claims were identified in this content.\n\n## Overall Reliability Score: N/A\nNo verifiable claims to assess.\n\n## Evidence Table\n\nNo claims extracted.\n\n## Methodology\n- Claims extracted by: " +
      config.extractorModel;

    emit({
      type: "report_complete",
      data: {
        model: config.reporterModel,
        reliabilityScore: null,
        summary: {
          verified: 0,
          disputed: 0,
          unverifiable: 0,
          note: "No verifiable claims identified",
        },
        responseTimeMs: 0,
      },
    });

    stages.push({
      stageType: "report",
      stageOrder: 99,
      model: config.reporterModel,
      role: "reporter",
      content: noClaimsReport,
      parsedData: {
        reliabilityScore: null,
        verified: 0,
        disputed: 0,
        unverifiable: 0,
        totalClaims: 0,
        checkerCount: config.checkerModels.length,
        note: "No verifiable claims identified",
      },
      responseTimeMs: 0,
    });

    return stages;
  }

  // =========================================================================
  // Phase 2 — Verify (parallel)
  // =========================================================================

  emit({
    type: "verify_start",
    data: {
      checkerCount: config.checkerModels.length,
      claimCount: claims.length,
    },
  });

  const verificationPrompt = buildVerificationPrompt(content, claims);
  const expectedClaimIds = claims.map((c) => c.id);

  const verificationResults = await queryModelsParallel(
    config.checkerModels,
    verificationPrompt,
    config.timeoutMs
  );

  const allVerifications: ClaimVerification[][] = [];
  let validCheckerCount = 0;

  for (let i = 0; i < config.checkerModels.length; i++) {
    const model = config.checkerModels[i];
    const result = verificationResults.get(model);

    if (!result || !result.content.trim()) {
      // Checker failed — emit event but don't add to verifications
      emit({
        type: "checker_complete",
        data: {
          model,
          verifications: [],
          summary: { verified: 0, disputed: 0, unverifiable: 0 },
          responseTimeMs: result?.responseTimeMs ?? 0,
        },
      });
      continue;
    }

    const verifications = parseVerifications(
      result.content,
      model,
      expectedClaimIds
    );
    validCheckerCount++;
    allVerifications.push(verifications);

    // Build per-checker summary
    const summary = {
      verified: verifications.filter((v) => v.verdict === "VERIFIED").length,
      disputed: verifications.filter((v) => v.verdict === "DISPUTED").length,
      unverifiable: verifications.filter((v) => v.verdict === "UNVERIFIABLE")
        .length,
    };

    emit({
      type: "checker_complete",
      data: {
        model,
        verifications: verifications.map((v) => ({
          claimId: v.claimId,
          verdict: v.verdict,
          confidence: v.confidence,
        })),
        summary,
        responseTimeMs: result.responseTimeMs,
      },
    });

    stages.push({
      stageType: `verify_${i}`,
      stageOrder: 10 + i,
      model,
      role: "checker",
      content: result.content,
      parsedData: {
        verifications: verifications.map((v) => ({
          claimId: v.claimId,
          verdict: v.verdict,
          evidence: v.evidence,
          correction: v.correction,
          confidence: v.confidence,
        })),
        summary,
      },
      responseTimeMs: result.responseTimeMs,
    });
  }

  // Edge case: all checkers failed
  if (validCheckerCount === 0) {
    emit({
      type: "error",
      message: "All verification checkers failed.",
    });
    return stages;
  }

  // Calculate consensus
  const consensus = calculateConsensus(claims, allVerifications);

  emit({
    type: "all_checkers_complete",
    data: {
      consensus: consensus.map((c) => ({
        claimId: c.claimId,
        claim: c.claim,
        consensusVerdict: c.consensusVerdict,
        agreementRate: c.agreementRate,
        correction: c.correction,
      })),
    },
  });

  // =========================================================================
  // Phase 3 — Report (sequential)
  // =========================================================================

  emit({ type: "report_start", data: {} });

  const verifiedCount = consensus.filter(
    (c) => c.consensusVerdict === "VERIFIED"
  ).length;
  const disputedCount = consensus.filter(
    (c) => c.consensusVerdict === "DISPUTED"
  ).length;
  const unverifiableCount = consensus.filter(
    (c) => c.consensusVerdict === "UNVERIFIABLE"
  ).length;

  const reportPrompt = buildReportPrompt(content, consensus, {
    totalClaims: claims.length,
    checkerCount: validCheckerCount,
    verifiedCount,
    disputedCount,
    unverifiableCount,
    extractorModel: config.extractorModel,
    checkerModels: config.checkerModels,
    reporterModel: config.reporterModel,
  });

  const reportResult = await queryModel(
    config.reporterModel,
    reportPrompt,
    config.timeoutMs
  );

  let reportContent: string;
  let reliabilityScore: number | null;
  let reportTimeMs: number;
  let reportFallback = false;

  if (reportResult && reportResult.content.trim()) {
    reportContent = reportResult.content;
    reliabilityScore = parseReliabilityScore(reportResult.content);
    reportTimeMs = reportResult.responseTimeMs;
  } else {
    // Fallback: build markdown table from consensus
    reportFallback = true;
    reportTimeMs = 0;
    reliabilityScore = null;

    const rows = consensus
      .map(
        (c) =>
          `| ${c.claimId} | ${c.claim} | ${c.consensusVerdict} | ${c.agreementRate}% | ${c.correction ?? "—"} |`
      )
      .join("\n");

    reportContent = `# Fact-Check Report (Fallback)\n\n## Evidence Table\n\n| # | Claim | Verdict | Agreement | Correction |\n|---|-------|---------|:---------:|------------|\n${rows}\n\n## Summary\n- Verified: ${verifiedCount}\n- Disputed: ${disputedCount}\n- Unverifiable: ${unverifiableCount}\n\n*Note: The reporter model failed to produce a detailed report. This is a fallback summary.*`;
  }

  // Compute average agreement rate
  const averageAgreementRate =
    consensus.length > 0
      ? Math.round(
          (consensus.reduce((sum, c) => sum + c.agreementRate, 0) /
            consensus.length) *
            100
        ) / 100
      : 0;

  emit({
    type: "report_complete",
    data: {
      model: config.reporterModel,
      reliabilityScore,
      summary: {
        verified: verifiedCount,
        disputed: disputedCount,
        unverifiable: unverifiableCount,
      },
      responseTimeMs: reportTimeMs,
      fallback: reportFallback,
    },
  });

  stages.push({
    stageType: "report",
    stageOrder: 99,
    model: config.reporterModel,
    role: "reporter",
    content: reportContent,
    parsedData: {
      reliabilityScore,
      verified: verifiedCount,
      disputed: disputedCount,
      unverifiable: unverifiableCount,
      totalClaims: claims.length,
      checkerCount: validCheckerCount,
      averageAgreementRate,
      fallback: reportFallback,
    },
    responseTimeMs: reportTimeMs,
  });

  return stages;
}
