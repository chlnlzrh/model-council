import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CouncilConfig } from "@/lib/council/types";

// Mock the openrouter module
vi.mock("@/lib/council/openrouter", () => ({
  queryModel: vi.fn(),
  queryModelsParallel: vi.fn(),
}));

import { queryModel, queryModelsParallel } from "@/lib/council/openrouter";
import {
  stage1Collect,
  stage2Rank,
  stage3Synthesize,
  generateTitle,
  runFullCouncil,
} from "@/lib/council/orchestrator";

const mockQueryModel = vi.mocked(queryModel);
const mockQueryModelsParallel = vi.mocked(queryModelsParallel);

const TEST_CONFIG: CouncilConfig = {
  councilModels: ["model-a", "model-b", "model-c"],
  chairmanModel: "chairman-model",
  timeoutMs: 5000,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Stage 1
// ---------------------------------------------------------------------------

describe("stage1Collect", () => {
  it("returns responses from all successful models", async () => {
    const mockResults = new Map([
      ["model-a", { content: "Answer A", responseTimeMs: 100 }],
      ["model-b", { content: "Answer B", responseTimeMs: 200 }],
      ["model-c", { content: "Answer C", responseTimeMs: 300 }],
    ]);
    mockQueryModelsParallel.mockResolvedValue(mockResults);

    const results = await stage1Collect("test question", TEST_CONFIG);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      model: "model-a",
      response: "Answer A",
      responseTimeMs: 100,
    });
    expect(mockQueryModelsParallel).toHaveBeenCalledWith(
      ["model-a", "model-b", "model-c"],
      "test question",
      5000
    );
  });

  it("excludes failed models (returned null from queryModelsParallel)", async () => {
    const mockResults = new Map([
      ["model-a", { content: "Answer A", responseTimeMs: 100 }],
      // model-b and model-c failed — not in the map
    ]);
    mockQueryModelsParallel.mockResolvedValue(mockResults);

    const results = await stage1Collect("test", TEST_CONFIG);
    expect(results).toHaveLength(1);
    expect(results[0].model).toBe("model-a");
  });

  it("returns empty array when all models fail", async () => {
    mockQueryModelsParallel.mockResolvedValue(new Map());

    const results = await stage1Collect("test", TEST_CONFIG);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stage 2
// ---------------------------------------------------------------------------

describe("stage2Rank", () => {
  const stage1Results = [
    { model: "model-a", response: "Answer A", responseTimeMs: 100 },
    { model: "model-b", response: "Answer B", responseTimeMs: 200 },
  ];

  it("returns rankings and metadata with label map", async () => {
    const mockResults = new Map([
      [
        "model-a",
        {
          content:
            "Eval text...\n\nFINAL RANKING:\n1. Response B\n2. Response A",
          responseTimeMs: 500,
        },
      ],
      [
        "model-b",
        {
          content:
            "Eval text...\n\nFINAL RANKING:\n1. Response A\n2. Response B",
          responseTimeMs: 600,
        },
      ],
    ]);
    mockQueryModelsParallel.mockResolvedValue(mockResults);

    const { rankings, metadata } = await stage2Rank(
      "test",
      stage1Results,
      TEST_CONFIG
    );

    expect(rankings).toHaveLength(2);
    expect(rankings[0].parsedRanking).toHaveLength(2);

    // Label map should map Response A → model-a, Response B → model-b
    expect(metadata.labelToModel["Response A"]).toBe("model-a");
    expect(metadata.labelToModel["Response B"]).toBe("model-b");

    // Aggregate rankings should be calculated
    expect(metadata.aggregateRankings).toHaveLength(2);
  });

  it("handles models that fail to return rankings", async () => {
    mockQueryModelsParallel.mockResolvedValue(new Map());

    const { rankings, metadata } = await stage2Rank(
      "test",
      stage1Results,
      TEST_CONFIG
    );

    expect(rankings).toEqual([]);
    expect(metadata.aggregateRankings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stage 3
// ---------------------------------------------------------------------------

describe("stage3Synthesize", () => {
  it("returns chairman synthesis", async () => {
    mockQueryModel.mockResolvedValue({
      content: "Final synthesized answer",
      responseTimeMs: 1000,
    });

    const result = await stage3Synthesize(
      "test",
      [{ model: "m1", response: "r1", responseTimeMs: 100 }],
      [
        {
          model: "m1",
          rankingText: "ranking",
          parsedRanking: [],
        },
      ],
      TEST_CONFIG
    );

    expect(result.model).toBe("chairman-model");
    expect(result.response).toBe("Final synthesized answer");
    expect(result.responseTimeMs).toBe(1000);
  });

  it("returns error message when chairman fails", async () => {
    mockQueryModel.mockResolvedValue(null);

    const result = await stage3Synthesize("test", [], [], TEST_CONFIG);

    expect(result.model).toBe("chairman-model");
    expect(result.response).toContain("Error");
    expect(result.responseTimeMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Title generation
// ---------------------------------------------------------------------------

describe("generateTitle", () => {
  it("returns generated title", async () => {
    mockQueryModel.mockResolvedValue({
      content: "Quantum Computing Basics",
      responseTimeMs: 200,
    });

    const title = await generateTitle("What is quantum computing?");
    expect(title).toBe("Quantum Computing Basics");
  });

  it("strips surrounding quotes", async () => {
    mockQueryModel.mockResolvedValue({
      content: '"Quantum Computing"',
      responseTimeMs: 200,
    });

    const title = await generateTitle("test");
    expect(title).toBe("Quantum Computing");
  });

  it("truncates long titles", async () => {
    mockQueryModel.mockResolvedValue({
      content: "A".repeat(60),
      responseTimeMs: 200,
    });

    const title = await generateTitle("test");
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title).toContain("...");
  });

  it("returns fallback when model fails", async () => {
    mockQueryModel.mockResolvedValue(null);

    const title = await generateTitle("test");
    expect(title).toBe("New Conversation");
  });
});

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

describe("runFullCouncil", () => {
  it("returns error result when all stage 1 models fail", async () => {
    mockQueryModelsParallel.mockResolvedValue(new Map());

    const result = await runFullCouncil("test", TEST_CONFIG);

    expect(result.stage1).toEqual([]);
    expect(result.stage3.response).toContain("failed to respond");
  });

  it("runs all three stages successfully", async () => {
    // Stage 1: return 2 responses
    mockQueryModelsParallel
      .mockResolvedValueOnce(
        new Map([
          ["model-a", { content: "Answer A", responseTimeMs: 100 }],
          ["model-b", { content: "Answer B", responseTimeMs: 200 }],
        ])
      )
      // Stage 2: return 2 rankings
      .mockResolvedValueOnce(
        new Map([
          [
            "model-a",
            {
              content: "FINAL RANKING:\n1. Response A\n2. Response B",
              responseTimeMs: 500,
            },
          ],
          [
            "model-b",
            {
              content: "FINAL RANKING:\n1. Response B\n2. Response A",
              responseTimeMs: 600,
            },
          ],
        ])
      );

    // Stage 3: chairman synthesis
    mockQueryModel.mockResolvedValue({
      content: "Synthesized answer",
      responseTimeMs: 1000,
    });

    const result = await runFullCouncil("test question", TEST_CONFIG);

    expect(result.stage1).toHaveLength(2);
    expect(result.stage2).toHaveLength(2);
    expect(result.stage3.response).toBe("Synthesized answer");
    expect(result.stage2Metadata.labelToModel).toHaveProperty("Response A");
    expect(result.stage2Metadata.aggregateRankings.length).toBeGreaterThan(0);
  });
});
