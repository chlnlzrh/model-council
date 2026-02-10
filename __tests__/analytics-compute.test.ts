import { describe, it, expect } from "vitest";
import {
  presetToDate,
  isValidPreset,
  computeWinRates,
  computeResponseTimes,
  computeDailyUsage,
  computeSummary,
  computeModeDistribution,
  computeExtendedSummary,
  computeCrossModeResponseTimes,
} from "@/lib/analytics/compute";
import type {
  RawRankingRow,
  RawLabelMapRow,
  RawResponseTimeRow,
  RawMessageDateRow,
} from "@/lib/analytics/types";

// ---------------------------------------------------------------------------
// presetToDate
// ---------------------------------------------------------------------------

describe("presetToDate", () => {
  it('returns null for "all"', () => {
    expect(presetToDate("all")).toBeNull();
  });

  it("returns a Date ~7 days ago for 7d", () => {
    const result = presetToDate("7d")!;
    const diffMs = Date.now() - result.getTime();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });

  it("returns a Date ~30 days ago for 30d", () => {
    const result = presetToDate("30d")!;
    const diffMs = Date.now() - result.getTime();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(29.9);
    expect(diffDays).toBeLessThan(30.1);
  });

  it("returns a Date ~90 days ago for 90d", () => {
    const result = presetToDate("90d")!;
    const diffMs = Date.now() - result.getTime();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(89.9);
    expect(diffDays).toBeLessThan(90.1);
  });
});

// ---------------------------------------------------------------------------
// isValidPreset
// ---------------------------------------------------------------------------

describe("isValidPreset", () => {
  it("accepts valid presets", () => {
    expect(isValidPreset("7d")).toBe(true);
    expect(isValidPreset("30d")).toBe(true);
    expect(isValidPreset("90d")).toBe(true);
    expect(isValidPreset("all")).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isValidPreset("1d")).toBe(false);
    expect(isValidPreset("")).toBe(false);
    expect(isValidPreset("365d")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeWinRates
// ---------------------------------------------------------------------------

describe("computeWinRates", () => {
  const labelMaps: RawLabelMapRow[] = [
    { messageId: "msg1", label: "Response A", model: "model-a" },
    { messageId: "msg1", label: "Response B", model: "model-b" },
    { messageId: "msg1", label: "Response C", model: "model-c" },
    { messageId: "msg2", label: "Response A", model: "model-a" },
    { messageId: "msg2", label: "Response B", model: "model-b" },
    { messageId: "msg2", label: "Response C", model: "model-c" },
  ];

  it("counts wins correctly when one model wins all", () => {
    const rankings: RawRankingRow[] = [
      {
        messageId: "msg1",
        rankerModel: "model-a",
        parsedRanking: [
          { label: "Response A", position: 1 },
          { label: "Response B", position: 2 },
          { label: "Response C", position: 3 },
        ],
      },
      {
        messageId: "msg1",
        rankerModel: "model-b",
        parsedRanking: [
          { label: "Response A", position: 1 },
          { label: "Response B", position: 2 },
          { label: "Response C", position: 3 },
        ],
      },
      {
        messageId: "msg2",
        rankerModel: "model-a",
        parsedRanking: [
          { label: "Response A", position: 1 },
          { label: "Response B", position: 2 },
          { label: "Response C", position: 3 },
        ],
      },
    ];

    const result = computeWinRates(rankings, labelMaps);

    // model-a should have 3 wins out of 2 appearances = 1.5 (>1), but
    // appearances is per unique message, not per ranking
    const modelA = result.find((r) => r.model === "model-a");
    expect(modelA).toBeDefined();
    expect(modelA!.wins).toBe(3);
    expect(modelA!.totalAppearances).toBe(2);
  });

  it("handles split wins between models", () => {
    const rankings: RawRankingRow[] = [
      {
        messageId: "msg1",
        rankerModel: "model-a",
        parsedRanking: [
          { label: "Response A", position: 1 },
          { label: "Response B", position: 2 },
        ],
      },
      {
        messageId: "msg1",
        rankerModel: "model-b",
        parsedRanking: [
          { label: "Response B", position: 1 },
          { label: "Response A", position: 2 },
        ],
      },
    ];

    const result = computeWinRates(rankings, labelMaps);

    const modelA = result.find((r) => r.model === "model-a");
    const modelB = result.find((r) => r.model === "model-b");
    expect(modelA!.wins).toBe(1);
    expect(modelB!.wins).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(computeWinRates([], [])).toEqual([]);
  });

  it("handles null/invalid parsedRanking gracefully", () => {
    const rankings: RawRankingRow[] = [
      { messageId: "msg1", rankerModel: "model-a", parsedRanking: null },
      { messageId: "msg1", rankerModel: "model-b", parsedRanking: "invalid" },
    ];

    const result = computeWinRates(rankings, labelMaps);
    // No wins counted, but appearances still counted from labelMaps
    for (const entry of result) {
      expect(entry.wins).toBe(0);
    }
  });

  it("sorts by win rate descending", () => {
    const rankings: RawRankingRow[] = [
      {
        messageId: "msg1",
        rankerModel: "model-a",
        parsedRanking: [
          { label: "Response B", position: 1 },
          { label: "Response A", position: 2 },
        ],
      },
      {
        messageId: "msg2",
        rankerModel: "model-a",
        parsedRanking: [
          { label: "Response B", position: 1 },
          { label: "Response A", position: 2 },
        ],
      },
    ];

    const result = computeWinRates(rankings, labelMaps);
    expect(result[0].model).toBe("model-b");
  });
});

// ---------------------------------------------------------------------------
// computeResponseTimes
// ---------------------------------------------------------------------------

describe("computeResponseTimes", () => {
  it("computes avg/min/max correctly", () => {
    const rows: RawResponseTimeRow[] = [
      { model: "model-a", responseTimeMs: 1000 },
      { model: "model-a", responseTimeMs: 3000 },
      { model: "model-a", responseTimeMs: 2000 },
      { model: "model-b", responseTimeMs: 500 },
    ];

    const result = computeResponseTimes(rows);
    const modelA = result.find((r) => r.model === "model-a");
    const modelB = result.find((r) => r.model === "model-b");

    expect(modelA!.avgResponseTimeMs).toBe(2000);
    expect(modelA!.minResponseTimeMs).toBe(1000);
    expect(modelA!.maxResponseTimeMs).toBe(3000);
    expect(modelA!.sampleCount).toBe(3);

    expect(modelB!.avgResponseTimeMs).toBe(500);
    expect(modelB!.sampleCount).toBe(1);
  });

  it("sorts by avg response time ascending (fastest first)", () => {
    const rows: RawResponseTimeRow[] = [
      { model: "model-slow", responseTimeMs: 5000 },
      { model: "model-fast", responseTimeMs: 1000 },
    ];

    const result = computeResponseTimes(rows);
    expect(result[0].model).toBe("model-fast");
    expect(result[1].model).toBe("model-slow");
  });

  it("skips null response times", () => {
    const rows: RawResponseTimeRow[] = [
      { model: "model-a", responseTimeMs: null },
      { model: "model-a", responseTimeMs: 1000 },
    ];

    const result = computeResponseTimes(rows);
    expect(result[0].sampleCount).toBe(1);
    expect(result[0].avgResponseTimeMs).toBe(1000);
  });

  it("returns empty array for empty input", () => {
    expect(computeResponseTimes([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeDailyUsage
// ---------------------------------------------------------------------------

describe("computeDailyUsage", () => {
  it("groups dates correctly", () => {
    const dates: RawMessageDateRow[] = [
      { createdAt: new Date("2026-02-01T10:00:00Z") },
      { createdAt: new Date("2026-02-01T15:00:00Z") },
      { createdAt: new Date("2026-02-02T09:00:00Z") },
    ];

    const result = computeDailyUsage(dates);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ date: "2026-02-01", queryCount: 2 });
    expect(result[1]).toEqual({ date: "2026-02-02", queryCount: 1 });
  });

  it("sorts by date ascending", () => {
    const dates: RawMessageDateRow[] = [
      { createdAt: new Date("2026-02-05T10:00:00Z") },
      { createdAt: new Date("2026-02-01T10:00:00Z") },
    ];

    const result = computeDailyUsage(dates);
    expect(result[0].date).toBe("2026-02-01");
    expect(result[1].date).toBe("2026-02-05");
  });

  it("returns empty for empty input", () => {
    expect(computeDailyUsage([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeSummary
// ---------------------------------------------------------------------------

describe("computeSummary", () => {
  it("computes weighted average response time", () => {
    const responseTimes = [
      {
        model: "a",
        displayName: "A",
        avgResponseTimeMs: 1000,
        minResponseTimeMs: 500,
        maxResponseTimeMs: 1500,
        sampleCount: 10,
      },
      {
        model: "b",
        displayName: "B",
        avgResponseTimeMs: 3000,
        minResponseTimeMs: 2000,
        maxResponseTimeMs: 4000,
        sampleCount: 10,
      },
    ];

    const winRates = [
      { model: "a", displayName: "A", wins: 5, totalAppearances: 10, winRate: 0.5 },
    ];

    const result = computeSummary(5, 20, responseTimes, winRates);
    expect(result.totalSessions).toBe(5);
    expect(result.totalQueries).toBe(20);
    // (1000*10 + 3000*10) / 20 = 2000
    expect(result.avgResponseTimeMs).toBe(2000);
    expect(result.topModel).toBe("a");
    expect(result.topModelDisplayName).toBe("A");
  });

  it("handles empty data", () => {
    const result = computeSummary(0, 0, [], []);
    expect(result.totalSessions).toBe(0);
    expect(result.totalQueries).toBe(0);
    expect(result.avgResponseTimeMs).toBe(0);
    expect(result.topModel).toBeNull();
    expect(result.topModelDisplayName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeModeDistribution
// ---------------------------------------------------------------------------

describe("computeModeDistribution", () => {
  it("computes percentages correctly", () => {
    const input = [
      { mode: "council", count: 30 },
      { mode: "vote", count: 20 },
      { mode: "jury", count: 50 },
    ];

    const result = computeModeDistribution(input);
    expect(result).toHaveLength(3);
    // Sorted by count descending
    expect(result[0].mode).toBe("jury");
    expect(result[0].percentage).toBe(0.5);
    expect(result[0].displayName).toBe("Jury");
    expect(result[1].mode).toBe("council");
    expect(result[1].percentage).toBe(0.3);
    expect(result[2].mode).toBe("vote");
    expect(result[2].percentage).toBe(0.2);
  });

  it("returns empty for empty input", () => {
    expect(computeModeDistribution([])).toEqual([]);
  });

  it("returns empty for zero total", () => {
    expect(computeModeDistribution([{ mode: "council", count: 0 }])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computeExtendedSummary
// ---------------------------------------------------------------------------

describe("computeExtendedSummary", () => {
  it("includes modesUsed and mostActiveMode", () => {
    const responseTimes = [
      { model: "a", displayName: "A", avgResponseTimeMs: 2000, minResponseTimeMs: 1000, maxResponseTimeMs: 3000, sampleCount: 5 },
    ];
    const winRates = [
      { model: "a", displayName: "A", wins: 3, totalAppearances: 5, winRate: 0.6 },
    ];
    const modeDist = [
      { mode: "council", displayName: "Council", count: 10, percentage: 0.67 },
      { mode: "vote", displayName: "Vote", count: 5, percentage: 0.33 },
    ];

    const result = computeExtendedSummary(15, 20, responseTimes, winRates, modeDist);
    expect(result.modesUsed).toBe(2);
    expect(result.mostActiveMode).toBe("council");
    expect(result.mostActiveModeDisplayName).toBe("Council");
    expect(result.totalSessions).toBe(15);
  });

  it("handles empty mode distribution", () => {
    const result = computeExtendedSummary(0, 0, [], [], []);
    expect(result.modesUsed).toBe(0);
    expect(result.mostActiveMode).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeCrossModeResponseTimes
// ---------------------------------------------------------------------------

describe("computeCrossModeResponseTimes", () => {
  it("groups by model and mode", () => {
    const rows = [
      { model: "model-a", responseTimeMs: 2000, mode: "council" },
      { model: "model-a", responseTimeMs: 4000, mode: "council" },
      { model: "model-a", responseTimeMs: 1000, mode: "vote" },
      { model: "model-b", responseTimeMs: 3000, mode: "council" },
    ];

    const result = computeCrossModeResponseTimes(rows);
    expect(result.length).toBe(2);

    const modelA = result.find((r) => r.model === "model-a");
    expect(modelA).toBeDefined();
    expect(modelA!.totalSessions).toBe(3);
    expect(modelA!.modes).toHaveLength(2);

    const councilMode = modelA!.modes.find((m) => m.mode === "council");
    expect(councilMode?.avgResponseTimeMs).toBe(3000);
    expect(councilMode?.sessions).toBe(2);
  });

  it("skips null models and response times", () => {
    const rows = [
      { model: null, responseTimeMs: 1000, mode: "council" },
      { model: "model-a", responseTimeMs: null, mode: "council" },
      { model: "model-a", responseTimeMs: 2000, mode: "council" },
    ];

    const result = computeCrossModeResponseTimes(rows);
    expect(result).toHaveLength(1);
    expect(result[0].totalSessions).toBe(1);
  });

  it("returns empty for empty input", () => {
    expect(computeCrossModeResponseTimes([])).toEqual([]);
  });

  it("sorts by overallScore descending", () => {
    const rows = [
      { model: "slow-model", responseTimeMs: 50000, mode: "council" },
      { model: "fast-model", responseTimeMs: 1000, mode: "council" },
    ];

    const result = computeCrossModeResponseTimes(rows);
    expect(result[0].model).toBe("fast-model");
    expect(result[0].overallScore).toBeGreaterThan(result[1].overallScore);
  });
});
