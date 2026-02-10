/**
 * Specialist Panel Mode — Role-assigned expert analysis + synthesis.
 *
 * Each model analyzes the same input from a unique specialist perspective
 * (e.g., Security Expert, Cost Analyst, Scalability Architect). Reports
 * run in parallel. A synthesizer model then integrates all perspectives
 * into a unified assessment with convergent/divergent findings and
 * prioritized recommendations.
 *
 * See docs/modes/08-specialist-panel.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel } from "../openrouter";

// ---------------------------------------------------------------------------
// Role Library
// ---------------------------------------------------------------------------

export interface SpecialistRole {
  id: string;
  title: string;
  expertiseAreas: string;
  description: string;
  priorities: string[];
  criteria: string[];
}

export const SPECIALIST_ROLE_LIBRARY: Record<string, SpecialistRole> = {
  security_expert: {
    id: "security_expert",
    title: "Security Expert",
    expertiseAreas: "application security, threat modeling, vulnerability assessment, cryptography, access control",
    description: "You evaluate everything through the lens of security posture, attack surface, and risk mitigation. You prioritize identifying vulnerabilities, ensuring defense-in-depth, and recommending hardening measures.",
    priorities: [
      "Identify security vulnerabilities and attack vectors",
      "Assess authentication and authorization mechanisms",
      "Evaluate data protection and encryption practices",
      "Review compliance with security standards (OWASP, CIS)",
    ],
    criteria: [
      "Authentication & Authorization",
      "Data Protection",
      "Input Validation",
      "Attack Surface",
      "Incident Response Readiness",
    ],
  },
  cost_analyst: {
    id: "cost_analyst",
    title: "Cost Analyst",
    expertiseAreas: "financial analysis, TCO modeling, cloud cost optimization, resource budgeting",
    description: "You evaluate everything through the lens of cost efficiency, ROI, and financial sustainability. You prioritize identifying cost drivers, hidden expenses, and optimization opportunities.",
    priorities: [
      "Calculate total cost of ownership (TCO)",
      "Identify cost optimization opportunities",
      "Assess pricing model risks and lock-in",
      "Evaluate build vs. buy trade-offs",
    ],
    criteria: [
      "Infrastructure Costs",
      "Operational Costs",
      "Scaling Cost Curve",
      "Vendor Lock-in Risk",
      "ROI Timeline",
    ],
  },
  scalability_architect: {
    id: "scalability_architect",
    title: "Scalability Architect",
    expertiseAreas: "distributed systems, horizontal scaling, load balancing, caching strategies, database sharding",
    description: "You evaluate everything through the lens of scalability, performance under load, and architectural resilience. You prioritize identifying bottlenecks, single points of failure, and growth constraints.",
    priorities: [
      "Identify scalability bottlenecks and limits",
      "Assess horizontal vs. vertical scaling strategy",
      "Evaluate data layer scalability",
      "Review fault tolerance and resilience patterns",
    ],
    criteria: [
      "Horizontal Scalability",
      "Data Layer Scalability",
      "Fault Tolerance",
      "Latency Under Load",
      "Resource Efficiency",
    ],
  },
  ux_designer: {
    id: "ux_designer",
    title: "UX Designer",
    expertiseAreas: "user experience design, usability testing, accessibility, information architecture, interaction design",
    description: "You evaluate everything through the lens of user experience, usability, and accessibility. You prioritize user needs, cognitive load reduction, and inclusive design.",
    priorities: [
      "Assess user workflow and task completion efficiency",
      "Evaluate accessibility compliance (WCAG AA)",
      "Review information architecture and navigation",
      "Identify cognitive load and friction points",
    ],
    criteria: [
      "Usability",
      "Accessibility",
      "Information Architecture",
      "Visual Clarity",
      "Error Recovery",
    ],
  },
  devops_engineer: {
    id: "devops_engineer",
    title: "DevOps Engineer",
    expertiseAreas: "CI/CD pipelines, infrastructure as code, monitoring, observability, deployment strategies",
    description: "You evaluate everything through the lens of operational excellence, deployment reliability, and observability. You prioritize automation, reproducibility, and incident response.",
    priorities: [
      "Assess deployment pipeline maturity",
      "Evaluate monitoring and observability coverage",
      "Review infrastructure automation and IaC",
      "Identify operational risk and toil",
    ],
    criteria: [
      "Deployment Automation",
      "Monitoring Coverage",
      "Incident Response",
      "Infrastructure as Code",
      "Environment Parity",
    ],
  },
  compliance_officer: {
    id: "compliance_officer",
    title: "Compliance Officer",
    expertiseAreas: "regulatory compliance, GDPR, HIPAA, SOC 2, data governance, audit readiness",
    description: "You evaluate everything through the lens of regulatory compliance, data governance, and audit readiness. You prioritize identifying compliance gaps, data handling risks, and documentation completeness.",
    priorities: [
      "Identify regulatory compliance gaps",
      "Assess data handling and privacy practices",
      "Evaluate audit trail completeness",
      "Review consent and data retention mechanisms",
    ],
    criteria: [
      "Regulatory Coverage",
      "Data Privacy",
      "Audit Trail",
      "Consent Management",
      "Documentation Completeness",
    ],
  },
  performance_engineer: {
    id: "performance_engineer",
    title: "Performance Engineer",
    expertiseAreas: "performance optimization, profiling, benchmarking, caching, database tuning, CDN strategy",
    description: "You evaluate everything through the lens of runtime performance, latency, throughput, and resource utilization. You prioritize identifying performance bottlenecks and optimization opportunities.",
    priorities: [
      "Profile critical path latency",
      "Identify memory and CPU bottlenecks",
      "Assess caching strategy effectiveness",
      "Evaluate database query performance",
    ],
    criteria: [
      "Response Latency",
      "Throughput",
      "Memory Efficiency",
      "Cache Hit Ratio",
      "Database Performance",
    ],
  },
  data_architect: {
    id: "data_architect",
    title: "Data Architect",
    expertiseAreas: "data modeling, schema design, ETL pipelines, data warehousing, data quality, migration strategies",
    description: "You evaluate everything through the lens of data architecture, schema design, and data lifecycle management. You prioritize data integrity, query efficiency, and schema evolution.",
    priorities: [
      "Evaluate data model correctness and normalization",
      "Assess schema evolution and migration strategy",
      "Review data quality and validation mechanisms",
      "Identify data lifecycle and retention concerns",
    ],
    criteria: [
      "Schema Design",
      "Data Integrity",
      "Query Efficiency",
      "Migration Strategy",
      "Data Quality",
    ],
  },
};

/**
 * Get a specialist role by ID. Returns null for unknown IDs.
 * Use `buildCustomRole()` for custom roles.
 */
export function getSpecialistRole(roleId: string): SpecialistRole | null {
  return SPECIALIST_ROLE_LIBRARY[roleId] ?? null;
}

/**
 * Build a SpecialistRole from custom input.
 */
export function buildCustomRole(input: {
  title: string;
  expertiseAreas: string;
  description: string;
  priorities: string[];
  criteria: string[];
}): SpecialistRole {
  return {
    id: `custom_${input.title.toLowerCase().replace(/\s+/g, "_")}`,
    title: input.title,
    expertiseAreas: input.expertiseAreas,
    description: input.description,
    priorities: input.priorities,
    criteria: input.criteria,
  };
}

/**
 * Get all available role IDs from the library.
 */
export function getAvailableRoleIds(): string[] {
  return Object.keys(SPECIALIST_ROLE_LIBRARY);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecialistAssignment {
  roleId: string;
  model: string;
  customRole?: {
    title: string;
    expertiseAreas: string;
    description: string;
    priorities: string[];
    criteria: string[];
  };
}

export interface PanelConfig {
  specialists: SpecialistAssignment[];
  synthesizerModel: string;
  timeoutMs: number;
}

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
  specialists: [
    { roleId: "security_expert", model: "anthropic/claude-sonnet-4" },
    { roleId: "scalability_architect", model: "openai/gpt-4o" },
    { roleId: "cost_analyst", model: "google/gemini-2.5-flash-preview" },
  ],
  synthesizerModel: "anthropic/claude-sonnet-4",
  timeoutMs: 150_000,
};

export interface ParsedSpecialistReport {
  roleTitle: string;
  criteriaScores: Array<{ criterion: string; score: number; notes: string }>;
  topRecommendations: string[];
  keyFindings: string[];
  averageScore: number;
}

export interface SpecialistReport {
  roleId: string;
  roleTitle: string;
  model: string;
  report: string;
  criteriaScores: Array<{ criterion: string; score: number; notes: string }>;
  topRecommendations: string[];
  keyFindings: string[];
  averageScore: number;
  responseTimeMs: number;
}

export interface FailedSpecialist {
  roleId: string;
  roleTitle: string;
  model: string;
  error: string;
}

export interface SynthesisResult {
  model: string;
  integratedAssessment: string;
  responseTimeMs: number;
}

export interface SpecialistPanelResult {
  specialists: SpecialistReport[];
  failedSpecialists: FailedSpecialist[];
  synthesis: SynthesisResult;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

export function buildSpecialistSystemPrompt(role: SpecialistRole): string {
  const prioritiesList = role.priorities
    .map((p, i) => `${i + 1}. ${p}`)
    .join("\n");
  const criteriaList = role.criteria.map((c) => `- ${c}`).join("\n");

  return `You are a ${role.title} with deep expertise in ${role.expertiseAreas}.

YOUR LENS: ${role.description}

YOUR PRIORITIES (in order):
${prioritiesList}

YOUR EVALUATION CRITERIA:
${criteriaList}`;
}

export function buildSpecialistUserPrompt(
  userInput: string,
  role: SpecialistRole
): string {
  const criteriaRows = role.criteria
    .map((c) => `| ${c} | [score] | [brief justification] |`)
    .join("\n");

  return `Analyze the following content from your specialist perspective. Provide a structured assessment.

CONTENT TO ANALYZE:
${userInput}

Provide your analysis in this exact format:

## ${role.title} Assessment

### Key Findings
[Numbered list of 3-8 findings from your perspective]

### Risk Assessment
| Criterion | Rating (1-5) | Notes |
|-----------|:---:|-------|
${criteriaRows}

### Top 3 Recommendations
1. [Most impactful recommendation from your perspective]
2. [Second priority recommendation]
3. [Third priority recommendation]

### Detailed Analysis
[Full analysis from the ${role.title} perspective, 200-500 words]`;
}

export function buildPanelSynthesisPrompt(
  userInput: string,
  reports: Array<{ roleTitle: string; model: string; report: string }>,
  failedRoles?: string[]
): string {
  const reportsText = reports
    .map((r) => `--- ${r.roleTitle} (${r.model}) ---\n${r.report}`)
    .join("\n\n");

  let failedNote = "";
  if (failedRoles && failedRoles.length > 0) {
    failedNote = `\nNOTE: The following specialist perspectives were unavailable due to errors: ${failedRoles.join(", ")}. Synthesis should account for these missing perspectives.\n`;
  }

  return `You are synthesizing a multi-dimensional specialist panel analysis. ${reports.length} specialists each analyzed the same content from their unique professional perspective.

ORIGINAL INPUT:
${userInput}

SPECIALIST REPORTS:
${reportsText}
${failedNote}
Produce a unified integrated assessment in this exact format:

## Integrated Assessment

### Convergent Findings
[Findings identified by 2 or more specialists. For each, note which specialists agree and their shared conclusion.]

### Divergent Findings
| Finding | Perspective A | Perspective B | Suggested Resolution |
|---------|--------------|---------------|---------------------|
[For each area where specialists reached conflicting conclusions, document both perspectives and suggest a resolution.]

### Consolidated Risk Matrix
| Domain | Risk Level (Critical/High/Medium/Low) | Key Concern | Recommended Action | Source Specialist(s) |
|--------|:---:|-------------|-------------------|---------------------|
[Consolidate risk items from all specialists into a unified matrix, ordered by risk level.]

### Unified Recommendations (Priority Order)
1. [Highest priority — cross-domain impact, supported by multiple specialists]
2. [Second priority]
3. [Third priority]
4. [Fourth priority]
5. [Fifth priority]
[Continue as needed, maximum 10 recommendations]

### Executive Summary
[2-3 paragraph synthesis covering: (1) Overall assessment across all dimensions, (2) Key strengths identified, (3) Critical areas requiring attention, (4) Recommended next steps.]`;
}

// ---------------------------------------------------------------------------
// Report Parser
// ---------------------------------------------------------------------------

/**
 * Parse structured data from a specialist's report text.
 */
export function parseSpecialistReport(
  text: string,
  role: SpecialistRole
): ParsedSpecialistReport {
  const criteriaScores: Array<{ criterion: string; score: number; notes: string }> = [];

  // Parse criteria scores from the markdown table
  for (const criterion of role.criteria) {
    const escapedCriterion = criterion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `\\|\\s*${escapedCriterion}\\s*\\|\\s*(\\d)\\s*\\|\\s*([^|]+)\\|`,
      "i"
    );
    const match = text.match(regex);
    if (match) {
      criteriaScores.push({
        criterion,
        score: parseInt(match[1], 10),
        notes: match[2].trim(),
      });
    }
  }

  // Parse top 3 recommendations
  const recsMatch = text.match(/### Top 3 Recommendations\s*\n([\s\S]*?)(?=###|$)/i);
  const topRecommendations: string[] = [];
  if (recsMatch) {
    const lines = recsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").trim();
      if (cleaned) topRecommendations.push(cleaned);
    }
  }

  // Parse key findings
  const findingsMatch = text.match(/### Key Findings\s*\n([\s\S]*?)(?=###|$)/i);
  const keyFindings: string[] = [];
  if (findingsMatch) {
    const lines = findingsMatch[1].trim().split("\n");
    for (const line of lines) {
      const cleaned = line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim();
      if (cleaned) keyFindings.push(cleaned);
    }
  }

  // Calculate average score
  const avgScore =
    criteriaScores.length > 0
      ? criteriaScores.reduce((sum, c) => sum + c.score, 0) / criteriaScores.length
      : 0;

  return {
    roleTitle: role.title,
    criteriaScores,
    topRecommendations: topRecommendations.slice(0, 3),
    keyFindings,
    averageScore: Math.round(avgScore * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Resolve a SpecialistAssignment to a SpecialistRole.
 */
function resolveRole(assignment: SpecialistAssignment): SpecialistRole {
  if (assignment.roleId === "custom" && assignment.customRole) {
    return buildCustomRole(assignment.customRole);
  }
  const role = getSpecialistRole(assignment.roleId);
  if (!role) {
    throw new Error(`Unknown specialist role: ${assignment.roleId}`);
  }
  return role;
}

/**
 * Run the full Specialist Panel pipeline.
 */
export async function runFullPanel(
  userInput: string,
  config: PanelConfig = DEFAULT_PANEL_CONFIG
): Promise<SpecialistPanelResult> {
  // Stage 1: Parallel specialist analysis
  const specialistResults = await Promise.allSettled(
    config.specialists.map(async (assignment) => {
      const role = resolveRole(assignment);
      const systemPrompt = buildSpecialistSystemPrompt(role);
      const userPrompt = buildSpecialistUserPrompt(userInput, role);
      const prompt = `${systemPrompt}\n\n${userPrompt}`;

      const result = await queryModel(assignment.model, prompt, config.timeoutMs);
      if (!result || !result.content.trim()) {
        throw new Error("Model failed to respond");
      }

      const parsed = parseSpecialistReport(result.content, role);

      return {
        roleId: assignment.roleId,
        roleTitle: role.title,
        model: assignment.model,
        report: result.content,
        criteriaScores: parsed.criteriaScores,
        topRecommendations: parsed.topRecommendations,
        keyFindings: parsed.keyFindings,
        averageScore: parsed.averageScore,
        responseTimeMs: result.responseTimeMs,
      } satisfies SpecialistReport;
    })
  );

  const specialists: SpecialistReport[] = [];
  const failedSpecialists: FailedSpecialist[] = [];

  specialistResults.forEach((result, i) => {
    const assignment = config.specialists[i];
    const role = resolveRole(assignment);
    if (result.status === "fulfilled") {
      specialists.push(result.value);
    } else {
      failedSpecialists.push({
        roleId: assignment.roleId,
        roleTitle: role.title,
        model: assignment.model,
        error: result.reason instanceof Error ? result.reason.message : "Unknown error",
      });
    }
  });

  if (specialists.length < 2) {
    throw new Error(
      `Specialist Panel requires at least 2 successful reports, got ${specialists.length}.`
    );
  }

  // Stage 2: Synthesis
  const synthesisPrompt = buildPanelSynthesisPrompt(
    userInput,
    specialists.map((s) => ({ roleTitle: s.roleTitle, model: s.model, report: s.report })),
    failedSpecialists.length > 0
      ? failedSpecialists.map((f) => f.roleTitle)
      : undefined
  );

  const synthesisResult = await queryModel(
    config.synthesizerModel,
    synthesisPrompt,
    config.timeoutMs
  );

  if (!synthesisResult || !synthesisResult.content.trim()) {
    throw new Error("Synthesizer model failed to respond.");
  }

  return {
    specialists,
    failedSpecialists,
    synthesis: {
      model: config.synthesizerModel,
      integratedAssessment: synthesisResult.content,
      responseTimeMs: synthesisResult.responseTimeMs,
    },
  };
}

// ---------------------------------------------------------------------------
// SSE Handler
// ---------------------------------------------------------------------------

export async function handleSpecialistPanelStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: PanelConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // Resolve all roles upfront
  const resolvedRoles = config.specialists.map((a) => resolveRole(a));

  emit({
    type: "panel_start",
    data: {
      conversationId,
      messageId,
      mode: "specialist_panel",
      roles: resolvedRoles.map((r) => r.title),
    },
  });

  // --- Stage 1: Parallel specialist analysis ---
  emit({
    type: "specialist_start",
    data: { totalSpecialists: config.specialists.length },
  });

  const specialists: SpecialistReport[] = [];
  const failedSpecialists: FailedSpecialist[] = [];

  const specialistResults = await Promise.allSettled(
    config.specialists.map(async (assignment, index) => {
      const role = resolvedRoles[index];
      const systemPrompt = buildSpecialistSystemPrompt(role);
      const userPrompt = buildSpecialistUserPrompt(question, role);
      const prompt = `${systemPrompt}\n\n${userPrompt}`;

      const result = await queryModel(assignment.model, prompt, config.timeoutMs);
      if (!result || !result.content.trim()) {
        throw new Error("Model failed to respond");
      }

      const parsed = parseSpecialistReport(result.content, role);

      const report: SpecialistReport = {
        roleId: assignment.roleId,
        roleTitle: role.title,
        model: assignment.model,
        report: result.content,
        criteriaScores: parsed.criteriaScores,
        topRecommendations: parsed.topRecommendations,
        keyFindings: parsed.keyFindings,
        averageScore: parsed.averageScore,
        responseTimeMs: result.responseTimeMs,
      };

      // Emit individual completion
      emit({
        type: "specialist_complete",
        data: {
          roleId: assignment.roleId,
          roleTitle: role.title,
          model: assignment.model,
          report: result.content,
          criteriaScores: parsed.criteriaScores,
          topRecommendations: parsed.topRecommendations,
          keyFindings: parsed.keyFindings,
          responseTimeMs: result.responseTimeMs,
          index,
          totalSpecialists: config.specialists.length,
        },
      });

      return report;
    })
  );

  specialistResults.forEach((result, i) => {
    const assignment = config.specialists[i];
    const role = resolvedRoles[i];
    if (result.status === "fulfilled") {
      specialists.push(result.value);

      stages.push({
        stageType: `specialist_${role.id}`,
        stageOrder: 1,
        model: assignment.model,
        role: assignment.roleId,
        content: result.value.report,
        parsedData: {
          roleId: assignment.roleId,
          roleTitle: role.title,
          criteriaScores: result.value.criteriaScores,
          topRecommendations: result.value.topRecommendations,
          keyFindings: result.value.keyFindings,
          averageScore: result.value.averageScore,
          responseTimeMs: result.value.responseTimeMs,
        },
        responseTimeMs: result.value.responseTimeMs,
      });
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : "Unknown error";
      failedSpecialists.push({
        roleId: assignment.roleId,
        roleTitle: role.title,
        model: assignment.model,
        error: errMsg,
      });
    }
  });

  emit({
    type: "all_specialists_complete",
    data: {
      specialists: specialists.map((s) => ({
        roleId: s.roleId,
        roleTitle: s.roleTitle,
        model: s.model,
        report: s.report,
        criteriaScores: s.criteriaScores,
        topRecommendations: s.topRecommendations,
        responseTimeMs: s.responseTimeMs,
      })),
      failedSpecialists,
      totalSucceeded: specialists.length,
      totalFailed: failedSpecialists.length,
    },
  });

  if (specialists.length < 2) {
    emit({
      type: "error",
      message: `Specialist Panel requires at least 2 successful reports, got ${specialists.length}.`,
    });
    return stages;
  }

  // --- Stage 2: Synthesis ---
  emit({ type: "synthesis_start" });

  const synthesisPrompt = buildPanelSynthesisPrompt(
    question,
    specialists.map((s) => ({ roleTitle: s.roleTitle, model: s.model, report: s.report })),
    failedSpecialists.length > 0
      ? failedSpecialists.map((f) => f.roleTitle)
      : undefined
  );

  const synthesisResult = await queryModel(
    config.synthesizerModel,
    synthesisPrompt,
    config.timeoutMs
  );

  if (!synthesisResult || !synthesisResult.content.trim()) {
    emit({
      type: "error",
      message: "Synthesizer model failed to respond.",
    });
    return stages;
  }

  emit({
    type: "synthesis_complete",
    data: {
      model: config.synthesizerModel,
      integratedAssessment: synthesisResult.content,
      responseTimeMs: synthesisResult.responseTimeMs,
    },
  });

  stages.push({
    stageType: "synthesis",
    stageOrder: 2,
    model: config.synthesizerModel,
    role: "synthesizer",
    content: synthesisResult.content,
    parsedData: {
      specialistCount: specialists.length,
      failedCount: failedSpecialists.length,
      responseTimeMs: synthesisResult.responseTimeMs,
    },
    responseTimeMs: synthesisResult.responseTimeMs,
  });

  // Note: title generation and "complete" event handled by the route dispatcher.
  return stages;
}
