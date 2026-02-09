/**
 * Ranking parser — extracts structured rankings from LLM evaluation text.
 *
 * Models are instructed to end their evaluation with a "FINAL RANKING:" section
 * containing a numbered list like:
 *   1. Response A
 *   2. Response C
 *   3. Response B
 *
 * This module extracts that section and converts it to RankingEntry[].
 */

import type { RankingEntry, AggregateRanking, LabelMap } from "./types";

/**
 * Parse the FINAL RANKING section from an LLM's evaluation text.
 *
 * @param text - Full evaluation text from the ranking model
 * @returns Ordered list of RankingEntry (position 1 = best)
 */
export function parseRanking(text: string): RankingEntry[] {
  if (!text) return [];

  // Look for the "FINAL RANKING:" marker (case-insensitive)
  const markerIndex = text.toUpperCase().indexOf("FINAL RANKING:");
  if (markerIndex !== -1) {
    const rankingSection = text.slice(markerIndex + "FINAL RANKING:".length);

    // Match numbered entries: "1. Response A", "2. Response B", etc.
    const numberedMatches = rankingSection.match(
      /\d+\.\s*Response\s+[A-Z]/g
    );
    if (numberedMatches && numberedMatches.length > 0) {
      return numberedMatches.map((match, index) => {
        const labelMatch = match.match(/Response\s+[A-Z]/);
        return {
          label: labelMatch ? labelMatch[0] : match,
          position: index + 1,
        };
      });
    }

    // Fallback: extract all "Response X" patterns in order from the section
    const fallbackMatches = rankingSection.match(/Response\s+[A-Z]/g);
    if (fallbackMatches && fallbackMatches.length > 0) {
      return fallbackMatches.map((label, index) => ({
        label,
        position: index + 1,
      }));
    }
  }

  // Last resort: find any "Response X" patterns in the entire text
  const globalMatches = text.match(/Response\s+[A-Z]/g);
  if (globalMatches && globalMatches.length > 0) {
    return globalMatches.map((label, index) => ({
      label,
      position: index + 1,
    }));
  }

  return [];
}

/**
 * Calculate aggregate rankings across all evaluator models.
 *
 * Each evaluator provides a ranking. We average the positions to produce
 * a consensus ranking (lower average = better).
 *
 * @param rankings - Parsed rankings from each evaluator model
 * @param labelToModel - Mapping from anonymous labels to model identifiers
 * @returns Sorted list of AggregateRanking (best first)
 */
export function calculateAggregateRankings(
  rankings: RankingEntry[][],
  labelToModel: LabelMap
): AggregateRanking[] {
  const positionsByModel: Record<string, number[]> = {};

  for (const ranking of rankings) {
    for (const entry of ranking) {
      const model = labelToModel[entry.label];
      if (model) {
        if (!positionsByModel[model]) {
          positionsByModel[model] = [];
        }
        positionsByModel[model].push(entry.position);
      }
    }
  }

  const aggregate: AggregateRanking[] = Object.entries(positionsByModel).map(
    ([model, positions]) => ({
      model,
      averageRank: Math.round(
        (positions.reduce((sum, p) => sum + p, 0) / positions.length) * 100
      ) / 100,
      rankingsCount: positions.length,
    })
  );

  // Sort by average rank (lower is better)
  aggregate.sort((a, b) => a.averageRank - b.averageRank);

  return aggregate;
}

/**
 * Create an anonymous label map for a set of models.
 *
 * @param models - Ordered list of model identifiers
 * @returns LabelMap mapping "Response A", "Response B", etc. to model names
 */
export function createLabelMap(models: string[]): LabelMap {
  const map: LabelMap = {};
  for (let i = 0; i < models.length; i++) {
    const label = `Response ${String.fromCharCode(65 + i)}`;
    map[label] = models[i];
  }
  return map;
}
