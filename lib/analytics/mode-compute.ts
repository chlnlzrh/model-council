/**
 * Mode-specific analytics compute functions.
 *
 * Each function takes filtered RawDeliberationStageRow[] and extracts
 * structured metrics from the parsedData JSONB field.
 * All functions are pure and stateless.
 */

import { getModelDisplayName } from "@/lib/council/model-colors";
import type {
  RawDeliberationStageRow,
  ModeMetrics,
  VoteMetrics,
  JuryMetrics,
  DebateMetrics,
  TournamentMetrics,
  DelphiMetrics,
  ConfidenceMetrics,
  RedTeamMetrics,
  ChainMetrics,
  SpecialistPanelMetrics,
  BlueprintMetrics,
  PeerReviewMetrics,
  DecomposeMetrics,
  BrainstormMetrics,
  FactCheckMetrics,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filterByStageType(
  stages: RawDeliberationStageRow[],
  ...types: string[]
): RawDeliberationStageRow[] {
  return stages.filter((s) => types.includes(s.stageType));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

function safeNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export function computeVoteMetrics(
  stages: RawDeliberationStageRow[]
): VoteMetrics {
  const winners = filterByStageType(stages, "winner");
  const tallies = filterByStageType(stages, "vote_tally");

  const winnerCounts = new Map<string, number>();
  let tiebreakerCount = 0;
  let totalMargin = 0;
  let marginCount = 0;

  for (const s of winners) {
    if (!isRecord(s.parsedData)) continue;
    const model = safeString(s.parsedData.winner ?? s.model);
    if (model) {
      winnerCounts.set(model, (winnerCounts.get(model) ?? 0) + 1);
    }
    if (s.parsedData.tiebreaker === true) tiebreakerCount++;
  }

  for (const s of tallies) {
    if (!isRecord(s.parsedData)) continue;
    const margin = safeNumber(s.parsedData.winMargin);
    if (margin > 0) {
      totalMargin += margin;
      marginCount++;
    }
  }

  const winnerDistribution = [...winnerCounts.entries()]
    .map(([model, wins]) => ({
      model,
      displayName: getModelDisplayName(model),
      wins,
    }))
    .sort((a, b) => b.wins - a.wins);

  const totalWinners = winners.length;

  return {
    kind: "vote",
    winnerDistribution,
    tiebreakerRate: totalWinners > 0 ? tiebreakerCount / totalWinners : 0,
    avgWinMargin: marginCount > 0 ? totalMargin / marginCount : 0,
  };
}

// ---------------------------------------------------------------------------
// Jury
// ---------------------------------------------------------------------------

export function computeJuryMetrics(
  stages: RawDeliberationStageRow[]
): JuryMetrics {
  const verdicts = filterByStageType(stages, "verdict");
  const jurorSummaries = filterByStageType(stages, "juror_summary");
  const deliberations = filterByStageType(stages, "deliberation");

  const verdictCounts = new Map<string, number>();
  for (const s of verdicts) {
    if (!isRecord(s.parsedData)) continue;
    const verdict = safeString(s.parsedData.verdict, "unknown");
    verdictCounts.set(verdict, (verdictCounts.get(verdict) ?? 0) + 1);
  }

  const dimensionSums = new Map<string, { sum: number; count: number }>();
  for (const s of [...jurorSummaries, ...deliberations]) {
    if (!isRecord(s.parsedData)) continue;
    const scores = s.parsedData.scores ?? s.parsedData.dimensions;
    if (!isRecord(scores)) continue;
    for (const [dim, val] of Object.entries(scores)) {
      const numVal = safeNumber(val);
      if (numVal <= 0) continue;
      const existing = dimensionSums.get(dim) ?? { sum: 0, count: 0 };
      existing.sum += numVal;
      existing.count++;
      dimensionSums.set(dim, existing);
    }
  }

  // Consensus: how often jurors agree on verdict direction
  let consensusCount = 0;
  let totalComparisons = 0;
  const messageGroups = new Map<string, string[]>();
  for (const s of jurorSummaries) {
    if (!isRecord(s.parsedData)) continue;
    const verdict = safeString(s.parsedData.recommendation ?? s.parsedData.verdict);
    if (!verdict) continue;
    const group = messageGroups.get(s.messageId) ?? [];
    group.push(verdict);
    messageGroups.set(s.messageId, group);
  }
  for (const group of messageGroups.values()) {
    if (group.length < 2) continue;
    const majority = group.sort(
      (a, b) =>
        group.filter((v) => v === b).length - group.filter((v) => v === a).length
    )[0];
    const agrees = group.filter((v) => v === majority).length;
    consensusCount += agrees;
    totalComparisons += group.length;
  }

  return {
    kind: "jury",
    verdictDistribution: [...verdictCounts.entries()]
      .map(([verdict, count]) => ({ verdict, count }))
      .sort((a, b) => b.count - a.count),
    dimensionAverages: [...dimensionSums.entries()]
      .map(([dimension, s]) => ({
        dimension,
        avgScore: Math.round((s.sum / s.count) * 10) / 10,
      }))
      .sort((a, b) => b.avgScore - a.avgScore),
    jurorConsensusRate:
      totalComparisons > 0 ? consensusCount / totalComparisons : 0,
  };
}

// ---------------------------------------------------------------------------
// Debate
// ---------------------------------------------------------------------------

export function computeDebateMetrics(
  stages: RawDeliberationStageRow[]
): DebateMetrics {
  const revisions = filterByStageType(stages, "revision");
  const voteResults = filterByStageType(stages, "vote_result", "winner");
  const initialResponses = filterByStageType(stages, "initial_response");

  const decisionCounts = new Map<string, number>();
  let wordCountDeltaSum = 0;
  let deltaCount = 0;

  for (const s of revisions) {
    if (!isRecord(s.parsedData)) continue;
    const decision = safeString(s.parsedData.decision, "revised");
    decisionCounts.set(decision, (decisionCounts.get(decision) ?? 0) + 1);

    const originalLength = safeNumber(s.parsedData.originalWordCount);
    const revisedLength = safeNumber(s.parsedData.revisedWordCount);
    if (originalLength > 0 && revisedLength > 0) {
      wordCountDeltaSum += revisedLength - originalLength;
      deltaCount++;
    } else if (typeof s.parsedData.original === "string" && typeof s.parsedData.revised === "string") {
      wordCountDeltaSum += countWords(s.parsedData.revised as string) - countWords(s.parsedData.original as string);
      deltaCount++;
    }
  }

  const winnerCounts = new Map<string, number>();
  for (const s of voteResults) {
    if (!isRecord(s.parsedData)) continue;
    const model = safeString(s.parsedData.winner ?? s.model);
    if (model) {
      winnerCounts.set(model, (winnerCounts.get(model) ?? 0) + 1);
    }
  }

  return {
    kind: "debate",
    revisionDecisionDist: [...decisionCounts.entries()]
      .map(([decision, count]) => ({ decision, count }))
      .sort((a, b) => b.count - a.count),
    winnerDistribution: [...winnerCounts.entries()]
      .map(([model, wins]) => ({
        model,
        displayName: getModelDisplayName(model),
        wins,
      }))
      .sort((a, b) => b.wins - a.wins),
    avgWordCountDelta: deltaCount > 0 ? Math.round(wordCountDeltaSum / deltaCount) : 0,
  };
}

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

export function computeTournamentMetrics(
  stages: RawDeliberationStageRow[]
): TournamentMetrics {
  const champions = filterByStageType(stages, "champion", "final_result");
  const matchups = filterByStageType(stages, "matchup", "match_result");

  const championCounts = new Map<string, number>();
  for (const s of champions) {
    if (!isRecord(s.parsedData)) continue;
    const model = safeString(s.parsedData.champion ?? s.parsedData.winner ?? s.model);
    if (model) {
      championCounts.set(model, (championCounts.get(model) ?? 0) + 1);
    }
  }

  const matchWins = new Map<string, { wins: number; total: number }>();
  for (const s of matchups) {
    if (!isRecord(s.parsedData)) continue;
    const winner = safeString(s.parsedData.winner);
    const loser = safeString(s.parsedData.loser);
    if (winner) {
      const stats = matchWins.get(winner) ?? { wins: 0, total: 0 };
      stats.wins++;
      stats.total++;
      matchWins.set(winner, stats);
    }
    if (loser) {
      const stats = matchWins.get(loser) ?? { wins: 0, total: 0 };
      stats.total++;
      matchWins.set(loser, stats);
    }
  }

  return {
    kind: "tournament",
    championDistribution: [...championCounts.entries()]
      .map(([model, wins]) => ({
        model,
        displayName: getModelDisplayName(model),
        wins,
      }))
      .sort((a, b) => b.wins - a.wins),
    matchupWinRates: [...matchWins.entries()]
      .map(([model, stats]) => ({
        model,
        displayName: getModelDisplayName(model),
        winRate: stats.total > 0 ? stats.wins / stats.total : 0,
        matches: stats.total,
      }))
      .sort((a, b) => b.winRate - a.winRate),
  };
}

// ---------------------------------------------------------------------------
// Delphi
// ---------------------------------------------------------------------------

export function computeDelphiMetrics(
  stages: RawDeliberationStageRow[]
): DelphiMetrics {
  const roundStages = filterByStageType(stages, "round", "delphi_round");
  const convergenceStages = filterByStageType(stages, "convergence", "final_synthesis");

  // Count rounds per message
  const roundsPerMessage = new Map<string, number>();
  for (const s of roundStages) {
    roundsPerMessage.set(s.messageId, (roundsPerMessage.get(s.messageId) ?? 0) + 1);
  }
  for (const s of convergenceStages) {
    if (!isRecord(s.parsedData)) continue;
    const rounds = safeNumber(s.parsedData.totalRounds ?? s.parsedData.rounds);
    if (rounds > 0) {
      roundsPerMessage.set(s.messageId, rounds);
    }
  }

  const roundCounts = [...roundsPerMessage.values()];
  const avgRounds =
    roundCounts.length > 0
      ? roundCounts.reduce((a, b) => a + b, 0) / roundCounts.length
      : 0;

  // Confidence distribution from round data
  const confidenceBuckets = new Map<string, number>();
  for (const s of roundStages) {
    if (!isRecord(s.parsedData)) continue;
    const confidence = safeNumber(s.parsedData.confidence);
    if (confidence > 0) {
      const bucket = confidence >= 0.9 ? "High (≥90%)" : confidence >= 0.7 ? "Medium (70-89%)" : "Low (<70%)";
      confidenceBuckets.set(bucket, (confidenceBuckets.get(bucket) ?? 0) + 1);
    }
  }

  return {
    kind: "delphi",
    avgConvergenceRounds: Math.round(avgRounds * 10) / 10,
    confidenceDistribution: [...confidenceBuckets.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Confidence-Weighted
// ---------------------------------------------------------------------------

export function computeConfidenceMetrics(
  stages: RawDeliberationStageRow[]
): ConfidenceMetrics {
  const responseStages = filterByStageType(stages, "response", "confidence_response");
  const outlierStages = filterByStageType(stages, "outlier", "outlier_detection");

  const confidenceValues: number[] = [];
  const buckets = new Map<string, number>();

  for (const s of responseStages) {
    if (!isRecord(s.parsedData)) continue;
    const confidence = safeNumber(s.parsedData.confidence);
    if (confidence > 0) {
      confidenceValues.push(confidence);
      const bucket =
        confidence >= 0.9 ? "Very High (≥90%)"
        : confidence >= 0.75 ? "High (75-89%)"
        : confidence >= 0.5 ? "Medium (50-74%)"
        : "Low (<50%)";
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
  }

  let outlierCount = 0;
  let totalChecks = 0;
  for (const s of outlierStages) {
    if (!isRecord(s.parsedData)) continue;
    if (s.parsedData.isOutlier === true) outlierCount++;
    totalChecks++;
  }

  const avgConfidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
      : 0;

  return {
    kind: "confidence_weighted",
    confidenceHistogram: [...buckets.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => b.count - a.count),
    outlierRate: totalChecks > 0 ? outlierCount / totalChecks : 0,
    avgConfidence: Math.round(avgConfidence * 1000) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Red Team
// ---------------------------------------------------------------------------

export function computeRedTeamMetrics(
  stages: RawDeliberationStageRow[]
): RedTeamMetrics {
  const attacks = filterByStageType(stages, "attack", "red_team_attack");
  const defenses = filterByStageType(stages, "defense", "red_team_defense");
  const judgments = filterByStageType(stages, "judgment", "red_team_judgment");

  const severityCounts = new Map<string, number>();
  for (const s of attacks) {
    if (!isRecord(s.parsedData)) continue;
    const severity = safeString(s.parsedData.severity, "medium");
    severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
  }

  let acceptCount = 0;
  let totalJudgments = 0;
  for (const s of [...judgments, ...defenses]) {
    if (!isRecord(s.parsedData)) continue;
    const accepted =
      s.parsedData.defenseAccepted === true ||
      s.parsedData.verdict === "defense_accepted" ||
      s.parsedData.result === "pass";
    if (accepted) acceptCount++;
    totalJudgments++;
  }

  return {
    kind: "red_team",
    severityDistribution: [...severityCounts.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    defenseAcceptRate: totalJudgments > 0 ? acceptCount / totalJudgments : 0,
  };
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export function computeChainMetrics(
  stages: RawDeliberationStageRow[]
): ChainMetrics {
  const steps = filterByStageType(stages, "chain_step", "step", "improvement");

  // Word count progression grouped by step order
  const stepWordCounts = new Map<number, { sum: number; count: number }>();
  let skipCount = 0;
  const mandateCounts = new Map<string, number>();

  for (const s of steps) {
    const wordCount = countWords(typeof s.parsedData === "string" ? "" : (isRecord(s.parsedData) && typeof s.parsedData.content === "string" ? s.parsedData.content : ""));

    if (wordCount > 0) {
      const existing = stepWordCounts.get(s.stageOrder) ?? { sum: 0, count: 0 };
      existing.sum += wordCount;
      existing.count++;
      stepWordCounts.set(s.stageOrder, existing);
    }

    if (isRecord(s.parsedData)) {
      const mandate = safeString(s.parsedData.mandate);
      if (mandate) {
        mandateCounts.set(mandate, (mandateCounts.get(mandate) ?? 0) + 1);
      }
      if (s.parsedData.skipped === true) skipCount++;
    }
  }

  const totalSteps = steps.length;

  return {
    kind: "chain",
    avgWordCountProgression: [...stepWordCounts.entries()]
      .map(([step, stats]) => ({
        step,
        avgWordCount: Math.round(stats.sum / stats.count),
      }))
      .sort((a, b) => a.step - b.step),
    mandateDistribution: [...mandateCounts.entries()]
      .map(([mandate, count]) => ({ mandate, count }))
      .sort((a, b) => b.count - a.count),
    skipRate: totalSteps > 0 ? skipCount / totalSteps : 0,
  };
}

// ---------------------------------------------------------------------------
// Specialist Panel
// ---------------------------------------------------------------------------

export function computeSpecialistPanelMetrics(
  stages: RawDeliberationStageRow[]
): SpecialistPanelMetrics {
  const roleCounts = new Map<string, number>();

  for (const s of stages) {
    const role = s.role ?? (isRecord(s.parsedData) ? safeString(s.parsedData.role) : "");
    if (role) {
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
  }

  return {
    kind: "specialist_panel",
    roleDistribution: [...roleCounts.entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

export function computeBlueprintMetrics(
  stages: RawDeliberationStageRow[]
): BlueprintMetrics {
  const outlines = filterByStageType(stages, "outline");
  const sections = filterByStageType(stages, "section", "section_expansion");
  const assemblies = filterByStageType(stages, "assembly", "final_document");

  let totalSections = 0;
  let totalWordCount = 0;
  let documentCount = 0;
  let todoCount = 0;

  for (const s of outlines) {
    if (!isRecord(s.parsedData)) continue;
    const sectionCount = safeNumber(s.parsedData.sectionCount);
    if (sectionCount > 0) totalSections += sectionCount;
    else if (Array.isArray(s.parsedData.sections)) {
      totalSections += s.parsedData.sections.length;
    }
  }

  for (const s of assemblies) {
    const content = typeof s.parsedData === "string" ? s.parsedData : "";
    const words = countWords(content || "");
    if (words > 0) {
      totalWordCount += words;
      documentCount++;
    }
    if (isRecord(s.parsedData) && typeof s.parsedData.content === "string") {
      const docWords = countWords(s.parsedData.content);
      if (docWords > 0) {
        totalWordCount += docWords;
        documentCount++;
      }
      if (s.parsedData.content.includes("TODO") || s.parsedData.content.includes("todo")) {
        todoCount++;
      }
    }
  }

  const docSessions = outlines.length || 1;

  return {
    kind: "blueprint",
    avgSectionCount: docSessions > 0 ? Math.round(totalSections / docSessions * 10) / 10 : 0,
    avgWordCount: documentCount > 0 ? Math.round(totalWordCount / documentCount) : 0,
    todoMarkerRate: documentCount > 0 ? todoCount / documentCount : 0,
  };
}

// ---------------------------------------------------------------------------
// Peer Review
// ---------------------------------------------------------------------------

export function computePeerReviewMetrics(
  stages: RawDeliberationStageRow[]
): PeerReviewMetrics {
  const reviews = filterByStageType(stages, "review", "peer_review");
  const consolidations = filterByStageType(stages, "consolidation", "consolidated_report");

  const severityCounts = new Map<string, number>();
  const rubricSums = new Map<string, { sum: number; count: number }>();
  let consensusCount = 0;
  let totalReviewGroups = 0;

  for (const s of reviews) {
    if (!isRecord(s.parsedData)) continue;
    const findings = Array.isArray(s.parsedData.findings) ? s.parsedData.findings : [];
    for (const f of findings) {
      if (isRecord(f)) {
        const severity = safeString(f.severity, "info");
        severityCounts.set(severity, (severityCounts.get(severity) ?? 0) + 1);
      }
    }
    const scores = s.parsedData.scores ?? s.parsedData.rubricScores;
    if (isRecord(scores)) {
      for (const [criterion, val] of Object.entries(scores)) {
        const numVal = safeNumber(val);
        if (numVal > 0) {
          const existing = rubricSums.get(criterion) ?? { sum: 0, count: 0 };
          existing.sum += numVal;
          existing.count++;
          rubricSums.set(criterion, existing);
        }
      }
    }
  }

  // Consensus from consolidation
  for (const s of consolidations) {
    if (!isRecord(s.parsedData)) continue;
    const consensus = safeNumber(s.parsedData.consensusRate ?? s.parsedData.agreement);
    if (consensus > 0) {
      consensusCount += consensus;
      totalReviewGroups++;
    }
  }

  return {
    kind: "peer_review",
    findingSeverityDist: [...severityCounts.entries()]
      .map(([severity, count]) => ({ severity, count }))
      .sort((a, b) => b.count - a.count),
    rubricScoreAverages: [...rubricSums.entries()]
      .map(([criterion, s]) => ({
        criterion,
        avgScore: Math.round((s.sum / s.count) * 10) / 10,
      }))
      .sort((a, b) => b.avgScore - a.avgScore),
    consensusRate: totalReviewGroups > 0 ? consensusCount / totalReviewGroups : 0,
  };
}

// ---------------------------------------------------------------------------
// Decompose
// ---------------------------------------------------------------------------

export function computeDecomposeMetrics(
  stages: RawDeliberationStageRow[]
): DecomposeMetrics {
  const plans = filterByStageType(stages, "plan", "decomposition");
  const tasks = filterByStageType(stages, "task_result", "subtask");
  const assemblies = filterByStageType(stages, "assembly", "reassembly");

  let totalWaves = 0;
  let planCount = 0;
  for (const s of plans) {
    if (!isRecord(s.parsedData)) continue;
    const waves = safeNumber(s.parsedData.waveCount ?? s.parsedData.waves);
    if (waves > 0) {
      totalWaves += waves;
      planCount++;
    } else if (Array.isArray(s.parsedData.waves)) {
      totalWaves += s.parsedData.waves.length;
      planCount++;
    }
  }

  let successCount = 0;
  let totalTasks = tasks.length;
  let parallelismSum = 0;
  let parallelismCount = 0;

  for (const s of tasks) {
    if (!isRecord(s.parsedData)) continue;
    if (s.parsedData.success !== false) successCount++;
  }

  for (const s of assemblies) {
    if (!isRecord(s.parsedData)) continue;
    const efficiency = safeNumber(s.parsedData.parallelismEfficiency);
    if (efficiency > 0) {
      parallelismSum += efficiency;
      parallelismCount++;
    }
  }

  return {
    kind: "decompose",
    avgParallelismEfficiency:
      parallelismCount > 0
        ? Math.round((parallelismSum / parallelismCount) * 100) / 100
        : 0,
    taskSuccessRate: totalTasks > 0 ? successCount / totalTasks : 0,
    avgWaveCount: planCount > 0 ? Math.round((totalWaves / planCount) * 10) / 10 : 0,
  };
}

// ---------------------------------------------------------------------------
// Brainstorm
// ---------------------------------------------------------------------------

export function computeBrainstormMetrics(
  stages: RawDeliberationStageRow[]
): BrainstormMetrics {
  const ideation = filterByStageType(stages, "ideation", "ideas");
  const clustering = filterByStageType(stages, "clustering", "cluster_scoring");

  let totalIdeas = 0;
  let ideationSessions = 0;

  for (const s of ideation) {
    if (!isRecord(s.parsedData)) continue;
    const ideas = Array.isArray(s.parsedData.ideas) ? s.parsedData.ideas.length : safeNumber(s.parsedData.ideaCount);
    if (ideas > 0) {
      totalIdeas += ideas;
      ideationSessions++;
    }
  }

  const dimensionSums = new Map<string, { sum: number; count: number }>();
  for (const s of clustering) {
    if (!isRecord(s.parsedData)) continue;
    const scores = s.parsedData.scores ?? s.parsedData.clusterScores;
    if (isRecord(scores)) {
      for (const [dim, val] of Object.entries(scores)) {
        const numVal = safeNumber(val);
        if (numVal > 0) {
          const existing = dimensionSums.get(dim) ?? { sum: 0, count: 0 };
          existing.sum += numVal;
          existing.count++;
          dimensionSums.set(dim, existing);
        }
      }
    }
  }

  return {
    kind: "brainstorm",
    avgIdeaCount: ideationSessions > 0 ? Math.round(totalIdeas / ideationSessions * 10) / 10 : 0,
    clusterScoreAverages: [...dimensionSums.entries()]
      .map(([dimension, s]) => ({
        dimension,
        avgScore: Math.round((s.sum / s.count) * 10) / 10,
      }))
      .sort((a, b) => b.avgScore - a.avgScore),
  };
}

// ---------------------------------------------------------------------------
// Fact-Check
// ---------------------------------------------------------------------------

export function computeFactCheckMetrics(
  stages: RawDeliberationStageRow[]
): FactCheckMetrics {
  const claims = filterByStageType(stages, "claim_extraction", "claims");
  const verifications = filterByStageType(stages, "verification", "claim_verification");
  const reports = filterByStageType(stages, "evidence_report", "final_report");

  const typeCounts = new Map<string, number>();
  for (const s of claims) {
    if (!isRecord(s.parsedData)) continue;
    const claimList = Array.isArray(s.parsedData.claims) ? s.parsedData.claims : [];
    for (const c of claimList) {
      if (isRecord(c)) {
        const type = safeString(c.type ?? c.category, "factual");
        typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      }
    }
  }

  const verdictCounts = new Map<string, number>();
  let agreementSum = 0;
  let agreementCount = 0;

  for (const s of verifications) {
    if (!isRecord(s.parsedData)) continue;
    const verdict = safeString(s.parsedData.verdict, "unknown");
    verdictCounts.set(verdict, (verdictCounts.get(verdict) ?? 0) + 1);

    const agreement = safeNumber(s.parsedData.agreementRate ?? s.parsedData.confidence);
    if (agreement > 0) {
      agreementSum += agreement;
      agreementCount++;
    }
  }

  for (const s of reports) {
    if (!isRecord(s.parsedData)) continue;
    const avgAgreement = safeNumber(s.parsedData.avgAgreementRate);
    if (avgAgreement > 0) {
      agreementSum += avgAgreement;
      agreementCount++;
    }
  }

  return {
    kind: "fact_check",
    claimTypeDistribution: [...typeCounts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    verdictDistribution: [...verdictCounts.entries()]
      .map(([verdict, count]) => ({ verdict, count }))
      .sort((a, b) => b.count - a.count),
    avgAgreementRate:
      agreementCount > 0
        ? Math.round((agreementSum / agreementCount) * 1000) / 1000
        : 0,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function computeMetricsForMode(
  mode: string,
  stages: RawDeliberationStageRow[]
): ModeMetrics {
  switch (mode) {
    case "vote":
      return computeVoteMetrics(stages);
    case "jury":
      return computeJuryMetrics(stages);
    case "debate":
      return computeDebateMetrics(stages);
    case "tournament":
      return computeTournamentMetrics(stages);
    case "delphi":
      return computeDelphiMetrics(stages);
    case "confidence_weighted":
      return computeConfidenceMetrics(stages);
    case "red_team":
      return computeRedTeamMetrics(stages);
    case "chain":
      return computeChainMetrics(stages);
    case "specialist_panel":
      return computeSpecialistPanelMetrics(stages);
    case "blueprint":
      return computeBlueprintMetrics(stages);
    case "peer_review":
      return computePeerReviewMetrics(stages);
    case "decompose":
      return computeDecomposeMetrics(stages);
    case "brainstorm":
      return computeBrainstormMetrics(stages);
    case "fact_check":
      return computeFactCheckMetrics(stages);
    default:
      // Council mode uses the existing win rate pipeline, return council metrics shell
      return {
        kind: "council",
        winRates: [],
        avgRankings: [],
      };
  }
}
