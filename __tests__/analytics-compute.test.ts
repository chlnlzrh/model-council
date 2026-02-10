import { describe, it, expect } from "vitest";
import {
  presetToDate,
  isValidPreset,
  computeWinRates,
  computeResponseTimes,
  computeDailyUsage,
  computeSummary,
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
