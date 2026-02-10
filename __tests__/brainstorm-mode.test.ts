/**
 * Tests for Brainstorm mode:
 * - parseIdeas
 * - parseClusters
 * - parseScores
 * - aggregateClusterScores
 * - countWords
 * - buildIdeationPrompt
 * - buildClusteringPrompt
 * - buildScoringPrompt
 * - buildRefinementPrompt
 * - DEFAULT_BRAINSTORM_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  parseIdeas,
  parseClusters,
  parseScores,
  aggregateClusterScores,
  countWords,
  buildIdeationPrompt,
  buildClusteringPrompt,
  buildScoringPrompt,
  buildRefinementPrompt,
  DEFAULT_BRAINSTORM_CONFIG,
} from "@/lib/council/modes/brainstorm";
import type {
  BrainstormIdea,
  IdeaCluster,
  ClusterScore,
  PromiseLevel,
} from "@/lib/council/modes/brainstorm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIdeationText(count: number = 5): string {
  return Array.from({ length: count }, (_, i) => {
    const num = i + 1;
    return `IDEA ${num}: Idea Title ${num}
This is the description for idea ${num}. It explains the concept in detail.`;
  }).join("\n\n");
}

function makeIdea(overrides: Partial<BrainstormIdea> = {}): BrainstormIdea {
  return {
    id: "model_0_idea_1",
    sourceModel: "anthropic/claude-opus-4-6",
    sourceLabel: "Model A",
    title: "Default Idea",
    description: "Default description for this idea.",
    ...overrides,
  };
}

function makeCluster(overrides: Partial<IdeaCluster> = {}): IdeaCluster {
  return {
    id: "cluster_1",
    name: "Default Cluster",
    theme: "Default theme",
    promise: "MEDIUM" as PromiseLevel,
    ideaIds: ["model_0_idea_1"],
    ideas: [makeIdea()],
    ...overrides,
  };
}

function makeScore(overrides: Partial<ClusterScore> = {}): ClusterScore {
  return {
    model: "anthropic/claude-opus-4-6",
    clusterId: "cluster_1",
    novelty: 4,
    feasibility: 3,
    impact: 5,
    total: 12,
    ...overrides,
  };
}

function makeClusteringText(clusterCount: number, ideas: BrainstormIdea[]): string {
  const clusters: string[] = [];
  const idsPerCluster = Math.max(1, Math.floor(ideas.length / clusterCount));

  for (let i = 0; i < clusterCount; i++) {
    const start = i * idsPerCluster;
    const end = i === clusterCount - 1 ? ideas.length : start + idsPerCluster;
    const clusterIdeas = ideas.slice(start, end);
    const ideaIdList = clusterIdeas.map((idea) => idea.id).join(", ");
    const promise = i === 0 ? "HIGH" : i === 1 ? "MEDIUM" : "LOW";

    clusters.push(`CLUSTER ${i + 1}: Cluster Name ${i + 1}
Theme: Theme for cluster ${i + 1} explaining the unifying concept.
Promise: ${promise}
Ideas: ${ideaIdList}`);
  }

  return clusters.join("\n\n");
}

function makeScoringText(clusterCount: number): string {
  return Array.from({ length: clusterCount }, (_, i) => {
    const num = i + 1;
    return `Cluster ${num}: Novelty=${Math.min(5, num + 1)} Feasibility=${Math.min(5, num)} Impact=${Math.min(5, num + 2)}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// parseIdeas
// ---------------------------------------------------------------------------

describe("parseIdeas", () => {
  it("parses a 5-idea response", () => {
    const result = parseIdeas(makeIdeationText(5), "model-a", 0);
    expect(result).toHaveLength(5);
  });

  it("parses a 10-idea response", () => {
    const result = parseIdeas(makeIdeationText(10), "model-a", 0);
    expect(result).toHaveLength(10);
  });

  it("generates correct IDs", () => {
    const result = parseIdeas(makeIdeationText(3), "model-a", 2);
    expect(result[0].id).toBe("model_2_idea_1");
    expect(result[1].id).toBe("model_2_idea_2");
    expect(result[2].id).toBe("model_2_idea_3");
  });

  it("extracts titles correctly", () => {
    const result = parseIdeas(makeIdeationText(2), "model-a", 0);
    expect(result[0].title).toBe("Idea Title 1");
    expect(result[1].title).toBe("Idea Title 2");
  });

  it("extracts multi-line descriptions", () => {
    const text = `IDEA 1: Multi-Line Idea
This is line one of the description.
This is line two with more detail.
This is line three with even more.

IDEA 2: Second Idea
Short description.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result[0].description).toContain("line one");
    expect(result[0].description).toContain("line two");
    expect(result[0].description).toContain("line three");
  });

  it("returns empty array for empty input", () => {
    expect(parseIdeas("", "model-a", 0)).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parseIdeas("   \n  ", "model-a", 0)).toEqual([]);
  });

  it("handles case insensitivity", () => {
    const text = `idea 1: Lower Case Title
Description for lower case.

Idea 2: Mixed Case Title
Description for mixed case.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result).toHaveLength(2);
  });

  it("parses a single idea", () => {
    const text = `IDEA 1: Solo Idea
Only one idea was generated.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Solo Idea");
  });

  it("handles missing description gracefully", () => {
    const text = `IDEA 1: Title Only
`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("");
  });

  it("assigns correct sourceLabel based on modelIndex", () => {
    const result0 = parseIdeas(makeIdeationText(1), "model-a", 0);
    expect(result0[0].sourceLabel).toBe("Model A");

    const result1 = parseIdeas(makeIdeationText(1), "model-b", 1);
    expect(result1[0].sourceLabel).toBe("Model B");

    const result2 = parseIdeas(makeIdeationText(1), "model-c", 2);
    expect(result2[0].sourceLabel).toBe("Model C");
  });

  it("assigns sourceModel correctly", () => {
    const result = parseIdeas(makeIdeationText(1), "openai/o3", 0);
    expect(result[0].sourceModel).toBe("openai/o3");
  });

  it("handles extra whitespace around titles", () => {
    const text = `IDEA 1:   Whitespace Title
Description here.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result[0].title).toBe("Whitespace Title");
  });

  it("handles non-sequential idea numbers", () => {
    const text = `IDEA 3: Third Idea
Description for third.

IDEA 7: Seventh Idea
Description for seventh.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("model_0_idea_3");
    expect(result[1].id).toBe("model_0_idea_7");
  });

  it("handles text with preamble before first IDEA", () => {
    const text = `Here are my brainstormed ideas:

IDEA 1: First Real Idea
This is the actual first idea.

IDEA 2: Second Real Idea
This is the second idea.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("First Real Idea");
  });

  it("handles 6th model (Model G label)", () => {
    const result = parseIdeas(makeIdeationText(1), "model-f", 6);
    expect(result[0].sourceLabel).toBe("Model G");
  });

  it("preserves description content without trimming internal whitespace", () => {
    const text = `IDEA 1: My Idea
A description with   extra   internal   spaces.`;

    const result = parseIdeas(text, "model-a", 0);
    expect(result[0].description).toContain("extra   internal   spaces");
  });
});

// ---------------------------------------------------------------------------
// parseClusters
// ---------------------------------------------------------------------------

describe("parseClusters", () => {
  const baseIdeas = Array.from({ length: 10 }, (_, i) =>
    makeIdea({
      id: `model_${Math.floor(i / 5)}_idea_${(i % 5) + 1}`,
      title: `Idea ${i + 1}`,
      sourceModel: `model-${Math.floor(i / 5)}`,
      sourceLabel: `Model ${String.fromCharCode(65 + Math.floor(i / 5))}`,
    })
  );

  it("parses 5 clusters", () => {
    const text = makeClusteringText(5, baseIdeas);
    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(5);
  });

  it("resolves idea IDs to full objects", () => {
    const text = makeClusteringText(2, baseIdeas);
    const { clusters } = parseClusters(text, baseIdeas);
    for (const cluster of clusters) {
      for (const idea of cluster.ideas) {
        expect(idea).toHaveProperty("title");
        expect(idea).toHaveProperty("description");
        expect(idea).toHaveProperty("sourceModel");
      }
    }
  });

  it("tracks unclustered ideas", () => {
    const text = `CLUSTER 1: Only Some
Theme: Only includes first 3 ideas.
Promise: HIGH
Ideas: model_0_idea_1, model_0_idea_2, model_0_idea_3`;

    const { clusters, unclusteredIdeas } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(1);
    expect(unclusteredIdeas.length).toBe(baseIdeas.length - 3);
  });

  it("drops 0-member clusters (unresolvable IDs)", () => {
    const text = `CLUSTER 1: Valid Cluster
Theme: Has valid ideas.
Promise: HIGH
Ideas: model_0_idea_1

CLUSTER 2: Invalid Cluster
Theme: Has no valid ideas.
Promise: LOW
Ideas: nonexistent_id_1, nonexistent_id_2`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].name).toBe("Valid Cluster");
  });

  it("returns empty clusters for empty input", () => {
    const { clusters, unclusteredIdeas } = parseClusters("", baseIdeas);
    expect(clusters).toHaveLength(0);
    expect(unclusteredIdeas).toHaveLength(baseIdeas.length);
  });

  it("handles single cluster", () => {
    const text = `CLUSTER 1: All Ideas
Theme: Everything in one place.
Promise: MEDIUM
Ideas: ${baseIdeas.map((i) => i.id).join(", ")}`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ideas).toHaveLength(baseIdeas.length);
  });

  it("handles case insensitivity in keywords", () => {
    const text = `cluster 1: Mixed Case
theme: This tests case insensitivity.
promise: high
ideas: model_0_idea_1, model_0_idea_2`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].promise).toBe("HIGH");
  });

  it("handles extra whitespace in ID lists", () => {
    const text = `CLUSTER 1: Spaced IDs
Theme: Testing whitespace.
Promise: MEDIUM
Ideas:   model_0_idea_1  ,  model_0_idea_2  ,  model_0_idea_3  `;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ideas).toHaveLength(3);
  });

  it("assigns correct cluster IDs", () => {
    const text = makeClusteringText(3, baseIdeas);
    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters[0].id).toBe("cluster_1");
    expect(clusters[1].id).toBe("cluster_2");
    expect(clusters[2].id).toBe("cluster_3");
  });

  it("extracts cluster names correctly", () => {
    const text = `CLUSTER 1: Creative Solutions
Theme: Innovative approaches.
Promise: HIGH
Ideas: model_0_idea_1`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters[0].name).toBe("Creative Solutions");
  });

  it("extracts theme correctly", () => {
    const text = `CLUSTER 1: Test Cluster
Theme: This is the unifying theme for all member ideas.
Promise: MEDIUM
Ideas: model_0_idea_1`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters[0].theme).toBe(
      "This is the unifying theme for all member ideas."
    );
  });

  it("extracts promise level correctly", () => {
    const text = `CLUSTER 1: High Promise
Theme: Theme here.
Promise: HIGH
Ideas: model_0_idea_1

CLUSTER 2: Low Promise
Theme: Theme here.
Promise: LOW
Ideas: model_0_idea_2`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters[0].promise).toBe("HIGH");
    expect(clusters[1].promise).toBe("LOW");
  });

  it("handles case-insensitive idea ID matching", () => {
    const text = `CLUSTER 1: Case Test
Theme: ID case test.
Promise: HIGH
Ideas: MODEL_0_IDEA_1, Model_0_Idea_2`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].ideas).toHaveLength(2);
  });

  it("stores ideaIds as resolved IDs from the idea map", () => {
    const text = `CLUSTER 1: Test
Theme: Test.
Promise: HIGH
Ideas: model_0_idea_1, model_0_idea_2`;

    const { clusters } = parseClusters(text, baseIdeas);
    expect(clusters[0].ideaIds).toEqual(["model_0_idea_1", "model_0_idea_2"]);
  });
});

// ---------------------------------------------------------------------------
// parseScores
// ---------------------------------------------------------------------------

describe("parseScores", () => {
  const clusterIds = ["cluster_1", "cluster_2", "cluster_3", "cluster_4", "cluster_5"];

  it("parses 5-cluster scores", () => {
    const text = makeScoringText(5);
    const result = parseScores(text, "model-a", clusterIds);
    expect(result).toHaveLength(5);
  });

  it("calculates correct total", () => {
    const text = "Cluster 1: Novelty=4 Feasibility=3 Impact=5";
    const result = parseScores(text, "model-a", clusterIds);
    expect(result[0].total).toBe(12);
  });

  it("clamps values to 1-5 range (high)", () => {
    const text = "Cluster 1: Novelty=9 Feasibility=8 Impact=7";
    const result = parseScores(text, "model-a", clusterIds);
    expect(result[0].novelty).toBe(5);
    expect(result[0].feasibility).toBe(5);
    expect(result[0].impact).toBe(5);
  });

  it("returns empty array for empty input", () => {
    expect(parseScores("", "model-a", clusterIds)).toEqual([]);
  });

  it("maps 1-based cluster index to correct ID", () => {
    const text = "Cluster 3: Novelty=4 Feasibility=3 Impact=5";
    const result = parseScores(text, "model-a", clusterIds);
    expect(result[0].clusterId).toBe("cluster_3");
  });

  it("handles single cluster", () => {
    const text = "Cluster 1: Novelty=5 Feasibility=5 Impact=5";
    const result = parseScores(text, "model-a", ["cluster_1"]);
    expect(result).toHaveLength(1);
    expect(result[0].total).toBe(15);
  });

  it("skips out-of-range cluster index", () => {
    const text = "Cluster 10: Novelty=3 Feasibility=3 Impact=3";
    const result = parseScores(text, "model-a", clusterIds);
    expect(result).toHaveLength(0);
  });

  it("assigns correct model", () => {
    const text = "Cluster 1: Novelty=4 Feasibility=3 Impact=5";
    const result = parseScores(text, "openai/o3", clusterIds);
    expect(result[0].model).toBe("openai/o3");
  });

  it("handles case insensitivity", () => {
    const text = "cluster 1: novelty=4 feasibility=3 impact=5";
    const result = parseScores(text, "model-a", clusterIds);
    expect(result).toHaveLength(1);
  });

  it("handles whitespace-only input", () => {
    expect(parseScores("   \n  ", "model-a", clusterIds)).toEqual([]);
  });

  it("parses multiple scores with extra text around them", () => {
    const text = `Here are my scores:

Cluster 1: Novelty=3 Feasibility=4 Impact=5
Some commentary about cluster 1.

Cluster 2: Novelty=2 Feasibility=5 Impact=3
More commentary here.`;

    const result = parseScores(text, "model-a", clusterIds);
    expect(result).toHaveLength(2);
    expect(result[0].total).toBe(12);
    expect(result[1].total).toBe(10);
  });

  it("skips cluster index 0 (0-based underflow)", () => {
    const text = "Cluster 0: Novelty=3 Feasibility=3 Impact=3";
    const result = parseScores(text, "model-a", clusterIds);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// aggregateClusterScores
// ---------------------------------------------------------------------------

describe("aggregateClusterScores", () => {
  it("aggregates 3 scorers correctly", () => {
    const clusters = [makeCluster({ id: "cluster_1" })];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", novelty: 3, feasibility: 4, impact: 5, total: 12 }),
      makeScore({ model: "m2", clusterId: "cluster_1", novelty: 5, feasibility: 2, impact: 3, total: 10 }),
      makeScore({ model: "m3", clusterId: "cluster_1", novelty: 4, feasibility: 3, impact: 4, total: 11 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result).toHaveLength(1);
    expect(result[0].averageScore).toBe(11);
    expect(result[0].averageNovelty).toBe(4);
    expect(result[0].averageFeasibility).toBe(3);
    expect(result[0].averageImpact).toBe(4);
  });

  it("handles single scorer", () => {
    const clusters = [makeCluster({ id: "cluster_1" })];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", novelty: 4, feasibility: 3, impact: 5, total: 12 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].averageScore).toBe(12);
  });

  it("handles tied scores between clusters", () => {
    const clusters = [
      makeCluster({ id: "cluster_1", name: "Cluster A" }),
      makeCluster({ id: "cluster_2", name: "Cluster B" }),
    ];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", novelty: 4, feasibility: 4, impact: 4, total: 12 }),
      makeScore({ model: "m1", clusterId: "cluster_2", novelty: 4, feasibility: 4, impact: 4, total: 12 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].averageScore).toBe(12);
    expect(result[1].averageScore).toBe(12);
  });

  it("sorts clusters descending by averageScore", () => {
    const clusters = [
      makeCluster({ id: "cluster_1", name: "Low" }),
      makeCluster({ id: "cluster_2", name: "High" }),
      makeCluster({ id: "cluster_3", name: "Mid" }),
    ];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", total: 6, novelty: 2, feasibility: 2, impact: 2 }),
      makeScore({ model: "m1", clusterId: "cluster_2", total: 14, novelty: 5, feasibility: 5, impact: 4 }),
      makeScore({ model: "m1", clusterId: "cluster_3", total: 10, novelty: 3, feasibility: 4, impact: 3 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].name).toBe("High");
    expect(result[1].name).toBe("Mid");
    expect(result[2].name).toBe("Low");
  });

  it("attaches score arrays to clusters", () => {
    const clusters = [makeCluster({ id: "cluster_1" })];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1" }),
      makeScore({ model: "m2", clusterId: "cluster_1" }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].scores).toHaveLength(2);
  });

  it("returns empty array for empty clusters", () => {
    const result = aggregateClusterScores([], []);
    expect(result).toEqual([]);
  });

  it("preserves cluster properties", () => {
    const clusters = [
      makeCluster({
        id: "cluster_1",
        name: "Preserved Name",
        theme: "Preserved Theme",
        promise: "HIGH",
      }),
    ];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1" }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].name).toBe("Preserved Name");
    expect(result[0].theme).toBe("Preserved Theme");
    expect(result[0].promise).toBe("HIGH");
  });

  it("handles clusters with no matching scores", () => {
    const clusters = [makeCluster({ id: "cluster_1" })];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_99" }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].averageScore).toBe(0);
    expect(result[0].scores).toEqual([]);
  });

  it("rounds averages to 2 decimal places", () => {
    const clusters = [makeCluster({ id: "cluster_1" })];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", novelty: 3, feasibility: 3, impact: 3, total: 9 }),
      makeScore({ model: "m2", clusterId: "cluster_1", novelty: 4, feasibility: 4, impact: 4, total: 12 }),
      makeScore({ model: "m3", clusterId: "cluster_1", novelty: 5, feasibility: 5, impact: 5, total: 15 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].averageScore).toBe(12);
    expect(result[0].averageNovelty).toBe(4);
    expect(result[0].averageFeasibility).toBe(4);
    expect(result[0].averageImpact).toBe(4);
  });

  it("handles multiple clusters with different scorer coverage", () => {
    const clusters = [
      makeCluster({ id: "cluster_1", name: "Full" }),
      makeCluster({ id: "cluster_2", name: "Partial" }),
    ];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", total: 12, novelty: 4, feasibility: 4, impact: 4 }),
      makeScore({ model: "m2", clusterId: "cluster_1", total: 10, novelty: 3, feasibility: 3, impact: 4 }),
      makeScore({ model: "m1", clusterId: "cluster_2", total: 8, novelty: 2, feasibility: 3, impact: 3 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].scores).toHaveLength(2);
    expect(result[1].scores).toHaveLength(1);
  });

  it("correctly averages non-round numbers", () => {
    const clusters = [makeCluster({ id: "cluster_1" })];
    const scores = [
      makeScore({ model: "m1", clusterId: "cluster_1", novelty: 3, feasibility: 4, impact: 5, total: 12 }),
      makeScore({ model: "m2", clusterId: "cluster_1", novelty: 5, feasibility: 3, impact: 4, total: 12 }),
      makeScore({ model: "m3", clusterId: "cluster_1", novelty: 4, feasibility: 5, impact: 3, total: 12 }),
    ];

    const result = aggregateClusterScores(clusters, scores);
    expect(result[0].averageScore).toBe(12);
    expect(result[0].averageNovelty).toBe(4);
    expect(result[0].averageFeasibility).toBe(4);
    expect(result[0].averageImpact).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe("countWords", () => {
  it("counts normal text", () => {
    expect(countWords("hello world foo bar")).toBe(4);
  });

  it("handles multi-space separators", () => {
    expect(countWords("hello   world   foo")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("handles newlines and tabs", () => {
    expect(countWords("hello\nworld\tfoo")).toBe(3);
  });

  it("handles single word", () => {
    expect(countWords("hello")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildIdeationPrompt
// ---------------------------------------------------------------------------

describe("buildIdeationPrompt", () => {
  it("contains the user query", () => {
    const prompt = buildIdeationPrompt("How to improve city parks?", 5);
    expect(prompt).toContain("How to improve city parks?");
  });

  it("contains minIdeas count", () => {
    const prompt = buildIdeationPrompt("Test query", 7);
    expect(prompt).toContain("7");
  });

  it("contains format instructions", () => {
    const prompt = buildIdeationPrompt("Test query", 5);
    expect(prompt).toContain("IDEA 1:");
    expect(prompt).toContain("IDEA 2:");
  });

  it("contains diversity rules", () => {
    const prompt = buildIdeationPrompt("Test query", 5);
    expect(prompt).toContain("Diversity");
    expect(prompt).toContain("self-censoring");
  });

  it("contains quantity emphasis", () => {
    const prompt = buildIdeationPrompt("Test query", 5);
    expect(prompt).toContain("Quantity");
  });

  it("mentions upper bound of 10 ideas", () => {
    const prompt = buildIdeationPrompt("Test query", 5);
    expect(prompt).toContain("10");
  });
});

// ---------------------------------------------------------------------------
// buildClusteringPrompt
// ---------------------------------------------------------------------------

describe("buildClusteringPrompt", () => {
  const ideas = [
    makeIdea({ id: "model_0_idea_1", title: "First Idea", sourceLabel: "Model A" }),
    makeIdea({ id: "model_0_idea_2", title: "Second Idea", sourceLabel: "Model A" }),
    makeIdea({ id: "model_1_idea_1", title: "Third Idea", sourceModel: "model-b", sourceLabel: "Model B" }),
  ];

  it("contains the user query", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("Test query");
  });

  it("contains total idea count", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("3 ideas");
  });

  it("contains model count", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("2 different AI models");
  });

  it("lists all ideas with IDs", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("[model_0_idea_1]");
    expect(prompt).toContain("[model_0_idea_2]");
    expect(prompt).toContain("[model_1_idea_1]");
  });

  it("contains maxClusters", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 4);
    expect(prompt).toContain("3 to 4");
  });

  it("contains format instructions", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("CLUSTER 1:");
    expect(prompt).toContain("Theme:");
    expect(prompt).toContain("Promise:");
    expect(prompt).toContain("Ideas:");
  });

  it("includes idea titles in the listing", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("First Idea");
    expect(prompt).toContain("Second Idea");
    expect(prompt).toContain("Third Idea");
  });

  it("includes source labels", () => {
    const prompt = buildClusteringPrompt("Test query", ideas, 6);
    expect(prompt).toContain("Model A");
    expect(prompt).toContain("Model B");
  });
});

// ---------------------------------------------------------------------------
// buildScoringPrompt
// ---------------------------------------------------------------------------

describe("buildScoringPrompt", () => {
  const clusters = [
    makeCluster({
      id: "cluster_1",
      name: "Innovation Cluster",
      theme: "Creative solutions",
      ideas: [makeIdea({ title: "Idea A" }), makeIdea({ title: "Idea B" })],
    }),
    makeCluster({
      id: "cluster_2",
      name: "Practical Cluster",
      theme: "Real-world applications",
      ideas: [makeIdea({ title: "Idea C" })],
    }),
  ];

  it("contains the user query", () => {
    const prompt = buildScoringPrompt("Test query", clusters);
    expect(prompt).toContain("Test query");
  });

  it("lists clusters with names", () => {
    const prompt = buildScoringPrompt("Test query", clusters);
    expect(prompt).toContain("Innovation Cluster");
    expect(prompt).toContain("Practical Cluster");
  });

  it("contains scoring dimensions", () => {
    const prompt = buildScoringPrompt("Test query", clusters);
    expect(prompt).toContain("Novelty");
    expect(prompt).toContain("Feasibility");
    expect(prompt).toContain("Impact");
  });

  it("contains format instructions", () => {
    const prompt = buildScoringPrompt("Test query", clusters);
    expect(prompt).toContain("Cluster 1:");
    expect(prompt).toContain("Cluster 2:");
    expect(prompt).toContain("Novelty=N");
  });

  it("includes cluster count", () => {
    const prompt = buildScoringPrompt("Test query", clusters);
    expect(prompt).toContain("2 idea clusters");
  });
});

// ---------------------------------------------------------------------------
// buildRefinementPrompt
// ---------------------------------------------------------------------------

describe("buildRefinementPrompt", () => {
  const winningCluster = makeCluster({
    id: "cluster_1",
    name: "Winning Ideas",
    theme: "The best direction",
    averageScore: 13.5,
    averageNovelty: 4.5,
    averageFeasibility: 4.0,
    averageImpact: 5.0,
    ideas: [
      makeIdea({ title: "Top Idea 1", description: "First winning idea." }),
      makeIdea({ title: "Top Idea 2", description: "Second winning idea." }),
    ],
  });

  it("contains the user query", () => {
    const prompt = buildRefinementPrompt("Test query", winningCluster);
    expect(prompt).toContain("Test query");
  });

  it("contains cluster info", () => {
    const prompt = buildRefinementPrompt("Test query", winningCluster);
    expect(prompt).toContain("Winning Ideas");
    expect(prompt).toContain("The best direction");
  });

  it("contains avg scores", () => {
    const prompt = buildRefinementPrompt("Test query", winningCluster);
    expect(prompt).toContain("13.5");
    expect(prompt).toContain("4.5");
    expect(prompt).toContain("4");
    expect(prompt).toContain("5");
  });

  it("lists member ideas", () => {
    const prompt = buildRefinementPrompt("Test query", winningCluster);
    expect(prompt).toContain("Top Idea 1");
    expect(prompt).toContain("Top Idea 2");
  });

  it("contains proposal sections", () => {
    const prompt = buildRefinementPrompt("Test query", winningCluster);
    expect(prompt).toContain("EXECUTIVE SUMMARY");
    expect(prompt).toContain("IMPLEMENTATION PLAN");
    expect(prompt).toContain("RISKS AND MITIGATIONS");
    expect(prompt).toContain("NEXT STEPS");
  });

  it("includes tied clusters when provided", () => {
    const tiedCluster = makeCluster({
      id: "cluster_2",
      name: "Tied Runner Up",
      theme: "Almost as good",
      averageScore: 13.5,
      ideas: [makeIdea({ title: "Runner Up Idea" })],
    });

    const prompt = buildRefinementPrompt("Test query", winningCluster, [
      winningCluster,
      tiedCluster,
    ]);
    expect(prompt).toContain("Tied Runner Up");
    expect(prompt).toContain("Runner Up Idea");
    expect(prompt).toContain("tied with the winning cluster");
  });

  it("does not include tied block when no ties", () => {
    const prompt = buildRefinementPrompt("Test query", winningCluster);
    expect(prompt).not.toContain("tied with the winning cluster");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_BRAINSTORM_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_BRAINSTORM_CONFIG", () => {
  it("has 3 default models", () => {
    expect(DEFAULT_BRAINSTORM_CONFIG.models).toHaveLength(3);
  });

  it("includes claude-opus-4-6 as curator model", () => {
    expect(DEFAULT_BRAINSTORM_CONFIG.curatorModel).toBe(
      "anthropic/claude-opus-4-6"
    );
  });

  it("includes claude-opus-4-6 as refiner model", () => {
    expect(DEFAULT_BRAINSTORM_CONFIG.refinerModel).toBe(
      "anthropic/claude-opus-4-6"
    );
  });

  it("has correct default minIdeasPerModel", () => {
    expect(DEFAULT_BRAINSTORM_CONFIG.minIdeasPerModel).toBe(5);
  });

  it("has correct default maxClusters", () => {
    expect(DEFAULT_BRAINSTORM_CONFIG.maxClusters).toBe(6);
  });

  it("has correct default timeoutMs", () => {
    expect(DEFAULT_BRAINSTORM_CONFIG.timeoutMs).toBe(120_000);
  });
});
