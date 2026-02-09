import { describe, it, expect } from "vitest";
import {
  buildRankingPrompt,
  buildSynthesisPrompt,
  buildTitlePrompt,
} from "@/lib/council/prompts";

describe("buildRankingPrompt", () => {
  it("includes the user query", () => {
    const prompt = buildRankingPrompt({
      userQuery: "What is quantum computing?",
      labeledResponses: [
        { label: "Response A", response: "It uses qubits..." },
      ],
    });
    expect(prompt).toContain("What is quantum computing?");
  });

  it("includes all labeled responses", () => {
    const prompt = buildRankingPrompt({
      userQuery: "test",
      labeledResponses: [
        { label: "Response A", response: "Answer from A" },
        { label: "Response B", response: "Answer from B" },
        { label: "Response C", response: "Answer from C" },
      ],
    });

    expect(prompt).toContain("Response A:\nAnswer from A");
    expect(prompt).toContain("Response B:\nAnswer from B");
    expect(prompt).toContain("Response C:\nAnswer from C");
  });

  it("includes FINAL RANKING instruction", () => {
    const prompt = buildRankingPrompt({
      userQuery: "test",
      labeledResponses: [
        { label: "Response A", response: "answer" },
      ],
    });
    expect(prompt).toContain("FINAL RANKING:");
  });

  it("includes example format", () => {
    const prompt = buildRankingPrompt({
      userQuery: "test",
      labeledResponses: [
        { label: "Response A", response: "answer" },
      ],
    });
    expect(prompt).toContain("1. Response C");
    expect(prompt).toContain("2. Response A");
    expect(prompt).toContain("3. Response B");
  });
});

describe("buildSynthesisPrompt", () => {
  it("includes the user query", () => {
    const prompt = buildSynthesisPrompt({
      userQuery: "Explain gravity",
      stage1Results: [
        { model: "gpt-4o", response: "Gravity is...", responseTimeMs: 100 },
      ],
      stage2Results: [
        {
          model: "gpt-4o",
          rankingText: "FINAL RANKING:\n1. Response A",
          parsedRanking: [{ label: "Response A", position: 1 }],
        },
      ],
    });
    expect(prompt).toContain("Explain gravity");
  });

  it("includes stage 1 responses with model names", () => {
    const prompt = buildSynthesisPrompt({
      userQuery: "test",
      stage1Results: [
        { model: "openai/gpt-4o", response: "GPT answer", responseTimeMs: 50 },
        { model: "anthropic/claude-sonnet-4", response: "Claude answer", responseTimeMs: 60 },
      ],
      stage2Results: [],
    });

    expect(prompt).toContain("Model: openai/gpt-4o");
    expect(prompt).toContain("Response: GPT answer");
    expect(prompt).toContain("Model: anthropic/claude-sonnet-4");
    expect(prompt).toContain("Response: Claude answer");
  });

  it("includes stage 2 rankings", () => {
    const prompt = buildSynthesisPrompt({
      userQuery: "test",
      stage1Results: [],
      stage2Results: [
        {
          model: "openai/gpt-4o",
          rankingText: "Response A is best...",
          parsedRanking: [],
        },
      ],
    });

    expect(prompt).toContain("Ranking: Response A is best...");
  });

  it("describes the chairman role", () => {
    const prompt = buildSynthesisPrompt({
      userQuery: "test",
      stage1Results: [],
      stage2Results: [],
    });
    expect(prompt).toContain("Chairman");
    expect(prompt).toContain("synthesize");
  });
});

describe("buildTitlePrompt", () => {
  it("includes the user query", () => {
    const prompt = buildTitlePrompt("How does photosynthesis work?");
    expect(prompt).toContain("How does photosynthesis work?");
  });

  it("requests 3-5 word title", () => {
    const prompt = buildTitlePrompt("test");
    expect(prompt).toContain("3-5 words");
  });

  it("requests no quotes or punctuation", () => {
    const prompt = buildTitlePrompt("test");
    expect(prompt).toContain("Do not use quotes");
  });
});
