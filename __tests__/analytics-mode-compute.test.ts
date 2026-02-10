import { describe, it, expect } from "vitest";
import {
  computeVoteMetrics,
  computeJuryMetrics,
  computeDebateMetrics,
  computeTournamentMetrics,
  computeDelphiMetrics,
  computeConfidenceMetrics,
  computeRedTeamMetrics,
  computeChainMetrics,
  computeSpecialistPanelMetrics,
  computeBlueprintMetrics,
  computePeerReviewMetrics,
  computeDecomposeMetrics,
  computeBrainstormMetrics,
  computeFactCheckMetrics,
  computeMetricsForMode,
} from "@/lib/analytics/mode-compute";
import type { RawDeliberationStageRow } from "@/lib/analytics/types";

function makeStage(
  overrides: Partial<RawDeliberationStageRow>
): RawDeliberationStageRow {
  return {
    messageId: "msg1",
    stageType: "unknown",
    stageOrder: 0,
    model: "test-model",
    role: null,
    parsedData: null,
    responseTimeMs: null,
    mode: "test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

describe("computeVoteMetrics", () => {
  it("computes winner distribution and tiebreaker rate", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "winner",
        parsedData: { winner: "model-a", tiebreaker: false },
      }),
      makeStage({
        stageType: "winner",
        parsedData: { winner: "model-a", tiebreaker: true },
      }),
      makeStage({
        stageType: "winner",
        parsedData: { winner: "model-b", tiebreaker: false },
      }),
      makeStage({
        stageType: "vote_tally",
        parsedData: { winMargin: 3 },
      }),
      makeStage({
        stageType: "vote_tally",
        parsedData: { winMargin: 1 },
      }),
    ];

    const result = computeVoteMetrics(stages);
    expect(result.kind).toBe("vote");
    expect(result.winnerDistribution).toHaveLength(2);
    expect(result.winnerDistribution[0].model).toBe("model-a");
    expect(result.winnerDistribution[0].wins).toBe(2);
    expect(result.tiebreakerRate).toBeCloseTo(1 / 3);
    expect(result.avgWinMargin).toBe(2);
  });

  it("returns zero rates for empty input", () => {
    const result = computeVoteMetrics([]);
    expect(result.winnerDistribution).toEqual([]);
    expect(result.tiebreakerRate).toBe(0);
    expect(result.avgWinMargin).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Jury
// ---------------------------------------------------------------------------

describe("computeJuryMetrics", () => {
  it("computes verdict distribution and dimension averages", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "verdict",
        parsedData: { verdict: "approved" },
      }),
      makeStage({
        stageType: "verdict",
        parsedData: { verdict: "approved" },
      }),
      makeStage({
        stageType: "verdict",
        parsedData: { verdict: "rejected" },
      }),
      makeStage({
        stageType: "juror_summary",
        parsedData: {
          scores: { accuracy: 8, clarity: 6 },
          recommendation: "approved",
        },
      }),
      makeStage({
        stageType: "juror_summary",
        parsedData: {
          scores: { accuracy: 6, clarity: 8 },
          recommendation: "approved",
        },
      }),
    ];

    const result = computeJuryMetrics(stages);
    expect(result.kind).toBe("jury");
    expect(result.verdictDistribution[0].verdict).toBe("approved");
    expect(result.verdictDistribution[0].count).toBe(2);
    const accuracy = result.dimensionAverages.find((d) => d.dimension === "accuracy");
    expect(accuracy?.avgScore).toBe(7);
  });

  it("returns defaults for empty input", () => {
    const result = computeJuryMetrics([]);
    expect(result.verdictDistribution).toEqual([]);
    expect(result.dimensionAverages).toEqual([]);
    expect(result.jurorConsensusRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Debate
// ---------------------------------------------------------------------------

describe("computeDebateMetrics", () => {
  it("computes revision decisions and winner distribution", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "revision",
        parsedData: { decision: "revised", originalWordCount: 100, revisedWordCount: 150 },
      }),
      makeStage({
        stageType: "revision",
        parsedData: { decision: "kept", originalWordCount: 200, revisedWordCount: 200 },
      }),
      makeStage({
        stageType: "winner",
        parsedData: { winner: "model-x" },
      }),
    ];

    const result = computeDebateMetrics(stages);
    expect(result.kind).toBe("debate");
    expect(result.revisionDecisionDist).toHaveLength(2);
    expect(result.winnerDistribution[0].model).toBe("model-x");
    expect(result.avgWordCountDelta).toBe(25); // (50 + 0) / 2
  });
});

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------

describe("computeTournamentMetrics", () => {
  it("computes champion distribution and matchup win rates", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "champion",
        parsedData: { champion: "model-a" },
      }),
      makeStage({
        stageType: "champion",
        parsedData: { champion: "model-a" },
      }),
      makeStage({
        stageType: "matchup",
        parsedData: { winner: "model-a", loser: "model-b" },
      }),
      makeStage({
        stageType: "matchup",
        parsedData: { winner: "model-b", loser: "model-a" },
      }),
    ];

    const result = computeTournamentMetrics(stages);
    expect(result.kind).toBe("tournament");
    expect(result.championDistribution[0].model).toBe("model-a");
    expect(result.championDistribution[0].wins).toBe(2);

    const modelA = result.matchupWinRates.find((m) => m.model === "model-a");
    expect(modelA?.winRate).toBe(0.5);
    expect(modelA?.matches).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Delphi
// ---------------------------------------------------------------------------

describe("computeDelphiMetrics", () => {
  it("computes convergence rounds and confidence", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "round",
        messageId: "msg1",
        parsedData: { confidence: 0.6 },
      }),
      makeStage({
        stageType: "round",
        messageId: "msg1",
        parsedData: { confidence: 0.8 },
      }),
      makeStage({
        stageType: "round",
        messageId: "msg1",
        parsedData: { confidence: 0.95 },
      }),
      makeStage({
        stageType: "convergence",
        messageId: "msg1",
        parsedData: { totalRounds: 3 },
      }),
    ];

    const result = computeDelphiMetrics(stages);
    expect(result.kind).toBe("delphi");
    expect(result.avgConvergenceRounds).toBe(3);
    expect(result.confidenceDistribution.length).toBeGreaterThan(0);
  });

  it("returns defaults for empty input", () => {
    const result = computeDelphiMetrics([]);
    expect(result.avgConvergenceRounds).toBe(0);
    expect(result.confidenceDistribution).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Confidence-Weighted
// ---------------------------------------------------------------------------

describe("computeConfidenceMetrics", () => {
  it("computes confidence histogram and outlier rate", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "response",
        parsedData: { confidence: 0.95 },
      }),
      makeStage({
        stageType: "response",
        parsedData: { confidence: 0.6 },
      }),
      makeStage({
        stageType: "outlier",
        parsedData: { isOutlier: true },
      }),
      makeStage({
        stageType: "outlier",
        parsedData: { isOutlier: false },
      }),
    ];

    const result = computeConfidenceMetrics(stages);
    expect(result.kind).toBe("confidence_weighted");
    expect(result.avgConfidence).toBeCloseTo(0.775, 2);
    expect(result.outlierRate).toBe(0.5);
    expect(result.confidenceHistogram.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Red Team
// ---------------------------------------------------------------------------

describe("computeRedTeamMetrics", () => {
  it("computes severity distribution and defense accept rate", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "attack",
        parsedData: { severity: "high" },
      }),
      makeStage({
        stageType: "attack",
        parsedData: { severity: "low" },
      }),
      makeStage({
        stageType: "attack",
        parsedData: { severity: "high" },
      }),
      makeStage({
        stageType: "judgment",
        parsedData: { defenseAccepted: true },
      }),
      makeStage({
        stageType: "judgment",
        parsedData: { defenseAccepted: false },
      }),
    ];

    const result = computeRedTeamMetrics(stages);
    expect(result.kind).toBe("red_team");
    expect(result.severityDistribution[0].severity).toBe("high");
    expect(result.severityDistribution[0].count).toBe(2);
    expect(result.defenseAcceptRate).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

describe("computeChainMetrics", () => {
  it("computes word progression and skip rate", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "chain_step",
        stageOrder: 1,
        parsedData: { content: "word ".repeat(100), mandate: "expand" },
      }),
      makeStage({
        stageType: "chain_step",
        stageOrder: 2,
        parsedData: { content: "word ".repeat(200), mandate: "refine", skipped: false },
      }),
      makeStage({
        stageType: "chain_step",
        stageOrder: 3,
        parsedData: { content: "word ".repeat(50), skipped: true },
      }),
    ];

    const result = computeChainMetrics(stages);
    expect(result.kind).toBe("chain");
    expect(result.avgWordCountProgression.length).toBeGreaterThan(0);
    expect(result.skipRate).toBeCloseTo(1 / 3);
  });
});

// ---------------------------------------------------------------------------
// Specialist Panel
// ---------------------------------------------------------------------------

describe("computeSpecialistPanelMetrics", () => {
  it("counts roles", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({ role: "security_expert" }),
      makeStage({ role: "security_expert" }),
      makeStage({ role: "ux_designer" }),
    ];

    const result = computeSpecialistPanelMetrics(stages);
    expect(result.kind).toBe("specialist_panel");
    expect(result.roleDistribution[0].role).toBe("security_expert");
    expect(result.roleDistribution[0].count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Blueprint
// ---------------------------------------------------------------------------

describe("computeBlueprintMetrics", () => {
  it("computes section and word counts", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "outline",
        parsedData: { sectionCount: 5 },
      }),
      makeStage({
        stageType: "assembly",
        parsedData: { content: "word ".repeat(500) },
      }),
    ];

    const result = computeBlueprintMetrics(stages);
    expect(result.kind).toBe("blueprint");
    expect(result.avgSectionCount).toBe(5);
    expect(result.avgWordCount).toBe(500);
  });

  it("returns defaults for empty input", () => {
    const result = computeBlueprintMetrics([]);
    expect(result.avgSectionCount).toBe(0);
    expect(result.avgWordCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Peer Review
// ---------------------------------------------------------------------------

describe("computePeerReviewMetrics", () => {
  it("computes finding severity and rubric averages", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "review",
        parsedData: {
          findings: [{ severity: "critical" }, { severity: "minor" }],
          scores: { correctness: 8, readability: 7 },
        },
      }),
      makeStage({
        stageType: "review",
        parsedData: {
          findings: [{ severity: "critical" }],
          scores: { correctness: 6, readability: 9 },
        },
      }),
    ];

    const result = computePeerReviewMetrics(stages);
    expect(result.kind).toBe("peer_review");
    expect(result.findingSeverityDist.find((s) => s.severity === "critical")?.count).toBe(2);
    const correctness = result.rubricScoreAverages.find((r) => r.criterion === "correctness");
    expect(correctness?.avgScore).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Decompose
// ---------------------------------------------------------------------------

describe("computeDecomposeMetrics", () => {
  it("computes parallelism and task success", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "plan",
        parsedData: { waveCount: 3 },
      }),
      makeStage({
        stageType: "task_result",
        parsedData: { success: true },
      }),
      makeStage({
        stageType: "task_result",
        parsedData: { success: true },
      }),
      makeStage({
        stageType: "task_result",
        parsedData: { success: false },
      }),
      makeStage({
        stageType: "assembly",
        parsedData: { parallelismEfficiency: 0.85 },
      }),
    ];

    const result = computeDecomposeMetrics(stages);
    expect(result.kind).toBe("decompose");
    expect(result.avgWaveCount).toBe(3);
    expect(result.taskSuccessRate).toBeCloseTo(2 / 3);
    expect(result.avgParallelismEfficiency).toBe(0.85);
  });
});

// ---------------------------------------------------------------------------
// Brainstorm
// ---------------------------------------------------------------------------

describe("computeBrainstormMetrics", () => {
  it("computes idea count and cluster scores", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "ideation",
        parsedData: { ideas: ["a", "b", "c", "d"] },
      }),
      makeStage({
        stageType: "clustering",
        parsedData: { scores: { novelty: 7, feasibility: 8, impact: 6 } },
      }),
    ];

    const result = computeBrainstormMetrics(stages);
    expect(result.kind).toBe("brainstorm");
    expect(result.avgIdeaCount).toBe(4);
    expect(result.clusterScoreAverages.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Fact-Check
// ---------------------------------------------------------------------------

describe("computeFactCheckMetrics", () => {
  it("computes claim types, verdicts, and agreement rate", () => {
    const stages: RawDeliberationStageRow[] = [
      makeStage({
        stageType: "claim_extraction",
        parsedData: {
          claims: [
            { type: "factual" },
            { type: "statistical" },
            { type: "factual" },
          ],
        },
      }),
      makeStage({
        stageType: "verification",
        parsedData: { verdict: "supported", agreementRate: 0.9 },
      }),
      makeStage({
        stageType: "verification",
        parsedData: { verdict: "refuted", agreementRate: 0.7 },
      }),
    ];

    const result = computeFactCheckMetrics(stages);
    expect(result.kind).toBe("fact_check");
    expect(result.claimTypeDistribution[0].type).toBe("factual");
    expect(result.claimTypeDistribution[0].count).toBe(2);
    expect(result.verdictDistribution).toHaveLength(2);
    expect(result.avgAgreementRate).toBeCloseTo(0.8, 1);
  });
});

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

describe("computeMetricsForMode", () => {
  it("dispatches to the correct compute function", () => {
    const voteStages = [
      makeStage({ stageType: "winner", parsedData: { winner: "m" } }),
    ];
    expect(computeMetricsForMode("vote", voteStages).kind).toBe("vote");
  });

  it("returns council kind for unknown modes", () => {
    expect(computeMetricsForMode("unknown", []).kind).toBe("council");
  });

  it("handles all 14 non-council modes", () => {
    const modes = [
      "vote", "jury", "debate", "tournament", "delphi",
      "confidence_weighted", "red_team", "chain", "specialist_panel",
      "blueprint", "peer_review", "decompose", "brainstorm", "fact_check",
    ];

    for (const mode of modes) {
      const result = computeMetricsForMode(mode, []);
      expect(result.kind).toBe(mode);
    }
  });
});
