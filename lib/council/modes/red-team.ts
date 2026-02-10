/**
 * Red Team Mode — Adversarial analysis with structured attack/defend cycles.
 *
 * Pipeline: A generator structures content, an attacker finds vulnerabilities
 * with severity ratings, the generator defends each finding (ACCEPT/REBUT),
 * and a synthesizer produces a hardened output with an audit summary.
 * Multiple attack/defend rounds iterate to harden the content.
 *
 * See docs/modes/06-red-team.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type Verdict = "ACCEPT" | "REBUT";

export interface RedTeamConfig {
  generatorModel: string;
  attackerModel: string;
  synthesizerModel: string;
  rounds: number;
  timeoutMs: number;
  maxInputLength: number;
}

export const DEFAULT_RED_TEAM_CONFIG: RedTeamConfig = {
  generatorModel: "anthropic/claude-opus-4-6",
  attackerModel: "openai/o3",
  synthesizerModel: "anthropic/claude-opus-4-6",
  rounds: 2,
  timeoutMs: 120_000,
  maxInputLength: 25_000,
};

export interface Finding {
  title: string;
  severity: Severity;
  location: string;
  vulnerability: string;
  exploitScenario: string;
}

export interface AttackSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  overallRisk: string;
}

export interface DefenseResponse {
  findingTitle: string;
  verdict: Verdict;
  reasoning: string;
  revision: string | null;
}

export interface GenerateResponse {
  model: string;
  structuredContent: string;
  responseTimeMs: number;
}

export interface AttackResult {
  model: string;
  round: number;
  findings: Finding[];
  summary: AttackSummary;
  noFlaws: boolean;
  responseTimeMs: number;
  parseSuccess: boolean;
}

export interface DefenseResult {
  model: string;
  round: number;
  responses: DefenseResponse[];
  accepted: number;
  rebutted: number;
  revisedContent: string;
  responseTimeMs: number;
  parseSuccess: boolean;
}

export interface SynthesisResponse {
  model: string;
  hardenedOutput: string;
  auditSummary: string;
  responseTimeMs: number;
}

export interface RedTeamRound {
  roundNumber: number;
  attack: AttackResult;
  defense: DefenseResult | null;
}

export interface RedTeamResult {
  generate: GenerateResponse;
  rounds: RedTeamRound[];
  synthesis: SynthesisResponse;
  totalFindings: number;
  totalAccepted: number;
  totalRebutted: number;
  severityCounts: AttackSummary;
  title?: string;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse severity level from text. Case-insensitive, strips bold markers.
 * Defaults to MEDIUM on unknown input.
 */
export function parseSeverity(text: string): Severity {
  if (!text) return "MEDIUM";
  const cleaned = text.replace(/\*\*/g, "").toUpperCase().trim();
  if (cleaned.includes("CRITICAL")) return "CRITICAL";
  if (cleaned.includes("HIGH")) return "HIGH";
  if (cleaned.includes("LOW")) return "LOW";
  if (cleaned.includes("MEDIUM")) return "MEDIUM";
  return "MEDIUM";
}

/**
 * Parse verdict from text. Case-insensitive, strips bold markers.
 * Defaults to REBUT (conservative — don't auto-accept unclear findings).
 */
export function parseVerdict(text: string): Verdict {
  if (!text) return "REBUT";
  const cleaned = text.replace(/\*\*/g, "").toUpperCase().trim();
  if (cleaned.includes("ACCEPT")) return "ACCEPT";
  if (cleaned.includes("REBUT")) return "REBUT";
  return "REBUT";
}

/**
 * Parse an attack report into structured findings and summary.
 *
 * Expected format:
 *   FINDING 1: [Title]
 *   Severity: [CRITICAL|HIGH|MEDIUM|LOW]
 *   Location: [reference]
 *   Vulnerability: [description]
 *   Exploit Scenario: [how this fails]
 *
 *   SUMMARY:
 *   - Critical: N, High: N, Medium: N, Low: N
 *   - Overall risk: [assessment]
 */
export function parseAttackReport(text: string): {
  findings: Finding[];
  summary: AttackSummary;
} {
  if (!text || !text.trim()) {
    return {
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, overallRisk: "NONE" },
    };
  }

  const findings: Finding[] = [];

  // Split by FINDING boundaries
  const findingBlocks = text.split(/FINDING\s+\d+:\s*/i).filter((b) => b.trim());

  for (const block of findingBlocks) {
    // Skip blocks that are clearly the header or summary only
    if (!block.match(/severity|vulnerability|location/i)) continue;

    const lines = block.trim();

    // Extract title (first line before any field)
    const titleMatch = lines.match(/^([^\n]+)/);
    const title = titleMatch ? titleMatch[1].replace(/\*\*/g, "").trim() : "Untitled Finding";

    // Extract severity
    const severityMatch = lines.match(/Severity:\s*([^\n]+)/i);
    const severity = severityMatch ? parseSeverity(severityMatch[1]) : "MEDIUM";

    // Extract location
    const locationMatch = lines.match(/Location:\s*([^\n]+)/i);
    const location = locationMatch ? locationMatch[1].trim() : "Not specified";

    // Extract vulnerability (may span multiple lines until next field)
    const vulnerabilityMatch = lines.match(
      /Vulnerability:\s*([\s\S]*?)(?=\n(?:Exploit Scenario|Location|Severity|FINDING|SUMMARY):|$)/i
    );
    const vulnerability = vulnerabilityMatch
      ? vulnerabilityMatch[1].trim()
      : "Not specified";

    // Extract exploit scenario (may span multiple lines until next field)
    const exploitMatch = lines.match(
      /Exploit Scenario:\s*([\s\S]*?)(?=\n(?:FINDING|SUMMARY|Location|Severity|Vulnerability):|$)/i
    );
    const exploitScenario = exploitMatch
      ? exploitMatch[1].trim()
      : "Not specified";

    findings.push({ title, severity, location, vulnerability, exploitScenario });
  }

  // Parse SUMMARY section
  let summary: AttackSummary;
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)$/i);

  if (summaryMatch) {
    const summaryText = summaryMatch[1];
    const criticalMatch = summaryText.match(/Critical:\s*(\d+)/i);
    const highMatch = summaryText.match(/High:\s*(\d+)/i);
    const mediumMatch = summaryText.match(/Medium:\s*(\d+)/i);
    const lowMatch = summaryText.match(/Low:\s*(\d+)/i);
    const riskMatch = summaryText.match(/Overall\s*risk:\s*([^\n]+)/i);

    summary = {
      critical: criticalMatch ? parseInt(criticalMatch[1], 10) : 0,
      high: highMatch ? parseInt(highMatch[1], 10) : 0,
      medium: mediumMatch ? parseInt(mediumMatch[1], 10) : 0,
      low: lowMatch ? parseInt(lowMatch[1], 10) : 0,
      overallRisk: riskMatch ? riskMatch[1].trim() : "Not assessed",
    };
  } else {
    // Fallback: compute summary from findings
    summary = {
      critical: findings.filter((f) => f.severity === "CRITICAL").length,
      high: findings.filter((f) => f.severity === "HIGH").length,
      medium: findings.filter((f) => f.severity === "MEDIUM").length,
      low: findings.filter((f) => f.severity === "LOW").length,
      overallRisk: findings.length === 0 ? "NONE" : "Computed from findings",
    };
  }

  return { findings, summary };
}

/**
 * Parse a defense report into structured responses, counts, and revised content.
 *
 * Expected format:
 *   RESPONSE TO FINDING 1: [Title]
 *   Verdict: [ACCEPT|REBUT]
 *   Reasoning: [explanation]
 *   Revision: [if ACCEPT, specific change. If REBUT, write "N/A"]
 *
 *   ---
 *   REVISED CONTENT:
 *   [full revised content]
 */
export function parseDefenseReport(text: string): {
  responses: DefenseResponse[];
  accepted: number;
  rebutted: number;
  revisedContent: string;
} {
  if (!text || !text.trim()) {
    return { responses: [], accepted: 0, rebutted: 0, revisedContent: "" };
  }

  const responses: DefenseResponse[] = [];

  // Split by RESPONSE TO FINDING boundaries
  const responseBlocks = text
    .split(/RESPONSE TO FINDING\s+\d+:\s*/i)
    .filter((b) => b.trim());

  for (const block of responseBlocks) {
    // Skip blocks that don't look like a defense response
    if (!block.match(/verdict|reasoning/i)) continue;

    const lines = block.trim();

    // Extract finding title (first line)
    const titleMatch = lines.match(/^([^\n]+)/);
    const findingTitle = titleMatch
      ? titleMatch[1].replace(/\*\*/g, "").trim()
      : "Unknown Finding";

    // Extract verdict
    const verdictMatch = lines.match(/Verdict:\s*([^\n]+)/i);
    const verdict = verdictMatch ? parseVerdict(verdictMatch[1]) : "REBUT";

    // Extract reasoning (may span multiple lines)
    const reasoningMatch = lines.match(
      /Reasoning:\s*([\s\S]*?)(?=\n(?:Revision|Verdict|RESPONSE TO FINDING|DEFENSE SUMMARY):|$)/i
    );
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "";

    // Extract revision
    const revisionMatch = lines.match(
      /Revision:\s*([\s\S]*?)(?=\n(?:RESPONSE TO FINDING|DEFENSE SUMMARY)|\s*$)/i
    );
    let revision: string | null = null;
    if (revisionMatch) {
      const revText = revisionMatch[1].trim();
      if (revText.toUpperCase() !== "N/A" && revText !== "-" && revText !== "") {
        revision = revText;
      }
    }

    responses.push({ findingTitle, verdict, reasoning, revision });
  }

  // Count from parsed responses (not from DEFENSE SUMMARY text)
  const accepted = responses.filter((r) => r.verdict === "ACCEPT").length;
  const rebutted = responses.filter((r) => r.verdict === "REBUT").length;

  // Extract REVISED CONTENT section
  let revisedContent = "";
  const revisedMatch = text.match(/---\s*\nREVISED CONTENT:\s*\n([\s\S]+)$/i);
  if (revisedMatch) {
    revisedContent = revisedMatch[1].trim();
  } else {
    // Fallback: look for REVISED CONTENT: without the --- separator
    const fallbackMatch = text.match(/REVISED CONTENT:\s*\n([\s\S]+)$/i);
    if (fallbackMatch) {
      revisedContent = fallbackMatch[1].trim();
    }
  }

  return { responses, accepted, rebutted, revisedContent };
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the generator prompt to structure content for adversarial review.
 */
export function buildGeneratePrompt(userInput: string): string {
  return `You are preparing content for adversarial review. Present the following content in a clear, structured format that can be systematically analyzed for weaknesses.

USER INPUT:
${userInput}

Present this content in a well-organized format. If it is code, include the full code with clear section markers. If it is an architecture or argument, structure it with numbered sections. Do not add or remove substance — faithfully represent the user's input in an analyzable form.`;
}

/**
 * Build the attack prompt for Round 1.
 */
export function buildAttackRound1Prompt(content: string): string {
  return `You are a ruthless red team adversary. Your job is to find every weakness, vulnerability, flaw, gap, and failure mode in the following content. Do NOT be polite. Be direct and devastating.

CONTENT UNDER REVIEW:
${content}

For EACH finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Location: [specific section or line]
- Vulnerability: [description]
- Exploit Scenario: [concrete failure case]

Format:
ATTACK REPORT — ROUND 1

FINDING 1: [Title]
Severity: [CRITICAL|HIGH|MEDIUM|LOW]
Location: [reference]
Vulnerability: [description]
Exploit Scenario: [how this fails]

FINDING 2: [Title]
...

SUMMARY:
- Critical: [count], High: [count], Medium: [count], Low: [count]
- Overall risk: [assessment]`;
}

/**
 * Build the attack prompt for Round 2+.
 */
export function buildAttackRoundNPrompt(
  revisedContent: string,
  previousDefense: string,
  roundNumber: number
): string {
  return `You are a ruthless red team adversary. Your job is to find every weakness, vulnerability, flaw, gap, and failure mode in the following content. Do NOT be polite. Be direct and devastating.

CONTENT UNDER REVIEW (REVISED):
${revisedContent}

The author previously defended against these attacks:
${previousDefense}

Find NEW weaknesses they missed, or demonstrate why their defenses are insufficient. Do not repeat findings that were adequately addressed.

For EACH finding:
- Severity: CRITICAL / HIGH / MEDIUM / LOW
- Location: [specific section or line]
- Vulnerability: [description]
- Exploit Scenario: [concrete failure case]

Format:
ATTACK REPORT — ROUND ${roundNumber}

FINDING 1: [Title]
Severity: [CRITICAL|HIGH|MEDIUM|LOW]
Location: [reference]
Vulnerability: [description]
Exploit Scenario: [how this fails]

...

SUMMARY:
- Critical: [count], High: [count], Medium: [count], Low: [count]
- Overall risk: [assessment]
- Delta from previous round: [improved/worsened/unchanged]`;
}

/**
 * Build the defense prompt for any round.
 */
export function buildDefensePrompt(
  originalContent: string,
  attackReport: string,
  roundNumber: number
): string {
  return `You are defending your work against a red team attack. Address EVERY finding honestly. Do not dismiss valid concerns. Do not accept invalid ones.

ORIGINAL CONTENT:
${originalContent}

ATTACK REPORT:
${attackReport}

For EACH finding: ACCEPT (genuine flaw — provide revision) or REBUT (invalid — explain why with evidence).

Format:
DEFENSE REPORT — ROUND ${roundNumber}

RESPONSE TO FINDING 1: [Title]
Verdict: [ACCEPT|REBUT]
Reasoning: [explanation]
Revision: [if ACCEPT, specific change. If REBUT, write "N/A"]

RESPONSE TO FINDING 2: [Title]
...

DEFENSE SUMMARY:
- Accepted: [count], Rebutted: [count]

---
REVISED CONTENT:
[full revised content incorporating all accepted fixes]`;
}

/**
 * Build the synthesis prompt for hardened output.
 */
export function buildSynthesisPrompt(
  originalContent: string,
  rounds: RedTeamRound[],
  totalRounds: number
): string {
  const roundsText = rounds
    .map((r) => {
      let text = `--- ROUND ${r.roundNumber} ---\nATTACK REPORT:\n`;
      text += r.attack.findings
        .map(
          (f, i) =>
            `FINDING ${i + 1}: ${f.title}\nSeverity: ${f.severity}\nLocation: ${f.location}\nVulnerability: ${f.vulnerability}\nExploit Scenario: ${f.exploitScenario}`
        )
        .join("\n\n");

      if (r.defense) {
        text += `\n\nDEFENSE REPORT:\n`;
        text += r.defense.responses
          .map(
            (d) =>
              `RESPONSE TO ${d.findingTitle}:\nVerdict: ${d.verdict}\nReasoning: ${d.reasoning}${d.revision ? `\nRevision: ${d.revision}` : ""}`
          )
          .join("\n\n");
      }

      return text;
    })
    .join("\n\n");

  // Aggregate all findings for the audit table
  const allFindings: Array<{
    title: string;
    severity: Severity;
    verdict: string;
    round: number;
  }> = [];

  for (const round of rounds) {
    for (const finding of round.attack.findings) {
      const defense = round.defense?.responses.find(
        (d) => d.findingTitle === finding.title
      );
      allFindings.push({
        title: finding.title,
        severity: finding.severity,
        verdict: defense ? defense.verdict : "UNADDRESSED",
        round: round.roundNumber,
      });
    }
  }

  const totalFindings = allFindings.length;
  const totalAccepted = allFindings.filter((f) => f.verdict === "ACCEPT").length;
  const totalRebutted = allFindings.filter((f) => f.verdict === "REBUT").length;

  const severityCounts = {
    critical: allFindings.filter((f) => f.severity === "CRITICAL").length,
    high: allFindings.filter((f) => f.severity === "HIGH").length,
    medium: allFindings.filter((f) => f.severity === "MEDIUM").length,
    low: allFindings.filter((f) => f.severity === "LOW").length,
  };

  const findingsTable = allFindings
    .map(
      (f, i) =>
        `| ${i + 1} | ${f.title} | ${f.severity} | ${f.verdict} | Round ${f.round} |`
    )
    .join("\n");

  return `You are a security-minded synthesizer producing the final hardened version of content that has undergone ${totalRounds} round(s) of adversarial review.

ORIGINAL CONTENT:
${originalContent}

${roundsText}

Produce:

## Hardened Output
[The final, hardened version of the content. Integrate all accepted fixes. Where rebuttals were valid, preserve the original. Where the defense was weak, apply your own judgment to strengthen.]

## Vulnerability Audit Summary

| # | Finding | Severity | Verdict | Status |
|---|---------|----------|---------|--------|
${findingsTable}

| Metric | Value |
|--------|-------|
| Total Findings | ${totalFindings} |
| Critical | ${severityCounts.critical} |
| High | ${severityCounts.high} |
| Medium | ${severityCounts.medium} |
| Low | ${severityCounts.low} |
| Accepted | ${totalAccepted} |
| Rebutted | ${totalRebutted} |
| Rounds Completed | ${totalRounds} |
| Remaining Risks | [list any unresolved or partially addressed risks] |
| Hardening Confidence | [High/Medium/Low — based on severity of remaining risks] |`;
}

// ---------------------------------------------------------------------------
// Full Pipeline (non-streaming, for testing)
// ---------------------------------------------------------------------------

/**
 * Run the full Red Team pipeline and return the result.
 */
export async function runFullRedTeam(
  question: string,
  config: RedTeamConfig = DEFAULT_RED_TEAM_CONFIG
): Promise<RedTeamResult> {
  // Truncate input if necessary
  let input = question;
  if (input.length > config.maxInputLength) {
    input =
      input.slice(0, config.maxInputLength) +
      `\n\n[Content truncated to ${config.maxInputLength} characters for review]`;
  }

  // Stage 1: Generate
  const generateResult = await queryModel(
    config.generatorModel,
    buildGeneratePrompt(input),
    config.timeoutMs
  );

  const generate: GenerateResponse = {
    model: config.generatorModel,
    structuredContent: generateResult?.content ?? input,
    responseTimeMs: generateResult?.responseTimeMs ?? 0,
  };

  let currentContent = generate.structuredContent;
  const rounds: RedTeamRound[] = [];

  // Attack/Defend rounds
  for (let roundNum = 1; roundNum <= config.rounds; roundNum++) {
    // Attack
    const attackPrompt =
      roundNum === 1
        ? buildAttackRound1Prompt(currentContent)
        : buildAttackRoundNPrompt(
            currentContent,
            rounds[rounds.length - 1].defense
              ? buildDefenseSummaryText(rounds[rounds.length - 1].defense!)
              : "",
            roundNum
          );

    const attackQueryResult = await queryModel(
      config.attackerModel,
      attackPrompt,
      config.timeoutMs
    );

    if (!attackQueryResult) {
      // Attacker failed — skip round
      break;
    }

    const { findings, summary } = parseAttackReport(attackQueryResult.content);

    const attack: AttackResult = {
      model: config.attackerModel,
      round: roundNum,
      findings,
      summary,
      noFlaws: findings.length === 0,
      responseTimeMs: attackQueryResult.responseTimeMs,
      parseSuccess: true,
    };

    // Zero findings — skip defense and remaining rounds
    if (findings.length === 0) {
      rounds.push({ roundNumber: roundNum, attack, defense: null });
      break;
    }

    // Defend
    const defenseQueryResult = await queryModel(
      config.generatorModel,
      buildDefensePrompt(currentContent, attackQueryResult.content, roundNum),
      config.timeoutMs
    );

    let defense: DefenseResult | null = null;
    if (defenseQueryResult) {
      const parsed = parseDefenseReport(defenseQueryResult.content);
      defense = {
        model: config.generatorModel,
        round: roundNum,
        responses: parsed.responses,
        accepted: parsed.accepted,
        rebutted: parsed.rebutted,
        revisedContent: parsed.revisedContent,
        responseTimeMs: defenseQueryResult.responseTimeMs,
        parseSuccess: true,
      };

      // Update current content for next round
      if (parsed.revisedContent) {
        currentContent = parsed.revisedContent;
      }
    }

    rounds.push({ roundNumber: roundNum, attack, defense });
  }

  // Synthesize
  const synthesisQueryResult = await queryModel(
    config.synthesizerModel,
    buildSynthesisPrompt(generate.structuredContent, rounds, rounds.length),
    config.timeoutMs
  );

  if (!synthesisQueryResult) {
    throw new Error("Synthesizer model failed to produce hardened output.");
  }

  const synthesis: SynthesisResponse = {
    model: config.synthesizerModel,
    hardenedOutput: synthesisQueryResult.content,
    auditSummary: extractAuditSummary(synthesisQueryResult.content),
    responseTimeMs: synthesisQueryResult.responseTimeMs,
  };

  // Aggregate counts
  const { totalFindings, totalAccepted, totalRebutted, severityCounts } =
    aggregateStats(rounds);

  return {
    generate,
    rounds,
    synthesis,
    totalFindings,
    totalAccepted,
    totalRebutted,
    severityCounts,
  };
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Red Team pipeline, emitting SSE events via the controller.
 * Returns stage data for persistence to deliberation_stages.
 */
export async function handleRedTeamStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: RedTeamConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // Truncate input if necessary
  let input = question;
  if (input.length > config.maxInputLength) {
    input =
      input.slice(0, config.maxInputLength) +
      `\n\n[Content truncated to ${config.maxInputLength} characters for review]`;
  }

  // --- Emit start ---
  emit({
    type: "redteam_start",
    data: {
      conversationId,
      messageId,
      mode: "red_team",
      totalRounds: config.rounds,
    },
  });

  // --- Stage 1: Generate ---
  emit({ type: "generate_start" });

  const generateResult = await queryModel(
    config.generatorModel,
    buildGeneratePrompt(input),
    config.timeoutMs
  );

  const generate: GenerateResponse = {
    model: config.generatorModel,
    structuredContent: generateResult?.content ?? input,
    responseTimeMs: generateResult?.responseTimeMs ?? 0,
  };

  emit({ type: "generate_complete", data: generate });

  stages.push({
    stageType: "generate",
    stageOrder: 0,
    model: config.generatorModel,
    role: "generator",
    content: generate.structuredContent,
    parsedData: {
      inputLength: input.length,
      outputLength: generate.structuredContent.length,
    },
    responseTimeMs: generate.responseTimeMs,
  });

  let currentContent = generate.structuredContent;
  const rounds: RedTeamRound[] = [];

  // --- Attack/Defend rounds ---
  for (let roundNum = 1; roundNum <= config.rounds; roundNum++) {
    // Attack
    emit({ type: "attack_start", data: { round: roundNum } });

    const attackPrompt =
      roundNum === 1
        ? buildAttackRound1Prompt(currentContent)
        : buildAttackRoundNPrompt(
            currentContent,
            rounds[rounds.length - 1].defense
              ? buildDefenseSummaryText(rounds[rounds.length - 1].defense!)
              : "",
            roundNum
          );

    const attackQueryResult = await queryModel(
      config.attackerModel,
      attackPrompt,
      config.timeoutMs
    );

    if (!attackQueryResult) {
      // Attacker failed — skip round
      const failAttack: AttackResult = {
        model: config.attackerModel,
        round: roundNum,
        findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0, overallRisk: "Attack failed" },
        noFlaws: false,
        responseTimeMs: 0,
        parseSuccess: false,
      };

      emit({
        type: "attack_complete",
        data: { round: roundNum, data: failAttack },
      });

      stages.push({
        stageType: `attack_round_${roundNum}`,
        stageOrder: (roundNum - 1) * 2 + 1,
        model: config.attackerModel,
        role: "attacker",
        content: "(attacker model failed)",
        parsedData: { round: roundNum, error: true },
        responseTimeMs: 0,
      });

      break;
    }

    const { findings, summary } = parseAttackReport(attackQueryResult.content);

    const attack: AttackResult = {
      model: config.attackerModel,
      round: roundNum,
      findings,
      summary,
      noFlaws: findings.length === 0,
      responseTimeMs: attackQueryResult.responseTimeMs,
      parseSuccess: true,
    };

    emit({
      type: "attack_complete",
      data: { round: roundNum, data: attack },
    });

    stages.push({
      stageType: `attack_round_${roundNum}`,
      stageOrder: (roundNum - 1) * 2 + 1,
      model: config.attackerModel,
      role: "attacker",
      content: attackQueryResult.content,
      parsedData: {
        round: roundNum,
        findings,
        summary,
      },
      responseTimeMs: attackQueryResult.responseTimeMs,
    });

    // Zero findings — skip defense and remaining rounds
    if (findings.length === 0) {
      rounds.push({ roundNumber: roundNum, attack, defense: null });
      break;
    }

    // Defend
    emit({ type: "defend_start", data: { round: roundNum } });

    const defenseQueryResult = await queryModel(
      config.generatorModel,
      buildDefensePrompt(currentContent, attackQueryResult.content, roundNum),
      config.timeoutMs
    );

    let defense: DefenseResult | null = null;

    if (defenseQueryResult) {
      const parsed = parseDefenseReport(defenseQueryResult.content);
      defense = {
        model: config.generatorModel,
        round: roundNum,
        responses: parsed.responses,
        accepted: parsed.accepted,
        rebutted: parsed.rebutted,
        revisedContent: parsed.revisedContent,
        responseTimeMs: defenseQueryResult.responseTimeMs,
        parseSuccess: true,
      };

      emit({
        type: "defend_complete",
        data: { round: roundNum, data: defense },
      });

      stages.push({
        stageType: `defend_round_${roundNum}`,
        stageOrder: (roundNum - 1) * 2 + 2,
        model: config.generatorModel,
        role: "defender",
        content: defenseQueryResult.content,
        parsedData: {
          round: roundNum,
          responses: parsed.responses,
          accepted: parsed.accepted,
          rebutted: parsed.rebutted,
          revisedContentLength: parsed.revisedContent.length,
        },
        responseTimeMs: defenseQueryResult.responseTimeMs,
      });

      // Update current content for next round
      if (parsed.revisedContent) {
        currentContent = parsed.revisedContent;
      }
    } else {
      // Defender failed — carry forward unrevised
      defense = {
        model: config.generatorModel,
        round: roundNum,
        responses: [],
        accepted: 0,
        rebutted: 0,
        revisedContent: currentContent,
        responseTimeMs: 0,
        parseSuccess: false,
      };

      emit({
        type: "defend_complete",
        data: { round: roundNum, data: defense },
      });

      stages.push({
        stageType: `defend_round_${roundNum}`,
        stageOrder: (roundNum - 1) * 2 + 2,
        model: config.generatorModel,
        role: "defender",
        content: "(defender model failed — content carried forward unrevised)",
        parsedData: { round: roundNum, error: true },
        responseTimeMs: 0,
      });
    }

    rounds.push({ roundNumber: roundNum, attack, defense });
  }

  // --- Synthesize ---
  emit({ type: "synthesize_start" });

  const synthesisQueryResult = await queryModel(
    config.synthesizerModel,
    buildSynthesisPrompt(generate.structuredContent, rounds, rounds.length),
    config.timeoutMs
  );

  if (!synthesisQueryResult) {
    emit({ type: "error", message: "Synthesizer model failed to produce hardened output." });

    // Still save partial results
    const { totalFindings, totalAccepted, totalRebutted, severityCounts } =
      aggregateStats(rounds);

    stages.push({
      stageType: "synthesis",
      stageOrder: 99,
      model: config.synthesizerModel,
      role: "synthesizer",
      content: "(synthesizer failed)",
      parsedData: {
        error: true,
        totalRounds: rounds.length,
        totalFindings,
        totalAccepted,
        totalRebutted,
        severityCounts,
      },
      responseTimeMs: 0,
    });

    return stages;
  }

  const synthesis: SynthesisResponse = {
    model: config.synthesizerModel,
    hardenedOutput: synthesisQueryResult.content,
    auditSummary: extractAuditSummary(synthesisQueryResult.content),
    responseTimeMs: synthesisQueryResult.responseTimeMs,
  };

  emit({ type: "synthesize_complete", data: synthesis });

  const { totalFindings, totalAccepted, totalRebutted, severityCounts } =
    aggregateStats(rounds);

  stages.push({
    stageType: "synthesis",
    stageOrder: 99,
    model: config.synthesizerModel,
    role: "synthesizer",
    content: synthesisQueryResult.content,
    parsedData: {
      totalRounds: rounds.length,
      totalFindings,
      totalAccepted,
      totalRebutted,
      severityCounts,
      hardeningConfidence: "Medium",
    },
    responseTimeMs: synthesisQueryResult.responseTimeMs,
  });

  return stages;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a text summary of a defense result for including in subsequent attack prompts.
 */
function buildDefenseSummaryText(defense: DefenseResult): string {
  return defense.responses
    .map(
      (r) =>
        `Finding: ${r.findingTitle}\nVerdict: ${r.verdict}\nReasoning: ${r.reasoning}${r.revision ? `\nRevision: ${r.revision}` : ""}`
    )
    .join("\n\n");
}

/**
 * Extract the audit summary section from synthesis output.
 */
function extractAuditSummary(synthesisText: string): string {
  const match = synthesisText.match(
    /## Vulnerability Audit Summary\s*([\s\S]*?)$/i
  );
  return match ? match[1].trim() : "";
}

/**
 * Aggregate findings and severity counts across all rounds.
 */
function aggregateStats(rounds: RedTeamRound[]): {
  totalFindings: number;
  totalAccepted: number;
  totalRebutted: number;
  severityCounts: AttackSummary;
} {
  let totalFindings = 0;
  let totalAccepted = 0;
  let totalRebutted = 0;
  const severityCounts: AttackSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    overallRisk: "",
  };

  for (const round of rounds) {
    totalFindings += round.attack.findings.length;

    for (const finding of round.attack.findings) {
      switch (finding.severity) {
        case "CRITICAL":
          severityCounts.critical++;
          break;
        case "HIGH":
          severityCounts.high++;
          break;
        case "MEDIUM":
          severityCounts.medium++;
          break;
        case "LOW":
          severityCounts.low++;
          break;
      }
    }

    if (round.defense) {
      totalAccepted += round.defense.accepted;
      totalRebutted += round.defense.rebutted;
    }
  }

  // Determine overall risk from highest severity
  if (severityCounts.critical > 0) {
    severityCounts.overallRisk = "CRITICAL";
  } else if (severityCounts.high > 0) {
    severityCounts.overallRisk = "HIGH";
  } else if (severityCounts.medium > 0) {
    severityCounts.overallRisk = "MEDIUM";
  } else if (severityCounts.low > 0) {
    severityCounts.overallRisk = "LOW";
  } else {
    severityCounts.overallRisk = "NONE";
  }

  return { totalFindings, totalAccepted, totalRebutted, severityCounts };
}
