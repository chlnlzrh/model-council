/**
 * Brainstorm Mode — Quantity-first creative exploration with clustering and scoring.
 *
 * Pipeline:
 *   Phase 1 (Ideate):   Parallel — each model generates diverse ideas
 *   Phase 2 (Cluster):  Sequential — curator groups ideas into thematic clusters
 *   Phase 3 (Score):    Parallel — scorers rate clusters on Novelty/Feasibility/Impact
 *   Phase 4 (Refine):   Sequential — refiner develops the top cluster into a full proposal
 *
 * See docs/modes/14-brainstorm.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel, queryModelsParallel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromiseLevel = "HIGH" | "MEDIUM" | "LOW";

export interface BrainstormIdea {
  id: string;
  sourceModel: string;
  sourceLabel: string;
  title: string;
  description: string;
}

export interface ClusterScore {
  model: string;
  clusterId: string;
  novelty: number;
  feasibility: number;
  impact: number;
  total: number;
}

export interface IdeaCluster {
  id: string;
  name: string;
  theme: string;
  promise: PromiseLevel;
  ideaIds: string[];
  ideas: BrainstormIdea[];
  scores?: ClusterScore[];
  averageScore?: number;
  averageNovelty?: number;
  averageFeasibility?: number;
  averageImpact?: number;
}

export interface BrainstormConfig {
  models: string[];
  curatorModel: string;
  refinerModel: string;
  minIdeasPerModel: number;
  maxClusters: number;
  timeoutMs: number;
}

export interface BrainstormResult {
  ideation: BrainstormIdea[][];
  totalIdeas: number;
  clustering: IdeaCluster[];
  scoring: ClusterScore[];
  refinement: string;
  title?: string;
}

export const DEFAULT_BRAINSTORM_CONFIG: BrainstormConfig = {
  models: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  curatorModel: "anthropic/claude-opus-4-6",
  refinerModel: "anthropic/claude-opus-4-6",
  minIdeasPerModel: 5,
  maxClusters: 6,
  timeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// Pure Functions — Parsers & Utilities
// ---------------------------------------------------------------------------

/**
 * Parse structured idea text from a model's ideation response.
 *
 * Expects format:
 *   IDEA 1: Title here
 *   Description text spanning one or more lines
 *
 * IDs are generated as `model_{modelIndex}_idea_{num}`.
 * Labels follow Model A, Model B, etc.
 */
export function parseIdeas(
  text: string,
  model: string,
  modelIndex: number
): BrainstormIdea[] {
  if (!text || !text.trim()) return [];

  const ideas: BrainstormIdea[] = [];
  const label = `Model ${String.fromCharCode(65 + modelIndex)}`;

  const blocks = text.matchAll(
    /IDEA\s+(\d+):\s*(.+)\n([\s\S]*?)(?=IDEA\s+\d+:|$)/gi
  );

  for (const match of blocks) {
    const num = parseInt(match[1], 10);
    const title = match[2].trim();
    const description = match[3].trim();

    ideas.push({
      id: `model_${modelIndex}_idea_${num}`,
      sourceModel: model,
      sourceLabel: label,
      title,
      description,
    });
  }

  return ideas;
}

/**
 * Parse cluster assignments from the curator's response.
 *
 * Expects format:
 *   CLUSTER 1: Cluster Name
 *   Theme: Description of the theme
 *   Promise: HIGH|MEDIUM|LOW
 *   Ideas: model_0_idea_1, model_1_idea_3, ...
 *
 * Resolves idea IDs to full BrainstormIdea objects.
 * Drops clusters with 0 resolved members.
 * Tracks unclustered ideas.
 */
export function parseClusters(
  text: string,
  allIdeas: BrainstormIdea[]
): { clusters: IdeaCluster[]; unclusteredIdeas: BrainstormIdea[] } {
  if (!text || !text.trim()) {
    return { clusters: [], unclusteredIdeas: [...allIdeas] };
  }

  // Build lookup map (normalize to lowercase + trim)
  const ideaMap = new Map<string, BrainstormIdea>();
  for (const idea of allIdeas) {
    ideaMap.set(idea.id.toLowerCase().trim(), idea);
  }

  const clusters: IdeaCluster[] = [];
  const assignedIds = new Set<string>();

  const clusterBlocks = text.matchAll(
    /CLUSTER\s+(\d+):\s*(.+)\nTheme:\s*(.+)\nPromise:\s*(HIGH|MEDIUM|LOW)\nIdeas:\s*(.+)/gi
  );

  for (const match of clusterBlocks) {
    const num = parseInt(match[1], 10);
    const name = match[2].trim();
    const theme = match[3].trim();
    const promise = match[4].toUpperCase() as PromiseLevel;
    const rawIds = match[5].split(/,\s*/).map((id) => id.trim().toLowerCase());

    // Resolve idea IDs to full objects
    const resolvedIds: string[] = [];
    const resolvedIdeas: BrainstormIdea[] = [];

    for (const rawId of rawIds) {
      const idea = ideaMap.get(rawId);
      if (idea) {
        resolvedIds.push(idea.id);
        resolvedIdeas.push(idea);
        assignedIds.add(idea.id.toLowerCase().trim());
      }
    }

    // Drop 0-member clusters
    if (resolvedIdeas.length === 0) continue;

    clusters.push({
      id: `cluster_${num}`,
      name,
      theme,
      promise,
      ideaIds: resolvedIds,
      ideas: resolvedIdeas,
    });
  }

  // Track unclustered ideas
  const unclusteredIdeas = allIdeas.filter(
    (idea) => !assignedIds.has(idea.id.toLowerCase().trim())
  );

  return { clusters, unclusteredIdeas };
}

/**
 * Parse cluster scores from a scorer's response.
 *
 * Expects format:
 *   Cluster 1: Novelty=4 Feasibility=3 Impact=5
 *
 * Clamps values to 1-5. Maps index to cluster IDs.
 * Skips entries with out-of-range cluster indices.
 */
export function parseScores(
  text: string,
  model: string,
  clusterIds: string[]
): ClusterScore[] {
  if (!text || !text.trim()) return [];

  const scores: ClusterScore[] = [];

  const scoreBlocks = text.matchAll(
    /Cluster\s+(\d+):\s*Novelty=(\d)\s*Feasibility=(\d)\s*Impact=(\d)/gi
  );

  for (const match of scoreBlocks) {
    const clusterIndex = parseInt(match[1], 10) - 1; // Convert 1-based to 0-based
    if (clusterIndex < 0 || clusterIndex >= clusterIds.length) continue;

    const novelty = Math.max(1, Math.min(5, parseInt(match[2], 10)));
    const feasibility = Math.max(1, Math.min(5, parseInt(match[3], 10)));
    const impact = Math.max(1, Math.min(5, parseInt(match[4], 10)));

    scores.push({
      model,
      clusterId: clusterIds[clusterIndex],
      novelty,
      feasibility,
      impact,
      total: novelty + feasibility + impact,
    });
  }

  return scores;
}

/**
 * Aggregate scores across all scorers for each cluster.
 * Computes average novelty, feasibility, impact, and total per cluster.
 * Sorts clusters descending by averageScore.
 */
export function aggregateClusterScores(
  clusters: IdeaCluster[],
  allScores: ClusterScore[]
): IdeaCluster[] {
  if (clusters.length === 0) return [];

  return clusters
    .map((cluster) => {
      const clusterScores = allScores.filter(
        (s) => s.clusterId === cluster.id
      );

      if (clusterScores.length === 0) {
        return {
          ...cluster,
          scores: [],
          averageScore: 0,
          averageNovelty: 0,
          averageFeasibility: 0,
          averageImpact: 0,
        };
      }

      const avgNovelty =
        clusterScores.reduce((sum, s) => sum + s.novelty, 0) /
        clusterScores.length;
      const avgFeasibility =
        clusterScores.reduce((sum, s) => sum + s.feasibility, 0) /
        clusterScores.length;
      const avgImpact =
        clusterScores.reduce((sum, s) => sum + s.impact, 0) /
        clusterScores.length;
      const avgScore =
        clusterScores.reduce((sum, s) => sum + s.total, 0) /
        clusterScores.length;

      return {
        ...cluster,
        scores: clusterScores,
        averageScore: Math.round(avgScore * 100) / 100,
        averageNovelty: Math.round(avgNovelty * 100) / 100,
        averageFeasibility: Math.round(avgFeasibility * 100) / 100,
        averageImpact: Math.round(avgImpact * 100) / 100,
      };
    })
    .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));
}

/**
 * Count words in a text string.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Prompt Builders
// ---------------------------------------------------------------------------

/**
 * Build the ideation prompt for each model.
 */
export function buildIdeationPrompt(
  userQuery: string,
  minIdeas: number
): string {
  return `You are a creative brainstorming expert. Generate ${minIdeas} to 10 diverse, original ideas in response to the following question or challenge.

QUESTION/CHALLENGE:
${userQuery}

For each idea, provide:
- A clear, concise title
- A 2-4 sentence description explaining the idea and why it could work

IMPORTANT RULES:
1. Quantity matters — generate at least ${minIdeas} ideas.
2. Diversity is key — explore different angles, approaches, and perspectives.
3. No self-censoring — include bold, unconventional, and even seemingly impractical ideas.
4. Each idea should be distinct, not a minor variation of another.
5. Think across domains — borrow concepts from unrelated fields.

Format each idea exactly as:

IDEA 1: [Title]
[Description]

IDEA 2: [Title]
[Description]

...and so on.`;
}

/**
 * Build the clustering prompt for the curator model.
 */
export function buildClusteringPrompt(
  userQuery: string,
  allIdeas: BrainstormIdea[],
  maxClusters: number
): string {
  const ideaList = allIdeas
    .map(
      (idea) =>
        `[${idea.id}] ${idea.title} — ${idea.description} (from ${idea.sourceLabel})`
    )
    .join("\n\n");

  const modelCount = new Set(allIdeas.map((i) => i.sourceModel)).size;

  return `You are a creative strategist tasked with organizing brainstormed ideas into thematic clusters.

ORIGINAL QUESTION/CHALLENGE:
${userQuery}

Below are ${allIdeas.length} ideas generated by ${modelCount} different AI models. Group them into 3 to ${maxClusters} thematic clusters based on shared approaches, principles, or domains.

IDEAS:
${ideaList}

For each cluster, provide:
- A descriptive name
- The unifying theme (1-2 sentences)
- Promise level: HIGH, MEDIUM, or LOW (how promising is this direction?)
- List of idea IDs belonging to this cluster

IMPORTANT RULES:
1. Every idea should belong to exactly one cluster.
2. Clusters should represent genuinely different strategic directions.
3. Aim for 3 to ${maxClusters} clusters — merge similar ideas, separate distinct approaches.
4. Use the exact idea IDs as listed (e.g., model_0_idea_1).

Format each cluster exactly as:

CLUSTER 1: [Cluster Name]
Theme: [Unifying theme description]
Promise: [HIGH|MEDIUM|LOW]
Ideas: [comma-separated list of idea IDs]

CLUSTER 2: [Cluster Name]
Theme: [Unifying theme description]
Promise: [HIGH|MEDIUM|LOW]
Ideas: [comma-separated list of idea IDs]

...and so on.

After all clusters, provide:

CLUSTERING SUMMARY:
Total clusters: [count]
Total ideas assigned: [count]
Highest promise cluster: [cluster name]`;
}

/**
 * Build the scoring prompt for each scorer model.
 */
export function buildScoringPrompt(
  userQuery: string,
  clusters: IdeaCluster[]
): string {
  const clusterList = clusters
    .map((cluster, idx) => {
      const ideaList = cluster.ideas
        .map((idea) => `  - ${idea.title}: ${idea.description}`)
        .join("\n");
      return `Cluster ${idx + 1}: ${cluster.name}
Theme: ${cluster.theme}
Ideas:\n${ideaList}`;
    })
    .join("\n\n");

  return `You are evaluating brainstormed idea clusters for a creative challenge.

ORIGINAL QUESTION/CHALLENGE:
${userQuery}

Below are ${clusters.length} idea clusters. Score each on three dimensions (1-5 scale):
- Novelty: How original and creative is this direction? (1=obvious, 5=groundbreaking)
- Feasibility: How practical and implementable? (1=impossible, 5=straightforward)
- Impact: How significant would the outcome be? (1=minimal, 5=transformative)

CLUSTERS:
${clusterList}

Score each cluster using exactly this format:

Cluster 1: Novelty=N Feasibility=N Impact=N
Cluster 2: Novelty=N Feasibility=N Impact=N
...and so on for all ${clusters.length} clusters.`;
}

/**
 * Build the refinement prompt for the refiner model.
 * If there are tied top clusters, includes all of them (max 3) for the refiner to consider.
 */
export function buildRefinementPrompt(
  userQuery: string,
  winningCluster: IdeaCluster,
  tiedClusters?: IdeaCluster[]
): string {
  const ideaList = winningCluster.ideas
    .map((idea) => `- ${idea.title}: ${idea.description}`)
    .join("\n");

  let tiedBlock = "";
  if (tiedClusters && tiedClusters.length > 1) {
    const otherClusters = tiedClusters
      .filter((c) => c.id !== winningCluster.id)
      .slice(0, 2);

    const otherClusterText = otherClusters
      .map((c) => {
        const otherIdeas = c.ideas
          .map((idea) => `  - ${idea.title}: ${idea.description}`)
          .join("\n");
        return `Tied Cluster: ${c.name} (Score: ${c.averageScore ?? "N/A"})
Theme: ${c.theme}
Ideas:\n${otherIdeas}`;
      })
      .join("\n\n");

    tiedBlock = `\n\nNOTE: The following cluster(s) tied with the winning cluster. Consider incorporating their strongest ideas into your proposal where they complement the primary direction:\n\n${otherClusterText}\n`;
  }

  return `You are developing the winning brainstorm cluster into a comprehensive, actionable proposal.

ORIGINAL QUESTION/CHALLENGE:
${userQuery}

WINNING CLUSTER: ${winningCluster.name}
Theme: ${winningCluster.theme}
Average Score: ${winningCluster.averageScore ?? "N/A"} / 15
Average Novelty: ${winningCluster.averageNovelty ?? "N/A"} / 5
Average Feasibility: ${winningCluster.averageFeasibility ?? "N/A"} / 5
Average Impact: ${winningCluster.averageImpact ?? "N/A"} / 5

Member Ideas:
${ideaList}
${tiedBlock}
Develop this cluster into a full proposal with the following sections:

1. EXECUTIVE SUMMARY
   A concise overview of the proposed direction and why it was selected.

2. DETAILED APPROACH
   Expand each member idea into concrete, actionable steps.

3. IMPLEMENTATION PLAN
   Timeline, resources needed, key milestones, and dependencies.

4. RISKS AND MITIGATIONS
   Identify potential challenges and how to address them.

5. EXPECTED OUTCOMES
   What success looks like, metrics to track, and potential impact.

6. NEXT STEPS
   Immediate actions to get started.

Write a thorough, well-structured proposal.`;
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Brainstorm pipeline, emitting SSE events via the controller.
 * Returns stage data for DB persistence.
 */
export async function handleBrainstormStream(
  _controller: ReadableStreamDefaultController,
  _encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: BrainstormConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];

  // --- brainstorm_start ---
  emit({
    type: "brainstorm_start",
    data: {
      conversationId,
      messageId,
      config: {
        models: config.models,
        curatorModel: config.curatorModel,
        refinerModel: config.refinerModel,
        minIdeasPerModel: config.minIdeasPerModel,
        maxClusters: config.maxClusters,
      },
    },
  });

  // =========================================================================
  // Phase 1 — Ideate (parallel)
  // =========================================================================
  emit({ type: "ideation_start", data: {} });

  const ideationPrompt = buildIdeationPrompt(question, config.minIdeasPerModel);
  const ideationResults = await queryModelsParallel(
    config.models,
    ideationPrompt,
    config.timeoutMs
  );

  const allIdeas: BrainstormIdea[] = [];
  const ideationByModel: BrainstormIdea[][] = [];
  let modelIdx = 0;

  for (let i = 0; i < config.models.length; i++) {
    const model = config.models[i];
    const result = ideationResults.get(model);

    if (!result || !result.content.trim()) {
      // Model returned nothing — skip
      emit({
        type: "ideation_complete",
        data: {
          model,
          ideas: [],
          ideaCount: 0,
          responseTimeMs: result?.responseTimeMs ?? 0,
        },
      });
      continue;
    }

    const ideas = parseIdeas(result.content, model, modelIdx);
    modelIdx++;

    ideationByModel.push(ideas);
    allIdeas.push(...ideas);

    emit({
      type: "ideation_complete",
      data: {
        model,
        ideas: ideas.map((idea) => ({
          id: idea.id,
          title: idea.title,
          description: idea.description.slice(0, 200),
          sourceLabel: idea.sourceLabel,
        })),
        ideaCount: ideas.length,
        responseTimeMs: result.responseTimeMs,
      },
    });

    // Save ideation stage
    stages.push({
      stageType: `ideation_${i}`,
      stageOrder: i,
      model,
      role: "ideator",
      content: result.content,
      parsedData: {
        ideas: ideas.map((idea) => ({
          id: idea.id,
          title: idea.title,
          sourceLabel: idea.sourceLabel,
        })),
        ideaCount: ideas.length,
      },
      responseTimeMs: result.responseTimeMs,
    });
  }

  // Edge case: < 2 models produced ideas → error
  const modelsWithIdeas = ideationByModel.filter((ideas) => ideas.length > 0);
  if (modelsWithIdeas.length < 2) {
    emit({
      type: "error",
      message: `Only ${modelsWithIdeas.length} model(s) produced ideas. At least 2 are required. Pipeline aborted.`,
    });
    return stages;
  }

  // Edge case: total < 10 ideas → reduce effective maxClusters
  let effectiveMaxClusters = config.maxClusters;
  if (allIdeas.length < 10) {
    effectiveMaxClusters = Math.max(3, Math.floor(allIdeas.length / 2));
  }

  emit({
    type: "all_ideation_complete",
    data: {
      totalIdeas: allIdeas.length,
      modelCount: modelsWithIdeas.length,
      effectiveMaxClusters,
    },
  });

  // =========================================================================
  // Phase 2 — Cluster (sequential)
  // =========================================================================
  emit({ type: "clustering_start", data: {} });

  const clusteringPrompt = buildClusteringPrompt(
    question,
    allIdeas,
    effectiveMaxClusters
  );
  const clusterResult = await queryModel(
    config.curatorModel,
    clusteringPrompt,
    config.timeoutMs
  );

  let clusters: IdeaCluster[];
  let unclusteredIdeas: BrainstormIdea[];
  let clusteringFallback = false;

  if (clusterResult && clusterResult.content.trim()) {
    const parsed = parseClusters(clusterResult.content, allIdeas);
    clusters = parsed.clusters;
    unclusteredIdeas = parsed.unclusteredIdeas;

    // Edge case: 0 clusters parsed → apply fallback
    if (clusters.length === 0) {
      const fallback = buildFallbackClusters(allIdeas);
      clusters = fallback;
      unclusteredIdeas = [];
      clusteringFallback = true;
    }
  } else {
    // Curator failed entirely → fallback group-by-model pseudo-clusters
    const fallback = buildFallbackClusters(allIdeas);
    clusters = fallback;
    unclusteredIdeas = [];
    clusteringFallback = true;
  }

  emit({
    type: "clustering_complete",
    data: {
      clusters: clusters.map((c) => ({
        id: c.id,
        name: c.name,
        theme: c.theme,
        promise: c.promise,
        ideaCount: c.ideas.length,
        ideaIds: c.ideaIds,
      })),
      unclusteredCount: unclusteredIdeas.length,
      fallback: clusteringFallback,
    },
  });

  // Save clustering stage
  stages.push({
    stageType: "clustering",
    stageOrder: 10,
    model: config.curatorModel,
    role: "curator",
    content: clusterResult?.content ?? "[FALLBACK] Group-by-model clustering",
    parsedData: {
      clusterCount: clusters.length,
      clusters: clusters.map((c) => ({
        id: c.id,
        name: c.name,
        theme: c.theme,
        promise: c.promise,
        ideaCount: c.ideas.length,
      })),
      unclusteredCount: unclusteredIdeas.length,
      fallback: clusteringFallback,
    },
    responseTimeMs: clusterResult?.responseTimeMs ?? 0,
  });

  // =========================================================================
  // Phase 3 — Score (parallel)
  // =========================================================================

  let rankedClusters: IdeaCluster[];
  const allScores: ClusterScore[] = [];

  if (clusters.length <= 1) {
    // Skip scoring for single cluster — it wins by default
    rankedClusters = clusters.map((c) => ({
      ...c,
      scores: [],
      averageScore: 15,
      averageNovelty: 5,
      averageFeasibility: 5,
      averageImpact: 5,
    }));
  } else {
    emit({ type: "scoring_start", data: {} });

    const scoringPrompt = buildScoringPrompt(question, clusters);
    const clusterIds = clusters.map((c) => c.id);

    const scoringResults = await queryModelsParallel(
      config.models,
      scoringPrompt,
      config.timeoutMs
    );

    let validScorerCount = 0;

    for (const model of config.models) {
      const result = scoringResults.get(model);

      if (!result || !result.content.trim()) {
        emit({
          type: "scorer_complete",
          data: {
            model,
            scores: [],
            responseTimeMs: result?.responseTimeMs ?? 0,
          },
        });
        continue;
      }

      const scores = parseScores(result.content, model, clusterIds);

      if (scores.length > 0) {
        validScorerCount++;
        allScores.push(...scores);
      }

      emit({
        type: "scorer_complete",
        data: {
          model,
          scores: scores.map((s) => ({
            clusterId: s.clusterId,
            novelty: s.novelty,
            feasibility: s.feasibility,
            impact: s.impact,
            total: s.total,
          })),
          responseTimeMs: result.responseTimeMs,
        },
      });

      // Save scoring stage
      const scorerIdx = config.models.indexOf(model);
      stages.push({
        stageType: `scoring_${scorerIdx}`,
        stageOrder: 20 + scorerIdx,
        model,
        role: "scorer",
        content: result.content,
        parsedData: {
          scores: scores.map((s) => ({
            clusterId: s.clusterId,
            novelty: s.novelty,
            feasibility: s.feasibility,
            impact: s.impact,
            total: s.total,
          })),
        },
        responseTimeMs: result.responseTimeMs,
      });
    }

    // Edge case: < 2 valid scorers → use promise ranking
    if (validScorerCount < 2) {
      rankedClusters = clusters
        .map((c) => ({
          ...c,
          scores: [],
          averageScore: promiseToScore(c.promise),
          averageNovelty: 0,
          averageFeasibility: 0,
          averageImpact: 0,
        }))
        .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));
    } else {
      rankedClusters = aggregateClusterScores(clusters, allScores);
    }

    emit({
      type: "all_scoring_complete",
      data: {
        rankedClusters: rankedClusters.map((c) => ({
          id: c.id,
          name: c.name,
          averageScore: c.averageScore,
          averageNovelty: c.averageNovelty,
          averageFeasibility: c.averageFeasibility,
          averageImpact: c.averageImpact,
        })),
        scorerCount: validScorerCount,
      },
    });
  }

  // =========================================================================
  // Phase 4 — Refine (sequential)
  // =========================================================================

  // Identify top cluster(s). Tied = same averageScore → pass all (max 3)
  const topScore = rankedClusters[0]?.averageScore ?? 0;
  const tiedClusters = rankedClusters
    .filter((c) => c.averageScore === topScore)
    .slice(0, 3);
  const winningCluster = tiedClusters[0];

  emit({
    type: "refinement_start",
    data: {
      winningCluster: {
        id: winningCluster.id,
        name: winningCluster.name,
        averageScore: winningCluster.averageScore,
        ideaCount: winningCluster.ideas.length,
      },
      tiedCount: tiedClusters.length,
    },
  });

  const refinementPrompt = buildRefinementPrompt(
    question,
    winningCluster,
    tiedClusters.length > 1 ? tiedClusters : undefined
  );
  const refinementResult = await queryModel(
    config.refinerModel,
    refinementPrompt,
    config.timeoutMs
  );

  let refinementResponse: string;
  let refinementTimeMs: number;

  if (refinementResult && refinementResult.content.trim()) {
    refinementResponse = refinementResult.content;
    refinementTimeMs = refinementResult.responseTimeMs;
  } else {
    // Fallback: output winning cluster description + member ideas
    const fallbackIdeas = winningCluster.ideas
      .map((idea) => `- **${idea.title}**: ${idea.description}`)
      .join("\n");
    refinementResponse = `## ${winningCluster.name}\n\n**Theme:** ${winningCluster.theme}\n\n**Member Ideas:**\n${fallbackIdeas}\n\n*Note: The refiner model failed to produce a detailed proposal. The winning cluster and its member ideas are presented above.*`;
    refinementTimeMs = 0;
  }

  emit({
    type: "refinement_complete",
    data: {
      model: config.refinerModel,
      response: refinementResponse,
      responseTimeMs: refinementTimeMs,
      winningClusterId: winningCluster.id,
      winningClusterName: winningCluster.name,
      wordCount: countWords(refinementResponse),
    },
  });

  // Save refinement stage
  stages.push({
    stageType: "refinement",
    stageOrder: 99,
    model: config.refinerModel,
    role: "refiner",
    content: refinementResponse,
    parsedData: {
      winningClusterId: winningCluster.id,
      winningClusterName: winningCluster.name,
      winningClusterScore: winningCluster.averageScore,
      tiedCount: tiedClusters.length,
      wordCount: countWords(refinementResponse),
      totalIdeas: allIdeas.length,
      totalClusters: clusters.length,
    },
    responseTimeMs: refinementTimeMs,
  });

  return stages;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Build fallback pseudo-clusters by grouping ideas by source model.
 * Used when the curator fails or produces 0 parseable clusters.
 */
function buildFallbackClusters(allIdeas: BrainstormIdea[]): IdeaCluster[] {
  const modelGroups = new Map<string, BrainstormIdea[]>();

  for (const idea of allIdeas) {
    const key = idea.sourceModel;
    if (!modelGroups.has(key)) modelGroups.set(key, []);
    modelGroups.get(key)!.push(idea);
  }

  let clusterNum = 1;
  const clusters: IdeaCluster[] = [];

  for (const [model, ideas] of modelGroups) {
    clusters.push({
      id: `cluster_${clusterNum}`,
      name: `${ideas[0].sourceLabel} Ideas`,
      theme: `Ideas generated by ${model}`,
      promise: "MEDIUM",
      ideaIds: ideas.map((i) => i.id),
      ideas,
    });
    clusterNum++;
  }

  return clusters;
}

/**
 * Convert promise level to a numeric score for fallback ranking.
 */
function promiseToScore(promise: PromiseLevel): number {
  switch (promise) {
    case "HIGH":
      return 12;
    case "MEDIUM":
      return 8;
    case "LOW":
      return 4;
    default:
      return 4;
  }
}
