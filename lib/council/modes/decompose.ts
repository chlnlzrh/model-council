/**
 * Decompose Mode — DAG-based task decomposition, parallel wave execution, and assembly.
 *
 * Pipeline:
 *   Stage 1 (Plan): Planner model decomposes the question into 3-8 sub-tasks with dependencies
 *   Stage 2 (Assign): Server-side topological sort + round-robin worker assignment
 *   Stage 3 (Execute): Workers execute tasks in parallel waves (topological order)
 *   Stage 4 (Assemble): Assembler model integrates all outputs into a coherent answer
 *
 * See docs/modes/13-decompose.md for full specification.
 */

import type {
  SSEEvent,
  DeliberationStageData,
} from "../types";
import { queryModel } from "../openrouter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskComplexity = "LOW" | "MEDIUM" | "HIGH";

export interface SubTask {
  id: string;
  title: string;
  description: string;
  dependencies: string[];
  complexity: TaskComplexity;
  expertise: string;
  assignedModel?: string;
  output?: string;
  responseTimeMs?: number;
  waveNumber?: number;
}

export interface TaskPlan {
  tasks: SubTask[];
  executionWaves: string[][];
  criticalPath: string[];
  maxParallelism: number;
}

export interface TaskAssignment {
  taskId: string;
  model: string;
  waveNumber: number;
}

export interface TaskOutput {
  taskId: string;
  title: string;
  model: string;
  output: string;
  wordCount: number;
  waveNumber: number;
  dependencies: string[];
  responseTimeMs: number;
  failed: boolean;
  failureReason?: string;
}

export interface DecomposeAssemblyResult {
  model: string;
  response: string;
  responseTimeMs: number;
  tasksAssembled: number;
  missingTasks: string[];
}

export interface ExecutionStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalWaves: number;
  maxParallelism: number;
  criticalPath: string[];
  criticalPathMs: number;
  totalTimeMs: number;
  parallelismEfficiency: number;
}

export interface DecomposeResult {
  plan: TaskPlan;
  taskOutputs: TaskOutput[];
  assembly: DecomposeAssemblyResult;
  executionStats: ExecutionStats;
  title?: string;
}

export interface DecomposeConfig {
  plannerModel: string;
  workerModels: string[];
  assemblerModel: string;
  maxTasks: number;
  timeoutMs: number;
}

export const DEFAULT_DECOMPOSE_CONFIG: DecomposeConfig = {
  plannerModel: "anthropic/claude-opus-4-6",
  workerModels: [
    "anthropic/claude-opus-4-6",
    "openai/o3",
    "google/gemini-2.5-pro",
  ],
  assemblerModel: "anthropic/claude-opus-4-6",
  maxTasks: 6,
  timeoutMs: 120_000,
};

// ---------------------------------------------------------------------------
// Pure Functions — Parsers & Utilities
// ---------------------------------------------------------------------------

/**
 * Parse structured task plan text into SubTask[].
 *
 * Extracts TASK blocks using regex. Uses [\s\S]+? (not dotAll flag)
 * for cross-line description matching (ES2018 compat).
 */
export function parseTaskPlan(text: string): SubTask[] {
  if (!text || !text.trim()) return [];

  const tasks: SubTask[] = [];
  const taskBlocks = text.matchAll(
    /TASK\s+(task_\d+):\s*\n\s*Title:\s*(.+)\n\s*Description:\s*([\s\S]+?)\n\s*Dependencies:\s*(.+)\n\s*Complexity:\s*(LOW|MEDIUM|HIGH)\n\s*Expertise:\s*(.+)/gi
  );

  for (const match of taskBlocks) {
    const deps = match[4].trim().toLowerCase();
    tasks.push({
      id: match[1].toLowerCase(),
      title: match[2].trim(),
      description: match[3].trim(),
      dependencies: deps === "none" ? [] : deps.split(/,\s*/).map((d) => d.trim()),
      complexity: match[5].toUpperCase() as TaskComplexity,
      expertise: match[6].trim().toLowerCase(),
    });
  }

  return tasks;
}

/**
 * Validate and clean task dependencies.
 * Removes references to non-existent task IDs. Logs warnings for invalid refs.
 */
export function validateDependencies(tasks: SubTask[]): SubTask[] {
  const validIds = new Set(tasks.map((t) => t.id));

  return tasks.map((task) => {
    const cleanDeps = task.dependencies.filter((dep) => {
      if (!validIds.has(dep)) {
        console.warn(
          `[decompose] Task "${task.id}" references non-existent dependency "${dep}" — removed.`
        );
        return false;
      }
      if (dep === task.id) {
        console.warn(
          `[decompose] Task "${task.id}" has self-dependency — removed.`
        );
        return false;
      }
      return true;
    });

    return { ...task, dependencies: cleanDeps };
  });
}

/**
 * Topological sort using Kahn's algorithm with wave grouping.
 * Returns waves (groups of tasks whose dependencies are all satisfied),
 * critical path, and cycle detection.
 */
export function topologicalSort(tasks: SubTask[]): {
  waves: string[][];
  criticalPath: string[];
  hasCycle: boolean;
} {
  if (tasks.length === 0) {
    return { waves: [], criticalPath: [], hasCycle: false };
  }

  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    inDegree.set(task.id, task.dependencies.length);
    if (!adjacency.has(task.id)) adjacency.set(task.id, []);
    for (const dep of task.dependencies) {
      if (!adjacency.has(dep)) adjacency.set(dep, []);
      adjacency.get(dep)!.push(task.id);
    }
  }

  const waves: string[][] = [];
  const processed = new Set<string>();

  while (processed.size < tasks.length) {
    const wave: string[] = [];
    for (const task of tasks) {
      if (!processed.has(task.id) && inDegree.get(task.id) === 0) {
        wave.push(task.id);
      }
    }

    if (wave.length === 0) {
      return { waves, criticalPath: [], hasCycle: true };
    }

    waves.push(wave);
    for (const taskId of wave) {
      processed.add(taskId);
      for (const dependent of adjacency.get(taskId) ?? []) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
      }
    }
  }

  const criticalPath = computeCriticalPath(tasks, waves);

  return { waves, criticalPath, hasCycle: false };
}

/**
 * Compute the critical path (longest dependency chain) through the DAG.
 * Uses dynamic programming over the wave order.
 */
export function computeCriticalPath(
  tasks: SubTask[],
  waves: string[][]
): string[] {
  if (tasks.length === 0 || waves.length === 0) return [];

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const longestPath = new Map<string, string[]>();

  for (const wave of waves) {
    for (const taskId of wave) {
      const task = taskMap.get(taskId)!;
      if (task.dependencies.length === 0) {
        longestPath.set(taskId, [taskId]);
      } else {
        let longest: string[] = [];
        for (const dep of task.dependencies) {
          const depPath = longestPath.get(dep) ?? [];
          if (depPath.length > longest.length) longest = depPath;
        }
        longestPath.set(taskId, [...longest, taskId]);
      }
    }
  }

  let result: string[] = [];
  for (const path of longestPath.values()) {
    if (path.length > result.length) result = path;
  }
  return result;
}

/**
 * Assign worker models to tasks using round-robin distribution in wave order.
 * Mutates task.assignedModel and task.waveNumber.
 */
export function assignWorkers(
  tasks: SubTask[],
  workerModels: string[],
  waves: string[][]
): TaskAssignment[] {
  if (workerModels.length === 0) return [];

  const assignments: TaskAssignment[] = [];
  let roundRobinIndex = 0;
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  for (let waveNum = 0; waveNum < waves.length; waveNum++) {
    for (const taskId of waves[waveNum]) {
      const task = taskMap.get(taskId);
      if (!task) continue;

      const assignedModel = workerModels[roundRobinIndex % workerModels.length];
      roundRobinIndex++;

      task.assignedModel = assignedModel;
      task.waveNumber = waveNum + 1;

      assignments.push({
        taskId,
        model: assignedModel,
        waveNumber: waveNum + 1,
      });
    }
  }

  return assignments;
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
 * Build the plan prompt for the planner model.
 */
export function buildPlanPrompt(userQuery: string, maxTasks: number): string {
  return `You are a task decomposition expert. Break the following question/task into 3-${maxTasks} discrete sub-tasks that, when completed and assembled, will produce a comprehensive answer.

QUESTION/TASK:
${userQuery}

For each sub-task, provide:
- ID: A short identifier (task_1, task_2, etc.)
- Title: Brief title
- Description: What this sub-task should produce (2-3 sentences)
- Dependencies: Which other task IDs must complete first (comma-separated, or "none")
- Complexity: LOW / MEDIUM / HIGH
- Expertise: Optional tag for best-suited model type (e.g., "technical", "creative", "analytical", or "general")

IMPORTANT RULES:
1. Tasks should be independent where possible to maximize parallelism.
2. Avoid circular dependencies.
3. Each task should produce a standalone output that can be understood in context.
4. The first task(s) should have no dependencies.
5. There should be a clear flow from initial research/analysis to final deliverables.

Format:

TASK PLAN:

TASK task_1:
Title: [title]
Description: [what to produce]
Dependencies: none
Complexity: [LOW|MEDIUM|HIGH]
Expertise: [tag or "general"]

TASK task_2:
Title: [title]
Description: [what to produce]
Dependencies: task_1
Complexity: [LOW|MEDIUM|HIGH]
Expertise: [tag or "general"]

...

EXECUTION SUMMARY:
Total tasks: [count]
Max parallelism: [how many can run simultaneously]
Critical path: [longest dependency chain, e.g., task_1 -> task_3 -> task_5]`;
}

/**
 * Build the execution prompt for a sub-task worker.
 * Includes dependency outputs if the task has completed prerequisites.
 */
export function buildTaskExecutionPrompt(
  task: SubTask,
  userQuery: string,
  dependencyOutputs: Array<{ taskId: string; title: string; output: string }>
): string {
  let prompt = `You are completing a specific sub-task as part of a larger decomposed question.

ORIGINAL QUESTION:
${userQuery}

YOUR SUB-TASK:
ID: ${task.id}
Title: ${task.title}
Description: ${task.description}
`;

  if (dependencyOutputs.length > 0) {
    prompt += `\nOUTPUTS FROM PREREQUISITE TASKS:\n`;
    for (const dep of dependencyOutputs) {
      prompt += `--- ${dep.taskId}: ${dep.title} ---\n${dep.output}\n\n`;
    }
  }

  prompt += `\nComplete your sub-task thoroughly. Your output will be combined with other sub-task outputs to form the final answer. Focus on YOUR specific task — do not attempt to answer the entire original question.

SUB-TASK OUTPUT:`;

  return prompt;
}

/**
 * Build the assembly prompt for the assembler model.
 */
export function buildAssemblyPrompt(
  userQuery: string,
  plan: SubTask[],
  taskOutputs: TaskOutput[]
): string {
  const taskCount = taskOutputs.length;

  const planList = plan
    .map(
      (t) =>
        `- ${t.id}: ${t.title} (Complexity: ${t.complexity}, Dependencies: ${t.dependencies.length > 0 ? t.dependencies.join(", ") : "none"})`
    )
    .join("\n");

  const completedOutputs = taskOutputs
    .filter((t) => !t.failed)
    .map(
      (t) => `--- ${t.taskId}: ${t.title} (${t.model}) ---\n${t.output}`
    )
    .join("\n\n");

  const failedTasks = taskOutputs.filter((t) => t.failed);
  let failedBlock = "";
  if (failedTasks.length > 0) {
    const failedList = failedTasks
      .map(
        (t) => `- ${t.taskId}: ${t.title} — FAILED (${t.failureReason ?? "Unknown error"})`
      )
      .join("\n");
    failedBlock = `\nMISSING/FAILED SUB-TASKS:\n${failedList}\n`;
  }

  return `You are assembling the final answer from ${taskCount} completed sub-tasks.

ORIGINAL QUESTION:
${userQuery}

TASK PLAN:
${planList}

COMPLETED SUB-TASKS (in dependency order):
${completedOutputs}
${failedBlock}
Your job:
1. Combine all sub-task outputs into a single, coherent, comprehensive answer.
2. Ensure smooth transitions between sections derived from different sub-tasks.
3. Remove redundancy where sub-tasks overlap.
4. Add an introduction and conclusion that frame the full answer.
5. Ensure consistent terminology and tone throughout.
6. If any sub-task output is missing or incomplete, note the gap.

ASSEMBLED ANSWER:`;
}

// ---------------------------------------------------------------------------
// SSE Handler — called from the stream route dispatcher
// ---------------------------------------------------------------------------

/**
 * Run the Decompose pipeline, emitting SSE events via the controller.
 * Returns stage data for DB persistence.
 */
export async function handleDecomposeStream(
  _controller: ReadableStreamDefaultController,
  _encoder: TextEncoder,
  emit: (event: SSEEvent) => void,
  params: {
    question: string;
    conversationId: string;
    messageId: string;
    config: DecomposeConfig;
  }
): Promise<DeliberationStageData[]> {
  const { question, conversationId, messageId, config } = params;
  const stages: DeliberationStageData[] = [];
  const pipelineStart = Date.now();

  // --- decompose_start ---
  emit({
    type: "decompose_start",
    data: {
      conversationId,
      messageId,
      config: {
        plannerModel: config.plannerModel,
        workerModels: config.workerModels,
        assemblerModel: config.assemblerModel,
        maxTasks: config.maxTasks,
      },
    },
  });

  // --- Stage 1: Plan ---
  emit({ type: "plan_start", data: {} });

  const planPrompt = buildPlanPrompt(question, config.maxTasks);
  let planResult = await queryModel(
    config.plannerModel,
    planPrompt,
    config.timeoutMs
  );

  if (!planResult) {
    emit({
      type: "error",
      message: "Planner model failed to produce a task plan. Pipeline aborted.",
    });
    return stages;
  }

  let tasks = parseTaskPlan(planResult.content);

  // Edge case: 0 tasks — retry once with stricter prompt
  if (tasks.length === 0) {
    const retryPrompt = planPrompt + "\n\nIMPORTANT: You MUST use the exact format specified above. Each task MUST start with 'TASK task_N:' on its own line.";
    const retryResult = await queryModel(
      config.plannerModel,
      retryPrompt,
      config.timeoutMs
    );

    if (retryResult) {
      planResult = retryResult;
      tasks = parseTaskPlan(retryResult.content);
    }

    if (tasks.length === 0) {
      emit({
        type: "error",
        message: "Planner failed to produce parseable tasks after retry. Pipeline aborted.",
      });
      return stages;
    }
  }

  // Edge case: >maxTasks — truncate and fix deps
  if (tasks.length > config.maxTasks) {
    const validIds = new Set(tasks.slice(0, config.maxTasks).map((t) => t.id));
    tasks = tasks.slice(0, config.maxTasks).map((task) => ({
      ...task,
      dependencies: task.dependencies.filter((d) => validIds.has(d)),
    }));
  }

  // Validate dependencies (remove invalid refs + self-refs)
  tasks = validateDependencies(tasks);

  // Topological sort
  let sortResult = topologicalSort(tasks);

  // Edge case: cycle detected — retry once, then flatten
  if (sortResult.hasCycle) {
    const retryPrompt = planPrompt + "\n\nYour previous plan contained circular dependencies. Produce a new plan with NO circular dependencies. Every task's dependencies must form a DAG (directed acyclic graph).";
    const retryResult = await queryModel(
      config.plannerModel,
      retryPrompt,
      config.timeoutMs
    );

    if (retryResult) {
      planResult = retryResult;
      let retryTasks = parseTaskPlan(retryResult.content);
      if (retryTasks.length > config.maxTasks) {
        const validIds = new Set(retryTasks.slice(0, config.maxTasks).map((t) => t.id));
        retryTasks = retryTasks.slice(0, config.maxTasks).map((task) => ({
          ...task,
          dependencies: task.dependencies.filter((d) => validIds.has(d)),
        }));
      }
      retryTasks = validateDependencies(retryTasks);
      const retrySortResult = topologicalSort(retryTasks);

      if (!retrySortResult.hasCycle && retryTasks.length > 0) {
        tasks = retryTasks;
        sortResult = retrySortResult;
      }
    }

    // If still cyclic, flatten all tasks into a single wave
    if (sortResult.hasCycle) {
      console.warn("[decompose] Cycle detected after retry — flattening all tasks into single wave.");
      tasks = tasks.map((t) => ({ ...t, dependencies: [] }));
      sortResult = topologicalSort(tasks);
    }
  }

  const { waves, criticalPath } = sortResult;
  const maxParallelism = Math.max(...waves.map((w) => w.length), 0);

  // Emit plan_complete
  emit({
    type: "plan_complete",
    data: {
      data: {
        model: config.plannerModel,
        tasks: tasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          dependencies: t.dependencies,
          complexity: t.complexity,
          expertise: t.expertise,
        })),
        executionWaves: waves,
        criticalPath,
        maxParallelism,
        totalTasks: tasks.length,
        responseTimeMs: planResult.responseTimeMs,
      },
    },
  });

  // Save plan stage
  stages.push({
    stageType: "plan",
    stageOrder: 0,
    model: config.plannerModel,
    role: "planner",
    content: planResult.content,
    parsedData: {
      type: "plan",
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dependencies: t.dependencies,
        complexity: t.complexity,
        expertise: t.expertise,
      })),
      executionWaves: waves,
      criticalPath,
      maxParallelism,
    },
    responseTimeMs: planResult.responseTimeMs,
  });

  // --- Stage 2: Assign workers ---
  const assignments = assignWorkers(tasks, config.workerModels, waves);

  emit({
    type: "assignment_complete",
    data: {
      data: { assignments },
    },
  });

  // --- Stage 3: Execute waves ---
  const completedOutputs = new Map<string, TaskOutput>();
  const allTaskOutputs: TaskOutput[] = [];

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    const waveNumber = waveIdx + 1;
    const waveTaskIds = waves[waveIdx];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Build wave task previews
    const wavePreviews = waveTaskIds.map((taskId) => {
      const task = taskMap.get(taskId)!;
      return {
        taskId,
        title: task.title,
        model: task.assignedModel ?? "unknown",
        dependencies: task.dependencies,
      };
    });

    emit({
      type: "wave_start",
      data: { waveNumber, tasks: wavePreviews },
    });

    const waveStart = Date.now();

    // Execute all tasks in the wave in parallel
    const taskPromises = waveTaskIds.map(async (taskId) => {
      const task = taskMap.get(taskId)!;

      // Build dependency outputs for this task
      const depOutputs: Array<{ taskId: string; title: string; output: string }> = [];
      for (const depId of task.dependencies) {
        const depOutput = completedOutputs.get(depId);
        if (depOutput && !depOutput.failed) {
          depOutputs.push({
            taskId: depOutput.taskId,
            title: depOutput.title,
            output: depOutput.output,
          });
        } else if (depOutput && depOutput.failed) {
          depOutputs.push({
            taskId: depId,
            title: depOutput.title,
            output: `[FAILED] Sub-task ${depId} (${depOutput.title}) failed. Work without its output and note any gaps.`,
          });
        }
      }

      const taskPrompt = buildTaskExecutionPrompt(task, question, depOutputs);
      const result = await queryModel(
        task.assignedModel!,
        taskPrompt,
        config.timeoutMs
      );

      return { taskId, task, result };
    });

    const waveResults = await Promise.allSettled(taskPromises);

    let waveCompleted = 0;
    let waveFailed = 0;

    for (const settledResult of waveResults) {
      if (settledResult.status === "fulfilled") {
        const { taskId, task, result } = settledResult.value;

        if (result && result.content.trim()) {
          const wc = countWords(result.content);
          const output: TaskOutput = {
            taskId,
            title: task.title,
            model: task.assignedModel!,
            output: result.content,
            wordCount: wc,
            waveNumber,
            dependencies: task.dependencies,
            responseTimeMs: result.responseTimeMs,
            failed: false,
          };

          completedOutputs.set(taskId, output);
          allTaskOutputs.push(output);
          waveCompleted++;

          emit({
            type: "task_complete",
            data: {
              taskId,
              title: task.title,
              model: task.assignedModel!,
              outputPreview: result.content.slice(0, 200),
              wordCount: wc,
              responseTimeMs: result.responseTimeMs,
            },
          });

          // Save task stage
          stages.push({
            stageType: taskId,
            stageOrder: waveNumber,
            model: task.assignedModel!,
            role: "worker",
            content: result.content,
            parsedData: {
              taskId,
              title: task.title,
              waveNumber,
              dependenciesUsed: task.dependencies,
              wordCount: wc,
              complexity: task.complexity,
              expertise: task.expertise,
              assignedModel: task.assignedModel!,
            },
            responseTimeMs: result.responseTimeMs,
          });
        } else {
          // Model returned null or empty
          const failureReason = "Model returned null or empty response";
          const output: TaskOutput = {
            taskId,
            title: task.title,
            model: task.assignedModel!,
            output: "",
            wordCount: 0,
            waveNumber,
            dependencies: task.dependencies,
            responseTimeMs: 0,
            failed: true,
            failureReason,
          };

          completedOutputs.set(taskId, output);
          allTaskOutputs.push(output);
          waveFailed++;

          emit({
            type: "task_complete",
            data: {
              taskId,
              title: task.title,
              model: task.assignedModel!,
              outputPreview: `[FAILED] ${failureReason}`,
              wordCount: 0,
              responseTimeMs: 0,
            },
          });

          stages.push({
            stageType: taskId,
            stageOrder: waveNumber,
            model: task.assignedModel!,
            role: "worker",
            content: `[FAILED] Sub-task ${taskId} (${task.title}) failed: ${failureReason}`,
            parsedData: {
              taskId,
              title: task.title,
              waveNumber,
              dependenciesUsed: task.dependencies,
              wordCount: 0,
              complexity: task.complexity,
              expertise: task.expertise,
              assignedModel: task.assignedModel!,
              failed: true,
              failureReason,
            },
            responseTimeMs: 0,
          });
        }
      } else {
        // Promise rejected
        const reason = String(settledResult.reason);
        // We need to figure out which task this was — use index
        const taskIdx = waveResults.indexOf(settledResult);
        const taskId = waveTaskIds[taskIdx];
        const task = taskMap.get(taskId)!;

        const output: TaskOutput = {
          taskId,
          title: task.title,
          model: task.assignedModel!,
          output: "",
          wordCount: 0,
          waveNumber,
          dependencies: task.dependencies,
          responseTimeMs: 0,
          failed: true,
          failureReason: reason,
        };

        completedOutputs.set(taskId, output);
        allTaskOutputs.push(output);
        waveFailed++;

        emit({
          type: "task_complete",
          data: {
            taskId,
            title: task.title,
            model: task.assignedModel!,
            outputPreview: `[FAILED] ${reason}`,
            wordCount: 0,
            responseTimeMs: 0,
          },
        });

        stages.push({
          stageType: taskId,
          stageOrder: waveNumber,
          model: task.assignedModel!,
          role: "worker",
          content: `[FAILED] Sub-task ${taskId} (${task.title}) failed: ${reason}`,
          parsedData: {
            taskId,
            title: task.title,
            waveNumber,
            dependenciesUsed: task.dependencies,
            wordCount: 0,
            complexity: task.complexity,
            expertise: task.expertise,
            assignedModel: task.assignedModel!,
            failed: true,
            failureReason: reason,
          },
          responseTimeMs: 0,
        });
      }
    }

    const waveTimeMs = Date.now() - waveStart;

    emit({
      type: "wave_complete",
      data: {
        waveNumber,
        completedCount: waveCompleted,
        failedCount: waveFailed,
        waveTimeMs,
      },
    });
  }

  // --- Stage 4: Assemble ---
  emit({ type: "assembly_start", data: {} });

  const assemblyPrompt = buildAssemblyPrompt(question, tasks, allTaskOutputs);
  const assemblyResult = await queryModel(
    config.assemblerModel,
    assemblyPrompt,
    config.timeoutMs
  );

  const successfulOutputs = allTaskOutputs.filter((t) => !t.failed);
  const failedOutputs = allTaskOutputs.filter((t) => t.failed);

  let assemblyResponse: string;
  let assemblyTimeMs: number;

  if (assemblyResult && assemblyResult.content.trim()) {
    assemblyResponse = assemblyResult.content;
    assemblyTimeMs = assemblyResult.responseTimeMs;
  } else {
    // Fallback: concatenate task outputs with separators
    assemblyResponse = successfulOutputs
      .map((t) => `## ${t.taskId}: ${t.title}\n\n${t.output}`)
      .join("\n\n---\n\n");
    assemblyTimeMs = 0;

    if (failedOutputs.length > 0) {
      const gapNotes = failedOutputs
        .map((t) => `- ${t.taskId}: ${t.title} — ${t.failureReason ?? "Failed"}`)
        .join("\n");
      assemblyResponse += `\n\n---\n\n## Missing Sub-Tasks\n\n${gapNotes}`;
    }
  }

  const totalTimeMs = Date.now() - pipelineStart;

  // Compute execution stats
  const criticalPathMs = criticalPath.reduce((sum, taskId) => {
    const output = completedOutputs.get(taskId);
    return sum + (output?.responseTimeMs ?? 0);
  }, 0);

  const totalTaskTimeMs = allTaskOutputs.reduce(
    (sum, t) => sum + t.responseTimeMs,
    0
  );
  const parallelismEfficiency =
    totalTimeMs > 0 ? totalTaskTimeMs / totalTimeMs : 1.0;

  emit({
    type: "assembly_complete",
    data: {
      data: {
        model: config.assemblerModel,
        response: assemblyResponse,
        responseTimeMs: assemblyTimeMs,
        tasksAssembled: successfulOutputs.length,
        missingTasks: failedOutputs.map((t) => t.taskId),
      },
    },
  });

  // Save assembly stage
  stages.push({
    stageType: "assembly",
    stageOrder: 99,
    model: config.assemblerModel,
    role: "assembler",
    content: assemblyResponse,
    parsedData: {
      tasksAssembled: successfulOutputs.length,
      missingTasks: failedOutputs.map((t) => t.taskId),
      wordCount: countWords(assemblyResponse),
      totalWaves: waves.length,
      criticalPathMs,
      totalPipelineMs: totalTimeMs,
    },
    responseTimeMs: assemblyTimeMs,
  });

  return stages;
}
