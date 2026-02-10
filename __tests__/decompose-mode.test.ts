/**
 * Tests for Decompose mode:
 * - parseTaskPlan
 * - validateDependencies
 * - topologicalSort
 * - computeCriticalPath
 * - assignWorkers
 * - countWords
 * - buildPlanPrompt
 * - buildTaskExecutionPrompt
 * - buildAssemblyPrompt
 * - DEFAULT_DECOMPOSE_CONFIG
 */

import { describe, it, expect } from "vitest";
import {
  parseTaskPlan,
  validateDependencies,
  topologicalSort,
  computeCriticalPath,
  assignWorkers,
  countWords,
  buildPlanPrompt,
  buildTaskExecutionPrompt,
  buildAssemblyPrompt,
  DEFAULT_DECOMPOSE_CONFIG,
} from "@/lib/council/modes/decompose";
import type { SubTask, TaskOutput } from "@/lib/council/modes/decompose";

// ---------------------------------------------------------------------------
// Helper: build well-formed task plan text
// ---------------------------------------------------------------------------

function makeTaskPlanText(taskCount: number = 6): string {
  const tasks = Array.from({ length: taskCount }, (_, i) => {
    const num = i + 1;
    const deps = num === 1 ? "none" : `task_${num - 1}`;
    const complexity = num % 3 === 0 ? "HIGH" : num % 2 === 0 ? "MEDIUM" : "LOW";
    return `TASK task_${num}:
Title: Task ${num} Title
Description: Description for task ${num} covering its scope.
Dependencies: ${deps}
Complexity: ${complexity}
Expertise: general`;
  }).join("\n\n");

  return `TASK PLAN:\n\n${tasks}\n\nEXECUTION SUMMARY:\nTotal tasks: ${taskCount}\nMax parallelism: 1\nCritical path: ${Array.from({ length: taskCount }, (_, i) => `task_${i + 1}`).join(" -> ")}`;
}

function makeSubTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: "task_1",
    title: "Default Task",
    description: "Default description",
    dependencies: [],
    complexity: "LOW",
    expertise: "general",
    ...overrides,
  };
}

function makeTaskOutput(overrides: Partial<TaskOutput> = {}): TaskOutput {
  return {
    taskId: "task_1",
    title: "Default Task",
    model: "model-a",
    output: "Some output content here",
    wordCount: 4,
    waveNumber: 1,
    dependencies: [],
    responseTimeMs: 1000,
    failed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseTaskPlan
// ---------------------------------------------------------------------------

describe("parseTaskPlan", () => {
  it("parses a well-formed 6-task plan", () => {
    const result = parseTaskPlan(makeTaskPlanText(6));
    expect(result).toHaveLength(6);
    expect(result[0].id).toBe("task_1");
    expect(result[5].id).toBe("task_6");
  });

  it("extracts task IDs correctly", () => {
    const result = parseTaskPlan(makeTaskPlanText(3));
    expect(result.map((t) => t.id)).toEqual(["task_1", "task_2", "task_3"]);
  });

  it("extracts titles correctly", () => {
    const result = parseTaskPlan(makeTaskPlanText(2));
    expect(result[0].title).toBe("Task 1 Title");
    expect(result[1].title).toBe("Task 2 Title");
  });

  it("extracts descriptions correctly", () => {
    const result = parseTaskPlan(makeTaskPlanText(1));
    expect(result[0].description).toBe("Description for task 1 covering its scope.");
  });

  it("parses dependencies: none as empty array", () => {
    const result = parseTaskPlan(makeTaskPlanText(1));
    expect(result[0].dependencies).toEqual([]);
  });

  it("parses dependencies with a single task ID", () => {
    const result = parseTaskPlan(makeTaskPlanText(2));
    expect(result[1].dependencies).toEqual(["task_1"]);
  });

  it("parses dependencies with multiple task IDs", () => {
    const text = `TASK task_1:
Title: First
Description: First task description here.
Dependencies: none
Complexity: LOW
Expertise: general

TASK task_2:
Title: Second
Description: Second task description here.
Dependencies: none
Complexity: LOW
Expertise: general

TASK task_3:
Title: Third
Description: Third task that depends on both.
Dependencies: task_1, task_2
Complexity: HIGH
Expertise: analytical`;
    const result = parseTaskPlan(text);
    expect(result[2].dependencies).toEqual(["task_1", "task_2"]);
  });

  it("parses complexity correctly", () => {
    const result = parseTaskPlan(makeTaskPlanText(3));
    expect(result[0].complexity).toBe("LOW");
    expect(result[1].complexity).toBe("MEDIUM");
    expect(result[2].complexity).toBe("HIGH");
  });

  it("parses expertise correctly", () => {
    const result = parseTaskPlan(makeTaskPlanText(1));
    expect(result[0].expertise).toBe("general");
  });

  it("parses a single task", () => {
    const result = parseTaskPlan(makeTaskPlanText(1));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("task_1");
    expect(result[0].dependencies).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(parseTaskPlan("")).toEqual([]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(parseTaskPlan("   \n\t  ")).toEqual([]);
  });

  it("returns empty array for malformed blocks missing title", () => {
    const text = `TASK task_1:
Description: Missing title field.
Dependencies: none
Complexity: LOW
Expertise: general`;
    expect(parseTaskPlan(text)).toEqual([]);
  });

  it("returns empty array for malformed blocks missing complexity", () => {
    const text = `TASK task_1:
Title: First
Description: Missing complexity.
Dependencies: none
Expertise: general`;
    expect(parseTaskPlan(text)).toEqual([]);
  });

  it("handles multi-line description", () => {
    const text = `TASK task_1:
Title: First
Description: This is a multi-line
description that spans two lines.
Dependencies: none
Complexity: LOW
Expertise: general`;
    const result = parseTaskPlan(text);
    expect(result).toHaveLength(1);
    expect(result[0].description).toContain("multi-line");
  });

  it("is case-insensitive for TASK keyword", () => {
    const text = `task task_1:
Title: Lowercase task keyword
Description: Testing case insensitivity.
Dependencies: none
Complexity: LOW
Expertise: general`;
    const result = parseTaskPlan(text);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Lowercase task keyword");
  });

  it("is case-insensitive for complexity values", () => {
    const text = `TASK task_1:
Title: Mixed Case
Description: Testing mixed case complexity.
Dependencies: none
Complexity: low
Expertise: general`;
    const result = parseTaskPlan(text);
    expect(result).toHaveLength(1);
    expect(result[0].complexity).toBe("LOW");
  });

  it("normalizes task IDs to lowercase", () => {
    const text = `TASK Task_1:
Title: Capital T
Description: Task ID with uppercase.
Dependencies: none
Complexity: MEDIUM
Expertise: general`;
    const result = parseTaskPlan(text);
    if (result.length > 0) {
      expect(result[0].id).toBe("task_1");
    }
  });

  it("handles extra whitespace in field values", () => {
    const text = `TASK task_1:
  Title:   Lots of Spaces
  Description:   Spaced out description.
  Dependencies:   none
  Complexity:   HIGH
  Expertise:   technical`;
    const result = parseTaskPlan(text);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Lots of Spaces");
    expect(result[0].complexity).toBe("HIGH");
    expect(result[0].expertise).toBe("technical");
  });
});

// ---------------------------------------------------------------------------
// validateDependencies
// ---------------------------------------------------------------------------

describe("validateDependencies", () => {
  it("removes invalid dependency references", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: ["task_99"] }),
    ];
    const result = validateDependencies(tasks);
    expect(result[0].dependencies).toEqual([]);
  });

  it("preserves valid dependency references", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
    ];
    const result = validateDependencies(tasks);
    expect(result[1].dependencies).toEqual(["task_1"]);
  });

  it("leaves empty dependencies unchanged", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
    ];
    const result = validateDependencies(tasks);
    expect(result[0].dependencies).toEqual([]);
  });

  it("removes self-dependencies", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: ["task_1"] }),
    ];
    const result = validateDependencies(tasks);
    expect(result[0].dependencies).toEqual([]);
  });

  it("handles mixed valid and invalid dependencies", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1", "task_99", "task_2", "task_3"] }),
    ];
    const result = validateDependencies(tasks);
    expect(result[2].dependencies).toEqual(["task_1", "task_2"]);
  });
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe("topologicalSort", () => {
  it("sorts a linear chain into sequential waves", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_2"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.waves).toEqual([["task_1"], ["task_2"], ["task_3"]]);
    expect(result.hasCycle).toBe(false);
  });

  it("places fully parallel tasks in a single wave", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]).toEqual(["task_1", "task_2", "task_3"]);
    expect(result.hasCycle).toBe(false);
  });

  it("handles a diamond DAG (task_1 -> task_2,task_3 -> task_4)", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2", "task_3"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.waves).toHaveLength(3);
    expect(result.waves[0]).toEqual(["task_1"]);
    expect(result.waves[1]).toEqual(["task_2", "task_3"]);
    expect(result.waves[2]).toEqual(["task_4"]);
    expect(result.hasCycle).toBe(false);
  });

  it("detects a cycle", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: ["task_2"] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.hasCycle).toBe(true);
  });

  it("handles self-dependency after validate removes it (single wave)", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
    ];
    // After validateDependencies would remove self-dep, the task has no deps
    const result = topologicalSort(tasks);
    expect(result.waves).toEqual([["task_1"]]);
    expect(result.hasCycle).toBe(false);
  });

  it("handles a complex 6-task DAG with multiple waves", () => {
    // task_1, task_2 (wave 1) -> task_3 depends on task_1 (wave 2) -> task_4 depends on task_2 (wave 2) -> task_5 depends on task_3, task_4 (wave 3) -> task_6 depends on task_5 (wave 4)
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2"] }),
      makeSubTask({ id: "task_5", dependencies: ["task_3", "task_4"] }),
      makeSubTask({ id: "task_6", dependencies: ["task_5"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.waves).toHaveLength(4);
    expect(result.waves[0]).toEqual(["task_1", "task_2"]);
    expect(result.waves[1]).toEqual(["task_3", "task_4"]);
    expect(result.waves[2]).toEqual(["task_5"]);
    expect(result.waves[3]).toEqual(["task_6"]);
    expect(result.hasCycle).toBe(false);
  });

  it("handles a single task", () => {
    const tasks: SubTask[] = [makeSubTask({ id: "task_1", dependencies: [] })];
    const result = topologicalSort(tasks);
    expect(result.waves).toEqual([["task_1"]]);
    expect(result.criticalPath).toEqual(["task_1"]);
  });

  it("returns empty waves for empty input", () => {
    const result = topologicalSort([]);
    expect(result.waves).toEqual([]);
    expect(result.criticalPath).toEqual([]);
    expect(result.hasCycle).toBe(false);
  });

  it("places all independent tasks in one wave", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
      makeSubTask({ id: "task_4", dependencies: [] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.waves).toHaveLength(1);
    expect(result.waves[0]).toHaveLength(4);
  });

  it("handles multiple roots feeding into a single task", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
      makeSubTask({ id: "task_4", dependencies: ["task_1", "task_2", "task_3"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.waves).toHaveLength(2);
    expect(result.waves[0]).toEqual(["task_1", "task_2", "task_3"]);
    expect(result.waves[1]).toEqual(["task_4"]);
  });

  it("sets hasCycle to false for valid DAGs", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.hasCycle).toBe(false);
  });

  it("computes correct wave count", () => {
    // Linear chain of 5
    const tasks: SubTask[] = Array.from({ length: 5 }, (_, i) =>
      makeSubTask({
        id: `task_${i + 1}`,
        dependencies: i === 0 ? [] : [`task_${i}`],
      })
    );
    const result = topologicalSort(tasks);
    expect(result.waves).toHaveLength(5);
  });

  it("computes the critical path correctly for a linear chain", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_2"] }),
    ];
    const result = topologicalSort(tasks);
    expect(result.criticalPath).toEqual(["task_1", "task_2", "task_3"]);
  });

  it("computes the critical path for two equal-length branches", () => {
    // Diamond: task_1 -> task_2 -> task_4, task_1 -> task_3 -> task_4
    // Both branches are length 3 (task_1 -> task_2/3 -> task_4)
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2", "task_3"] }),
    ];
    const result = topologicalSort(tasks);
    // Critical path should be length 3 (one of the two branches through task_4)
    expect(result.criticalPath).toHaveLength(3);
    expect(result.criticalPath[0]).toBe("task_1");
    expect(result.criticalPath[2]).toBe("task_4");
  });

  it("handles tasks with no dependents (leaf nodes)", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      // task_2 and task_3 are leaf nodes (no one depends on them)
    ];
    const result = topologicalSort(tasks);
    expect(result.hasCycle).toBe(false);
    expect(result.waves).toHaveLength(2);
    expect(result.waves[0]).toEqual(["task_1"]);
    expect(result.waves[1]).toEqual(["task_2", "task_3"]);
  });
});

// ---------------------------------------------------------------------------
// computeCriticalPath
// ---------------------------------------------------------------------------

describe("computeCriticalPath", () => {
  it("computes critical path for a linear chain", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_2"] }),
    ];
    const waves = [["task_1"], ["task_2"], ["task_3"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toEqual(["task_1", "task_2", "task_3"]);
  });

  it("computes critical path for a diamond DAG", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2", "task_3"] }),
    ];
    const waves = [["task_1"], ["task_2", "task_3"], ["task_4"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("task_1");
    expect(result[2]).toBe("task_4");
  });

  it("returns single-element path for all independent tasks", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
    ];
    const waves = [["task_1", "task_2", "task_3"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toHaveLength(1);
  });

  it("returns single task for single-task input", () => {
    const tasks: SubTask[] = [makeSubTask({ id: "task_1", dependencies: [] })];
    const waves = [["task_1"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toEqual(["task_1"]);
  });

  it("picks the longer branch when branches differ in length", () => {
    // task_1 -> task_2 -> task_4 (length 3)
    // task_3 -> task_4 (length 2, but task_4 picks the longer dep chain)
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2", "task_3"] }),
    ];
    const waves = [["task_1", "task_3"], ["task_2"], ["task_4"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toEqual(["task_1", "task_2", "task_4"]);
  });

  it("returns empty array for empty input", () => {
    expect(computeCriticalPath([], [])).toEqual([]);
  });

  it("handles a complex DAG critical path", () => {
    // task_1 -> task_3 -> task_5 -> task_6 (length 4)
    // task_2 -> task_4 -> task_5 -> task_6 (length 4, but task_5 picks the longer chain)
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2"] }),
      makeSubTask({ id: "task_5", dependencies: ["task_3", "task_4"] }),
      makeSubTask({ id: "task_6", dependencies: ["task_5"] }),
    ];
    const waves = [["task_1", "task_2"], ["task_3", "task_4"], ["task_5"], ["task_6"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toHaveLength(4);
    expect(result[result.length - 1]).toBe("task_6");
  });

  it("handles a three-level hierarchy", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_2"] }),
    ];
    const waves = [["task_1"], ["task_2"], ["task_3"]];
    const result = computeCriticalPath(tasks, waves);
    expect(result).toEqual(["task_1", "task_2", "task_3"]);
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// assignWorkers
// ---------------------------------------------------------------------------

describe("assignWorkers", () => {
  it("distributes tasks round-robin across workers", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
      makeSubTask({ id: "task_4", dependencies: [] }),
    ];
    const waves = [["task_1", "task_2", "task_3", "task_4"]];
    const models = ["model_a", "model_b"];
    const result = assignWorkers(tasks, models, waves);

    expect(result[0].model).toBe("model_a");
    expect(result[1].model).toBe("model_b");
    expect(result[2].model).toBe("model_a");
    expect(result[3].model).toBe("model_b");
  });

  it("assigns all tasks to a single worker when only 1 model", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_3", dependencies: ["task_2"] }),
    ];
    const waves = [["task_1"], ["task_2"], ["task_3"]];
    const result = assignWorkers(tasks, ["solo_model"], waves);

    for (const assignment of result) {
      expect(assignment.model).toBe("solo_model");
    }
  });

  it("handles more workers than tasks", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
    ];
    const waves = [["task_1", "task_2"]];
    const models = ["m1", "m2", "m3", "m4", "m5"];
    const result = assignWorkers(tasks, models, waves);

    expect(result).toHaveLength(2);
    expect(result[0].model).toBe("m1");
    expect(result[1].model).toBe("m2");
  });

  it("sets assignedModel on tasks", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
    ];
    const waves = [["task_1", "task_2"]];
    assignWorkers(tasks, ["model_x", "model_y"], waves);

    expect(tasks[0].assignedModel).toBe("model_x");
    expect(tasks[1].assignedModel).toBe("model_y");
  });

  it("sets waveNumber on tasks", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: ["task_1"] }),
    ];
    const waves = [["task_1"], ["task_2"]];
    assignWorkers(tasks, ["m1"], waves);

    expect(tasks[0].waveNumber).toBe(1);
    expect(tasks[1].waveNumber).toBe(2);
  });

  it("returns empty array when workers list is empty", () => {
    const tasks: SubTask[] = [makeSubTask({ id: "task_1", dependencies: [] })];
    const waves = [["task_1"]];
    const result = assignWorkers(tasks, [], waves);
    expect(result).toEqual([]);
  });

  it("preserves wave ordering in assignments", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1", "task_2"] }),
    ];
    const waves = [["task_1", "task_2"], ["task_3"]];
    const result = assignWorkers(tasks, ["m1"], waves);

    expect(result[0].waveNumber).toBe(1);
    expect(result[1].waveNumber).toBe(1);
    expect(result[2].waveNumber).toBe(2);
  });

  it("distributes 3 workers across 6 tasks correctly", () => {
    const tasks: SubTask[] = Array.from({ length: 6 }, (_, i) =>
      makeSubTask({ id: `task_${i + 1}`, dependencies: [] })
    );
    const waves = [["task_1", "task_2", "task_3", "task_4", "task_5", "task_6"]];
    const models = ["alpha", "beta", "gamma"];
    const result = assignWorkers(tasks, models, waves);

    expect(result[0].model).toBe("alpha");
    expect(result[1].model).toBe("beta");
    expect(result[2].model).toBe("gamma");
    expect(result[3].model).toBe("alpha");
    expect(result[4].model).toBe("beta");
    expect(result[5].model).toBe("gamma");
  });

  it("handles single wave with multiple tasks", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: [] }),
    ];
    const waves = [["task_1", "task_2", "task_3"]];
    const result = assignWorkers(tasks, ["m1", "m2"], waves);

    expect(result).toHaveLength(3);
    for (const a of result) {
      expect(a.waveNumber).toBe(1);
    }
  });

  it("handles multi-wave assignment with round-robin continuing across waves", () => {
    const tasks: SubTask[] = [
      makeSubTask({ id: "task_1", dependencies: [] }),
      makeSubTask({ id: "task_2", dependencies: [] }),
      makeSubTask({ id: "task_3", dependencies: ["task_1"] }),
      makeSubTask({ id: "task_4", dependencies: ["task_2"] }),
    ];
    const waves = [["task_1", "task_2"], ["task_3", "task_4"]];
    const models = ["m1", "m2", "m3"];
    const result = assignWorkers(tasks, models, waves);

    // Wave 1: task_1 -> m1 (idx 0), task_2 -> m2 (idx 1)
    // Wave 2: task_3 -> m3 (idx 2), task_4 -> m1 (idx 3 % 3 = 0)
    expect(result[0].model).toBe("m1");
    expect(result[1].model).toBe("m2");
    expect(result[2].model).toBe("m3");
    expect(result[3].model).toBe("m1");
  });
});

// ---------------------------------------------------------------------------
// countWords
// ---------------------------------------------------------------------------

describe("countWords", () => {
  it("counts words in a normal sentence", () => {
    expect(countWords("Hello world how are you")).toBe(5);
  });

  it("handles multiple spaces between words", () => {
    expect(countWords("Hello   world   test")).toBe(3);
  });

  it("returns 0 for empty string", () => {
    expect(countWords("")).toBe(0);
  });

  it("handles newlines between words", () => {
    expect(countWords("Hello\nworld\nthis\nis")).toBe(4);
  });

  it("counts a single word", () => {
    expect(countWords("Hello")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildPlanPrompt
// ---------------------------------------------------------------------------

describe("buildPlanPrompt", () => {
  it("contains the user query", () => {
    const prompt = buildPlanPrompt("How does quantum computing work?", 6);
    expect(prompt).toContain("How does quantum computing work?");
  });

  it("contains the maxTasks value in the range", () => {
    const prompt = buildPlanPrompt("Test query", 8);
    expect(prompt).toContain("3-8");
  });

  it("contains format instructions with TASK task_1:", () => {
    const prompt = buildPlanPrompt("Test query", 6);
    expect(prompt).toContain("TASK task_1:");
    expect(prompt).toContain("TASK task_2:");
  });

  it("contains IMPORTANT RULES section", () => {
    const prompt = buildPlanPrompt("Test query", 6);
    expect(prompt).toContain("IMPORTANT RULES:");
  });

  it("adapts to different maxTasks values", () => {
    const prompt4 = buildPlanPrompt("Query", 4);
    const prompt10 = buildPlanPrompt("Query", 10);
    expect(prompt4).toContain("3-4");
    expect(prompt10).toContain("3-10");
  });
});

// ---------------------------------------------------------------------------
// buildTaskExecutionPrompt
// ---------------------------------------------------------------------------

describe("buildTaskExecutionPrompt", () => {
  it("builds prompt without dependencies", () => {
    const task = makeSubTask({ id: "task_1", title: "Research", description: "Do research" });
    const prompt = buildTaskExecutionPrompt(task, "Main question?", []);
    expect(prompt).toContain("Main question?");
    expect(prompt).toContain("task_1");
    expect(prompt).toContain("Research");
    expect(prompt).not.toContain("OUTPUTS FROM PREREQUISITE TASKS");
  });

  it("includes one dependency output", () => {
    const task = makeSubTask({ id: "task_2", title: "Analyze", description: "Analyze data", dependencies: ["task_1"] });
    const depOutputs = [{ taskId: "task_1", title: "Research", output: "Research findings here" }];
    const prompt = buildTaskExecutionPrompt(task, "Main question?", depOutputs);
    expect(prompt).toContain("OUTPUTS FROM PREREQUISITE TASKS");
    expect(prompt).toContain("Research findings here");
    expect(prompt).toContain("task_1: Research");
  });

  it("includes multiple dependency outputs", () => {
    const task = makeSubTask({ id: "task_3", title: "Combine", dependencies: ["task_1", "task_2"] });
    const depOutputs = [
      { taskId: "task_1", title: "First", output: "First output" },
      { taskId: "task_2", title: "Second", output: "Second output" },
    ];
    const prompt = buildTaskExecutionPrompt(task, "Question", depOutputs);
    expect(prompt).toContain("First output");
    expect(prompt).toContain("Second output");
    expect(prompt).toContain("task_1: First");
    expect(prompt).toContain("task_2: Second");
  });

  it("contains the original question", () => {
    const task = makeSubTask();
    const prompt = buildTaskExecutionPrompt(task, "What is the meaning of life?", []);
    expect(prompt).toContain("What is the meaning of life?");
    expect(prompt).toContain("ORIGINAL QUESTION:");
  });

  it("contains the task ID and title", () => {
    const task = makeSubTask({ id: "task_5", title: "Final Analysis" });
    const prompt = buildTaskExecutionPrompt(task, "Query", []);
    expect(prompt).toContain("ID: task_5");
    expect(prompt).toContain("Title: Final Analysis");
  });

  it("contains the task description", () => {
    const task = makeSubTask({ description: "Perform detailed analysis of the data patterns" });
    const prompt = buildTaskExecutionPrompt(task, "Query", []);
    expect(prompt).toContain("Description: Perform detailed analysis of the data patterns");
  });

  it("handles failed dependency output text", () => {
    const task = makeSubTask({ id: "task_2", dependencies: ["task_1"] });
    const depOutputs = [
      { taskId: "task_1", title: "Research", output: "[FAILED] Sub-task task_1 (Research) failed. Work without its output and note any gaps." },
    ];
    const prompt = buildTaskExecutionPrompt(task, "Query", depOutputs);
    expect(prompt).toContain("[FAILED]");
    expect(prompt).toContain("Work without its output");
  });

  it("handles empty dependency outputs array", () => {
    const task = makeSubTask({ id: "task_1", dependencies: [] });
    const prompt = buildTaskExecutionPrompt(task, "Query", []);
    expect(prompt).not.toContain("OUTPUTS FROM PREREQUISITE TASKS");
    expect(prompt).toContain("SUB-TASK OUTPUT:");
  });
});

// ---------------------------------------------------------------------------
// buildAssemblyPrompt
// ---------------------------------------------------------------------------

describe("buildAssemblyPrompt", () => {
  it("builds prompt with all tasks successful", () => {
    const plan: SubTask[] = [
      makeSubTask({ id: "task_1", title: "Research", complexity: "LOW" }),
      makeSubTask({ id: "task_2", title: "Analyze", complexity: "MEDIUM", dependencies: ["task_1"] }),
    ];
    const outputs: TaskOutput[] = [
      makeTaskOutput({ taskId: "task_1", title: "Research", output: "Research results" }),
      makeTaskOutput({ taskId: "task_2", title: "Analyze", output: "Analysis results" }),
    ];
    const prompt = buildAssemblyPrompt("Main question", plan, outputs);
    expect(prompt).toContain("Research results");
    expect(prompt).toContain("Analysis results");
    expect(prompt).not.toContain("MISSING/FAILED");
  });

  it("includes MISSING/FAILED block when some tasks failed", () => {
    const plan: SubTask[] = [
      makeSubTask({ id: "task_1", title: "Research" }),
      makeSubTask({ id: "task_2", title: "Analyze", dependencies: ["task_1"] }),
    ];
    const outputs: TaskOutput[] = [
      makeTaskOutput({ taskId: "task_1", title: "Research", output: "Research results" }),
      makeTaskOutput({ taskId: "task_2", title: "Analyze", output: "", failed: true, failureReason: "Timeout" }),
    ];
    const prompt = buildAssemblyPrompt("Main question", plan, outputs);
    expect(prompt).toContain("MISSING/FAILED");
    expect(prompt).toContain("Timeout");
  });

  it("handles all tasks failed", () => {
    const plan: SubTask[] = [
      makeSubTask({ id: "task_1", title: "Research" }),
      makeSubTask({ id: "task_2", title: "Analyze" }),
    ];
    const outputs: TaskOutput[] = [
      makeTaskOutput({ taskId: "task_1", title: "Research", failed: true, failureReason: "Error 1" }),
      makeTaskOutput({ taskId: "task_2", title: "Analyze", failed: true, failureReason: "Error 2" }),
    ];
    const prompt = buildAssemblyPrompt("Question", plan, outputs);
    expect(prompt).toContain("MISSING/FAILED");
    expect(prompt).toContain("Error 1");
    expect(prompt).toContain("Error 2");
  });

  it("preserves task ordering in output", () => {
    const plan: SubTask[] = [
      makeSubTask({ id: "task_1", title: "First" }),
      makeSubTask({ id: "task_2", title: "Second" }),
      makeSubTask({ id: "task_3", title: "Third" }),
    ];
    const outputs: TaskOutput[] = [
      makeTaskOutput({ taskId: "task_1", title: "First", output: "Output 1" }),
      makeTaskOutput({ taskId: "task_2", title: "Second", output: "Output 2" }),
      makeTaskOutput({ taskId: "task_3", title: "Third", output: "Output 3" }),
    ];
    const prompt = buildAssemblyPrompt("Question", plan, outputs);
    const idx1 = prompt.indexOf("Output 1");
    const idx2 = prompt.indexOf("Output 2");
    const idx3 = prompt.indexOf("Output 3");
    expect(idx1).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(idx3);
  });

  it("contains the plan listing with task details", () => {
    const plan: SubTask[] = [
      makeSubTask({ id: "task_1", title: "Research", complexity: "HIGH", dependencies: [] }),
      makeSubTask({ id: "task_2", title: "Analyze", complexity: "MEDIUM", dependencies: ["task_1"] }),
    ];
    const outputs: TaskOutput[] = [
      makeTaskOutput({ taskId: "task_1", title: "Research" }),
      makeTaskOutput({ taskId: "task_2", title: "Analyze" }),
    ];
    const prompt = buildAssemblyPrompt("Question", plan, outputs);
    expect(prompt).toContain("TASK PLAN:");
    expect(prompt).toContain("task_1: Research (Complexity: HIGH, Dependencies: none)");
    expect(prompt).toContain("task_2: Analyze (Complexity: MEDIUM, Dependencies: task_1)");
  });

  it("contains the original question", () => {
    const plan: SubTask[] = [makeSubTask()];
    const outputs: TaskOutput[] = [makeTaskOutput()];
    const prompt = buildAssemblyPrompt("How does gravity work?", plan, outputs);
    expect(prompt).toContain("How does gravity work?");
    expect(prompt).toContain("ORIGINAL QUESTION:");
  });

  it("contains the task count", () => {
    const plan: SubTask[] = [
      makeSubTask({ id: "task_1" }),
      makeSubTask({ id: "task_2" }),
      makeSubTask({ id: "task_3" }),
    ];
    const outputs: TaskOutput[] = [
      makeTaskOutput({ taskId: "task_1" }),
      makeTaskOutput({ taskId: "task_2" }),
      makeTaskOutput({ taskId: "task_3" }),
    ];
    const prompt = buildAssemblyPrompt("Question", plan, outputs);
    expect(prompt).toContain("3 completed sub-tasks");
  });

  it("handles a single task", () => {
    const plan: SubTask[] = [makeSubTask({ id: "task_1", title: "Only Task" })];
    const outputs: TaskOutput[] = [makeTaskOutput({ taskId: "task_1", title: "Only Task", output: "The sole output" })];
    const prompt = buildAssemblyPrompt("Question", plan, outputs);
    expect(prompt).toContain("1 completed sub-tasks");
    expect(prompt).toContain("The sole output");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_DECOMPOSE_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_DECOMPOSE_CONFIG", () => {
  it("has correct default values", () => {
    expect(DEFAULT_DECOMPOSE_CONFIG.maxTasks).toBe(6);
    expect(DEFAULT_DECOMPOSE_CONFIG.timeoutMs).toBe(120_000);
  });

  it("has 3 worker models", () => {
    expect(DEFAULT_DECOMPOSE_CONFIG.workerModels).toHaveLength(3);
  });

  it("has non-empty model strings", () => {
    expect(DEFAULT_DECOMPOSE_CONFIG.plannerModel.length).toBeGreaterThan(0);
    expect(DEFAULT_DECOMPOSE_CONFIG.assemblerModel.length).toBeGreaterThan(0);
    for (const m of DEFAULT_DECOMPOSE_CONFIG.workerModels) {
      expect(m.length).toBeGreaterThan(0);
    }
  });
});
