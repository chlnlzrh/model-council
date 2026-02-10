/**
 * Peer Review Mode — Independent expert reviews with standardized scoring rubrics.
 *
 * 2-6 reviewer models independently evaluate submitted work against a rubric.
 * A consolidator model aggregates all reviews into a unified report with
 * consensus analysis, findings triage, and prioritized action items.
 *
 * See docs/modes/10-peer-review.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewType =
  | "architecture_review"
  | "code_review"
  | "design_spec_review"
  | "compliance_audit"
  | "business_plan_review"
  | "custom";

export type FindingSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "SUGGESTION";

export interface RubricCriterion {
  name: string;
  description: string;
  weight: number; // 1-5
}

export interface ReviewRubric {
  id: ReviewType;
  name: string;
  description: string;
  criteria: RubricCriterion[];
}

export interface PeerReviewConfig {
  reviewType: ReviewType;
  reviewerModels: string[];        // 2-6 models
  consolidatorModel: string;       // MAY overlap with a reviewer
  customRubric?: {
    name: string;
    description: string;
    criteria: RubricCriterion[];
  };
  timeoutMs: number;
}

export const DEFAULT_PEER_REVIEW_CONFIG: PeerReviewConfig = {
  reviewType: "architecture_review",
  reviewerModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  consolidatorModel: "anthropic/claude-opus-4-6",
  timeoutMs: 150_000,
};

export interface ParsedFinding {
  number: number;
  title: string;
  category: string;
  severity: FindingSeverity;
  location: string;
  description: string;
  impact: string;
  recommendation: string;
}

export interface ParsedReview {
  scores: Array<{
    criterion: string;
    score: number;
    weight: number;
    justification: string;
  }>;
  overallScore: number;
  findings: ParsedFinding[];
  strengths: string[];
  findingCounts: Record<FindingSeverity, number>;
}

export interface ReviewResult {
  reviewerIndex: number;
  model: string;
  reviewText: string;
  scores: ParsedReview["scores"];
  overallScore: number;
  findings: ParsedFinding[];
  findingCounts: Record<FindingSeverity, number>;
  strengths: string[];
  responseTimeMs: number;
}

export interface FailedReviewer {
  reviewerIndex: number;
  model: string;
  error: string;
}

export interface ConsensusScore {
  criterion: string;
  average: number;
  stddev: number;
  agreement: "High" | "Medium" | "Low";
}

export interface ConsolidationResult {
  model: string;
  consolidatedReport: string;
  consensusScores: ConsensusScore[];
  actionItemCount: number;
  criticalFindingCount: number;
  responseTimeMs: number;
}

export interface PeerReviewResult {
  reviews: ReviewResult[];
  failedReviewers: FailedReviewer[];
  consolidation: ConsolidationResult;
  title?: string;
}

// ---------------------------------------------------------------------------
// Severity Descriptions
// ---------------------------------------------------------------------------

export const SEVERITY_DESCRIPTIONS: Record<FindingSeverity, string> = {
  CRITICAL: "Must be fixed before proceeding. Blocks deployment or poses significant risk.",
  MAJOR: "Should be fixed in this iteration. Significant quality or risk concern.",
  MINOR: "Should be fixed when convenient. Low-impact quality issue.",
  SUGGESTION: "Optional improvement. Nice-to-have enhancement.",
};

// ---------------------------------------------------------------------------
// Rubric Registry
// ---------------------------------------------------------------------------

export const REVIEW_RUBRICS: Record<ReviewType, ReviewRubric> = {
  architecture_review: {
    id: "architecture_review",
    name: "Architecture Review",
    description: "Evaluate software architecture for quality, scalability, and operational readiness.",
    criteria: [
      { name: "Scalability", description: "Ability to handle growth in users, data, and traffic without fundamental redesign.", weight: 5 },
      { name: "Security", description: "Protection against threats, secure data handling, authentication, and authorization.", weight: 5 },
      { name: "Maintainability", description: "Code organization, modularity, documentation, and ease of change.", weight: 4 },
      { name: "Cost Efficiency", description: "Resource utilization, infrastructure costs, and optimization opportunities.", weight: 3 },
      { name: "Reliability", description: "Fault tolerance, disaster recovery, data integrity, and uptime guarantees.", weight: 4 },
      { name: "Performance", description: "Latency, throughput, resource usage, and optimization under load.", weight: 3 },
    ],
  },
  code_review: {
    id: "code_review",
    name: "Code Review",
    description: "Evaluate code quality, correctness, and engineering best practices.",
    criteria: [
      { name: "Correctness", description: "Code produces expected results, handles edge cases, and is logically sound.", weight: 5 },
      { name: "Readability", description: "Code is clear, well-named, properly structured, and easy to understand.", weight: 4 },
      { name: "Security", description: "No vulnerabilities, proper input validation, secure data handling.", weight: 5 },
      { name: "Performance", description: "Efficient algorithms, no unnecessary allocations, optimized hot paths.", weight: 3 },
      { name: "Test Coverage", description: "Adequate tests for public interfaces, edge cases, and error conditions.", weight: 4 },
      { name: "Error Handling", description: "Graceful error handling, informative messages, no silent failures.", weight: 4 },
    ],
  },
  design_spec_review: {
    id: "design_spec_review",
    name: "Design Specification Review",
    description: "Evaluate technical design documents for completeness and feasibility.",
    criteria: [
      { name: "Completeness", description: "All required aspects of the design are covered with sufficient detail.", weight: 5 },
      { name: "Feasibility", description: "The design can be implemented with available resources and technology.", weight: 4 },
      { name: "User Impact", description: "Design decisions properly consider end-user experience and needs.", weight: 4 },
      { name: "Technical Accuracy", description: "Technical claims and assumptions are correct and well-supported.", weight: 5 },
      { name: "Risk Assessment", description: "Risks are identified, assessed, and mitigated in the design.", weight: 3 },
    ],
  },
  compliance_audit: {
    id: "compliance_audit",
    name: "Compliance Audit",
    description: "Evaluate regulatory compliance, governance, and audit readiness.",
    criteria: [
      { name: "Regulatory Coverage", description: "All applicable regulations are identified and addressed.", weight: 5 },
      { name: "Gap Identification", description: "Compliance gaps are clearly identified with specific references.", weight: 5 },
      { name: "Evidence Quality", description: "Supporting evidence and documentation are adequate for audit.", weight: 4 },
      { name: "Control Effectiveness", description: "Implemented controls actually mitigate the identified risks.", weight: 4 },
    ],
  },
  business_plan_review: {
    id: "business_plan_review",
    name: "Business Plan Review",
    description: "Evaluate business plans for viability, market fit, and execution readiness.",
    criteria: [
      { name: "Market Analysis", description: "Market sizing, segmentation, and competitive landscape are well-researched.", weight: 4 },
      { name: "Financial Viability", description: "Financial projections are realistic, assumptions are stated, and unit economics work.", weight: 5 },
      { name: "Competitive Advantage", description: "Clear differentiation and defensible competitive moat.", weight: 4 },
      { name: "Risk Assessment", description: "Key risks are identified with mitigation strategies.", weight: 4 },
      { name: "Execution Plan", description: "Clear timeline, milestones, resource allocation, and accountability.", weight: 3 },
    ],
  },
  custom: {
    id: "custom",
    name: "Custom Review",
    description: "User-defined review rubric.",
    criteria: [], // provided by user in modeConfig
  },
};

// ---------------------------------------------------------------------------
// Rubric Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the rubric for a given config. Uses predefined rubrics for known
 * types, or constructs one from `customRubric` when `reviewType === "custom"`.
 */
export function resolveRubric(config: PeerReviewConfig): ReviewRubric {
  if (config.reviewType === "custom") {
    if (!config.customRubric) {
      throw new Error("customRubric is required when reviewType is 'custom'");
    }
    return {
      id: "custom",
      name: config.customRubric.name,
      description: config.customRubric.description,
      criteria: config.customRubric.criteria,
    };
  }
  return REVIEW_RUBRICS[config.reviewType];
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Calculate the weighted score from an array of { score, weight } entries.
 */
export function calculateWeightedScore(
  scores: Array<{ score: number; weight: number }>
): number {
  if (scores.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of scores) {
    weightedSum += s.score * s.weight;
    totalWeight += s.weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

/**
 * Parse a reviewer's structured output into scores, findings, and strengths.
 */
export function parseReview(text: string, rubric: ReviewRubric): ParsedReview {
  const scores: ParsedReview["scores"] = [];

  // Parse scores from markdown table
  for (const criterion of rubric.criteria) {
    const escapedName = criterion.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `\\|\\s*${escapedName}\\s*\\|\\s*(\\d)\\s*\\|\\s*\\d\\s*\\|\\s*([^|]+)\\|`,
      "i"
    );
    const match = text.match(regex);
    if (match) {
      scores.push({
        criterion: criterion.name,
        score: parseInt(match[1], 10),
        weight: criterion.weight,
        justification: match[2].trim(),
      });
    }
  }

  // Calculate weighted overall score
  const overallScore = calculateWeightedScore(scores);

  // Parse findings
  const findingRegex = /\*\*FINDING\s+(\d+):\*\*\s*(.+)\n-\s*\*\*Category:\*\*\s*(.+)\n-\s*\*\*Severity:\*\*\s*(CRITICAL|MAJOR|MINOR|SUGGESTION)\n-\s*\*\*Location:\*\*\s*(.+)\n-\s*\*\*Description:\*\*\s*(.+)\n-\s*\*\*Impact:\*\*\s*(.+)\n-\s*\*\*Recommendation:\*\*\s*(.+)/gi;
  const findings: ParsedFinding[] = [];
  let findingMatch;

  while ((findingMatch = findingRegex.exec(text)) !== null) {
    findings.push({
      number: parseInt(findingMatch[1], 10),
      title: findingMatch[2].trim(),
      category: findingMatch[3].trim(),
      severity: findingMatch[4].trim().toUpperCase() as FindingSeverity,
      location: findingMatch[5].trim(),
      description: findingMatch[6].trim(),
      impact: findingMatch[7].trim(),
      recommendation: findingMatch[8].trim(),
    });
  }

  // Count findings by severity
  const findingCounts: Record<FindingSeverity, number> = {
    CRITICAL: 0,
    MAJOR: 0,
    MINOR: 0,
    SUGGESTION: 0,
  };
  for (const finding of findings) {
    findingCounts[finding.severity]++;
  }

  // Parse strengths
  const strengthsMatch = text.match(/### Strengths[\s\S]*?\n([\s\S]*?)(?=###|$)/i);
  const strengths: string[] = [];
  if (strengthsMatch) {
    const lines = strengthsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim();
      if (cleaned) strengths.push(cleaned);
    }
  }

  return {
    scores,
    overallScore,
    findings,
    strengths,
    findingCounts,
  };
}

/**
 * Calculate consensus scores across multiple reviews for each rubric criterion.
 * Computes average, standard deviation, and agreement level per criterion.
 */
export function calculateConsensusScores(
  reviews: ReviewResult[],
  rubric: ReviewRubric
): ConsensusScore[] {
  return rubric.criteria.map((criterion) => {
    const scoresForCriterion: number[] = [];
    for (const review of reviews) {
      const found = review.scores.find(
        (s) => s.criterion === criterion.name
      );
      if (found) {
        scoresForCriterion.push(found.score);
      }
    }

    if (scoresForCriterion.length === 0) {
      return {
        criterion: criterion.name,
        average: 0,
        stddev: 0,
        agreement: "High" as const,
      };
    }

    const avg =
      scoresForCriterion.reduce((a, b) => a + b, 0) /
      scoresForCriterion.length;

    const variance =
      scoresForCriterion.reduce(
        (sum, val) => sum + (val - avg) ** 2,
        0
      ) / scoresForCriterion.length;
    const stddev = Math.sqrt(variance);

    let agreement: "High" | "Medium" | "Low";
    if (stddev < 0.5) {
      agreement = "High";
    } else if (stddev <= 1.5) {
      agreement = "Medium";
    } else {
      agreement = "Low";
    }

    return {
      criterion: criterion.name,
      average: Math.round(avg * 10) / 10,
      stddev: Math.round(stddev * 100) / 100,
      agreement,
    };
  });
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the review prompt sent to each reviewer model.
 */
export function buildReviewPrompt(
  userInput: string,
  reviewType: ReviewType,
  rubric: ReviewRubric
): string {
  const criteriaList = rubric.criteria
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} (weight: ${c.weight}/5): ${c.description}`
    )
    .join("\n");

  const criteriaRows = rubric.criteria
    .map((c) => `| ${c.name} | [score] | ${c.weight} | [2-3 sentence justification] |`)
    .join("\n");

  return `You are a peer reviewer evaluating the following work against a standardized rubric. Provide a thorough, independent evaluation. Be specific and cite exact locations in the work.

WORK UNDER REVIEW:
${userInput}

REVIEW TYPE: ${rubric.name}

SCORING RUBRIC (1-5 scale):
1 = Critical deficiencies — fundamental issues that must be addressed immediately
2 = Significant gaps — important issues that undermine quality
3 = Adequate — meets minimum expectations but has room for improvement
4 = Good — above average quality with minor issues
5 = Excellent — exceptional quality with negligible issues

CRITERIA TO EVALUATE:
${criteriaList}

Provide your review in this exact format:

## Peer Review

### Scores
| Criterion | Score (1-5) | Weight | Justification |
|-----------|:---:|:---:|---------------|
${criteriaRows}
| **Weighted Overall** | [weighted average to 1 decimal] | | [1 sentence overall assessment] |

### Findings

[For each finding, use this exact format:]

**FINDING [n]:** [Concise title]
- **Category:** [which rubric criterion this relates to]
- **Severity:** [CRITICAL|MAJOR|MINOR|SUGGESTION]
- **Location:** [specific reference to where in the work this applies]
- **Description:** [what the issue is]
- **Impact:** [why this matters]
- **Recommendation:** [specific, actionable fix]

[Include at least 3 findings. Number them sequentially.]

### Strengths
[List 3-5 specific strengths of the work, with references to specific parts.]

### Summary
[2-3 paragraph overall assessment covering: (1) general quality level, (2) most critical issues, (3) recommendation for next steps.]`;
}

/**
 * Build the consolidation prompt sent to the consolidator model.
 */
export function buildConsolidationPrompt(
  userInput: string,
  reviews: Array<{ reviewerIndex: number; model: string; reviewText: string }>,
  rubric: ReviewRubric
): string {
  const criteriaList = rubric.criteria
    .map((c) => `- ${c.name} (weight: ${c.weight}/5): ${c.description}`)
    .join("\n");

  const reviewsText = reviews
    .map(
      (r) =>
        `--- Reviewer ${r.reviewerIndex + 1} (${r.model}) ---\n${r.reviewText}`
    )
    .join("\n\n");

  return `You are consolidating ${reviews.length} independent peer reviews of a work into a unified, actionable report. Your job is to aggregate scores, identify consensus vs. disputed findings, and produce prioritized action items.

ORIGINAL WORK:
${userInput}

REVIEW TYPE: ${rubric.name}

SCORING RUBRIC:
${criteriaList}

INDIVIDUAL REVIEWS:
${reviewsText}

Produce a consolidated report in this exact format:

# Consolidated Peer Review Report

## Consensus Scores
| Criterion | Weight | ${reviews.map((_, i) => `R${i + 1}`).join(" | ")} | Avg | StdDev | Agreement |
|-----------|:---:|${reviews.map(() => ":---:").join("|")}|:---:|:---:|-----------|
[Fill in scores from each reviewer, calculate average, standard deviation, and agreement level (High if stddev < 0.5, Medium if 0.5-1.5, Low if > 1.5)]

## Findings Summary

### By Severity
| Severity | Total Count | Consensus (2+ reviewers) | Unique (1 reviewer) |
|----------|:---:|:---:|:---:|
| CRITICAL | [count] | [count] | [count] |
| MAJOR | [count] | [count] | [count] |
| MINOR | [count] | [count] | [count] |
| SUGGESTION | [count] | [count] | [count] |

### Consensus Findings (Identified by 2+ Reviewers)
[For each consensus finding:]
**[n]. [Title]** (SEVERITY) — Identified by Reviewers [list]
- **Description:** [merged description]
- **Impact:** [consolidated impact]
- **Recommendation:** [best recommendation from reviewers]

### Unique Findings (Identified by 1 Reviewer Only)
[For each unique finding:]
**[n]. [Title]** (SEVERITY) — Reviewer [number] only
- **Description:** [description]
- **Recommendation:** [recommendation]
- **Credibility Note:** [assess whether this finding seems valid despite being unique]

### Disputed Assessments
[For criteria where standard deviation > 1.5 or findings where reviewers explicitly disagree:]
| Topic | Reviewer A Position | Reviewer B Position | Analysis |
|-------|-------------------|-------------------|----------|

## Inter-Reviewer Agreement
| Metric | Value | Interpretation |
|--------|-------|---------------|
| Average Score StdDev | [value] | [interpretation] |
| Findings Overlap Rate | [percentage of findings identified by 2+ reviewers] | [interpretation] |
| Severity Agreement | [percentage where reviewers agree on severity for shared findings] | [interpretation] |

## Prioritized Action Items
[Ordered by: CRITICAL findings first, then by number of reviewers who identified, then by criterion weight.]

1. **[CRITICAL]** [Specific action] — Evidence: [which reviewers, finding numbers]. Effort: [Low/Medium/High].
2. **[CRITICAL]** [action] — Evidence: [...]. Effort: [...].
3. **[MAJOR]** [action] — Evidence: [...]. Effort: [...].
[Continue for all actionable items, maximum 15.]

## Executive Summary
[3-4 paragraphs covering: (1) Overall quality assessment with consensus score, (2) Critical issues requiring immediate attention, (3) Areas of reviewer agreement and disagreement, (4) Recommended next steps and timeline.]`;
}

// ---------------------------------------------------------------------------
// Pipeline (Non-Streaming)
// ---------------------------------------------------------------------------

/**
 * Run the full peer review pipeline without streaming.
 */
export async function runFullPeerReview(
  question: string,
  config: PeerReviewConfig = DEFAULT_PEER_REVIEW_CONFIG
): Promise<PeerReviewResult> {
  const rubric = resolveRubric(config);
  const reviewPrompt = buildReviewPrompt(question, config.reviewType, rubric);

  // Stage 1: Parallel reviews
  const reviewResults = await Promise.allSettled(
    config.reviewerModels.map(async (model, index) => {
      const result = await queryModel(model, reviewPrompt, config.timeoutMs);
      if (!result || !result.content.trim()) {
        throw new Error("Model failed to respond");
      }
      const parsed = parseReview(result.content, rubric);
      return {
        reviewerIndex: index,
        model,
        reviewText: result.content,
        scores: parsed.scores,
        overallScore: parsed.overallScore,
        findings: parsed.findings,
        findingCounts: parsed.findingCounts,
        strengths: parsed.strengths,
        responseTimeMs: result.responseTimeMs,
      } satisfies ReviewResult;
    })
  );

  const reviews: ReviewResult[] = [];
  const failedReviewers: FailedReviewer[] = [];

  reviewResults.forEach((result, i) => {
    if (result.status === "fulfilled") {
      reviews.push(result.value);
    } else {
      failedReviewers.push({
        reviewerIndex: i,
        model: config.reviewerModels[i],
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      });
    }
  });

  if (reviews.length < 2) {
    throw new Error(
      `Peer Review requires at least 2 successful reviews, got ${reviews.length}.`
    );
  }

  // Stage 2: Consolidation
  const consolidationPrompt = buildConsolidationPrompt(
    question,
    reviews.map((r) => ({
      reviewerIndex: r.reviewerIndex,
      model: r.model,
      reviewText: r.reviewText,
    })),
    rubric
  );

  const consolidationResult = await queryModel(
    config.consolidatorModel,
    consolidationPrompt,
    config.timeoutMs
  );

  if (!consolidationResult || !consolidationResult.content.trim()) {
    throw new Error("Consolidator model failed to respond.");
  }

  const consensusScores = calculateConsensusScores(reviews, rubric);

  // Count action items from consolidation report
  const actionItemMatches = consolidationResult.content.match(
    /^\d+\.\s+\*\*/gm
  );
  const actionItemCount = actionItemMatches ? actionItemMatches.length : 0;

  // Count critical findings across all reviews
  const criticalFindingCount = reviews.reduce(
    (sum, r) => sum + r.findingCounts.CRITICAL,
    0
  );

  return {
    reviews,
    failedReviewers,
    consolidation: {
      model: config.consolidatorModel,
      consolidatedReport: consolidationResult.content,
      consensusScores,
      actionItemCount,
      criticalFindingCount,
      responseTimeMs: consolidationResult.responseTimeMs,
    },
  };
}

// ---------------------------------------------------------------------------
// SSE Handler
// ---------------------------------------------------------------------------

export async function handlePeerReviewStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: PeerReviewConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  const rubric = resolveRubric(config);

  // --- review_start ---
  emit({
    type: "review_start",
    data: {
      conversationId,
      messageId,
      mode: "peer_review",
      reviewType: config.reviewType,
    },
  });

  // Build the single review prompt (all reviewers get the same prompt)
  const reviewPrompt = buildReviewPrompt(question, config.reviewType, rubric);

  // --- Stage 1: Parallel Reviews ---
  emit({
    type: "reviewers_start",
    data: { totalReviewers: config.reviewerModels.length },
  });

  const reviews: ReviewResult[] = [];
  const failedReviewers: FailedReviewer[] = [];

  const reviewResults = await Promise.allSettled(
    config.reviewerModels.map(async (model, index) => {
      const result = await queryModel(model, reviewPrompt, config.timeoutMs);
      if (!result || !result.content.trim()) {
        throw new Error("Model failed to respond");
      }

      const parsed = parseReview(result.content, rubric);

      const review: ReviewResult = {
        reviewerIndex: index,
        model,
        reviewText: result.content,
        scores: parsed.scores,
        overallScore: parsed.overallScore,
        findings: parsed.findings,
        findingCounts: parsed.findingCounts,
        strengths: parsed.strengths,
        responseTimeMs: result.responseTimeMs,
      };

      // Emit individual reviewer completion
      emit({
        type: "reviewer_complete",
        data: {
          reviewerIndex: index,
          model,
          reviewText: result.content,
          scores: parsed.scores,
          overallScore: parsed.overallScore,
          findingCounts: parsed.findingCounts,
          findings: parsed.findings,
          strengths: parsed.strengths,
          responseTimeMs: result.responseTimeMs,
          totalReviewers: config.reviewerModels.length,
        },
      });

      return review;
    })
  );

  // Process settled results
  reviewResults.forEach((result, i) => {
    if (result.status === "fulfilled") {
      reviews.push(result.value);

      stages.push({
        stageType: `review_${i + 1}`,
        stageOrder: 1,
        model: config.reviewerModels[i],
        role: "reviewer",
        content: result.value.reviewText,
        parsedData: {
          reviewerIndex: i,
          scores: result.value.scores,
          overallScore: result.value.overallScore,
          findingCounts: result.value.findingCounts,
          findings: result.value.findings,
          strengths: result.value.strengths,
          responseTimeMs: result.value.responseTimeMs,
        },
        responseTimeMs: result.value.responseTimeMs,
      });
    } else {
      const errMsg =
        result.reason instanceof Error ? result.reason.message : "Unknown error";
      failedReviewers.push({
        reviewerIndex: i,
        model: config.reviewerModels[i],
        error: errMsg,
      });
    }
  });

  // --- all_reviewers_complete ---
  const averageOverallScore =
    reviews.length > 0
      ? Math.round(
          (reviews.reduce((sum, r) => sum + r.overallScore, 0) /
            reviews.length) *
            10
        ) / 10
      : 0;

  emit({
    type: "all_reviewers_complete",
    data: {
      reviews: reviews.map((r) => ({
        reviewerIndex: r.reviewerIndex,
        model: r.model,
        overallScore: r.overallScore,
        findingCounts: r.findingCounts,
        responseTimeMs: r.responseTimeMs,
      })),
      failedReviewers,
      totalSucceeded: reviews.length,
      totalFailed: failedReviewers.length,
      averageOverallScore,
    },
  });

  // Validate: need at least 2 reviews for consolidation
  if (reviews.length === 0) {
    emit({
      type: "error",
      message: "All reviewers failed to respond. No reviews to consolidate.",
    });
    return stages;
  }

  if (reviews.length < 2) {
    emit({
      type: "error",
      message: "Minimum 2 reviews required for consolidation. Only 1 reviewer succeeded.",
    });
    return stages;
  }

  // --- Stage 2: Consolidation ---
  emit({ type: "consolidation_start" });

  const consolidationPrompt = buildConsolidationPrompt(
    question,
    reviews.map((r) => ({
      reviewerIndex: r.reviewerIndex,
      model: r.model,
      reviewText: r.reviewText,
    })),
    rubric
  );

  const consolidationResult = await queryModel(
    config.consolidatorModel,
    consolidationPrompt,
    config.timeoutMs
  );

  if (!consolidationResult || !consolidationResult.content.trim()) {
    emit({
      type: "error",
      message: "Consolidator model failed to respond. Individual reviews are preserved.",
    });
    return stages;
  }

  // Compute consensus scores server-side (more reliable than parsing LLM output)
  const consensusScores = calculateConsensusScores(reviews, rubric);

  // Count action items from the consolidation report
  const actionItemMatches = consolidationResult.content.match(
    /^\d+\.\s+\*\*/gm
  );
  const actionItemCount = actionItemMatches ? actionItemMatches.length : 0;

  // Count critical findings across all reviews
  const criticalFindingCount = reviews.reduce(
    (sum, r) => sum + r.findingCounts.CRITICAL,
    0
  );

  emit({
    type: "consolidation_complete",
    data: {
      model: config.consolidatorModel,
      consolidatedReport: consolidationResult.content,
      consensusScores,
      actionItemCount,
      criticalFindingCount,
      responseTimeMs: consolidationResult.responseTimeMs,
    },
  });

  stages.push({
    stageType: "consolidation",
    stageOrder: 2,
    model: config.consolidatorModel,
    role: "consolidator",
    content: consolidationResult.content,
    parsedData: {
      reviewerCount: reviews.length,
      consensusScores,
      actionItemCount,
      criticalFindingCount,
      responseTimeMs: consolidationResult.responseTimeMs,
    },
    responseTimeMs: consolidationResult.responseTimeMs,
  });

  // Note: title generation and "complete" event handled by the route dispatcher.
  return stages;
}
