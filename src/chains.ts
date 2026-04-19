/**
 * Task chaining / DAG support.
 * Manages dependency relationships between tasks and triggers
 * dependent tasks when their prerequisites complete successfully.
 */

import { listTasks, getTask } from './tasks.js';
import { getLatestRunForTask, createRun, updateRun } from './runs.js';
import { getTaskFilePath } from './tasks.js';
import { TaskDefinition, RunRecord } from './types.js';

/**
 * Validate a DAG for cycles, missing dependencies, and self-references.
 * Returns an array of error messages (empty = valid).
 */
export function validateDAG(taskId?: string): string[] {
  const errors: string[] = [];
  const allTasks = listTasks();
  const taskMap = new Map<string, string[]>(); // id → dependsOn

  for (const t of allTasks) {
    const full = getTask(t.id);
    if (full?.dependsOn && full.dependsOn.length > 0) {
      taskMap.set(t.id, full.dependsOn);
    }
  }

  // If validating a specific task, only check that subgraph
  const tasksToCheck = taskId ? [taskId] : [...taskMap.keys()];

  for (const id of tasksToCheck) {
    const deps = taskMap.get(id) || [];

    // Self-reference check
    if (deps.includes(id)) {
      errors.push(`Task "${id}" depends on itself`);
    }

    // Missing dependency check
    const allIds = new Set(allTasks.map(t => t.id));
    for (const dep of deps) {
      if (!allIds.has(dep)) {
        errors.push(`Task "${id}" depends on non-existent task "${dep}"`);
      }
    }
  }

  // Cycle detection using DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node].join(' → ');
      errors.push(`Circular dependency detected: ${cycle}`);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    for (const dep of (taskMap.get(node) || [])) {
      if (dfs(dep, path)) return true;
    }

    path.pop();
    inStack.delete(node);
    return false;
  }

  for (const id of taskMap.keys()) {
    if (!visited.has(id)) {
      dfs(id, []);
    }
  }

  return errors;
}

/**
 * Get all tasks that depend on a given task (direct dependents only).
 */
export function getDependents(taskId: string): TaskDefinition[] {
  const allTasks = listTasks();
  const dependents: TaskDefinition[] = [];

  for (const t of allTasks) {
    const full = getTask(t.id);
    if (full?.dependsOn?.includes(taskId)) {
      dependents.push(full);
    }
  }

  return dependents;
}

/**
 * Check if all dependencies of a task have been met.
 * "Met" = most recent run of each dependency was 'success'.
 */
export function areDependenciesMet(taskId: string): { met: boolean; details: DependencyStatus[] } {
  const task = getTask(taskId);
  if (!task?.dependsOn || task.dependsOn.length === 0) {
    return { met: true, details: [] };
  }

  const details: DependencyStatus[] = [];
  let allMet = true;

  for (const depId of task.dependsOn) {
    const depTask = getTask(depId);
    if (!depTask) {
      details.push({ taskId: depId, status: 'missing', met: false });
      allMet = false;
      continue;
    }

    if (!depTask.enabled) {
      details.push({ taskId: depId, status: 'disabled', met: false });
      allMet = false;
      continue;
    }

    const lastRun = getLatestRunForTask(depId);
    if (!lastRun) {
      details.push({ taskId: depId, status: 'never_run', met: false });
      allMet = false;
      continue;
    }

    const met = lastRun.status === 'success';
    details.push({
      taskId: depId,
      status: lastRun.status,
      met,
      runId: lastRun.runId,
      finishedAt: lastRun.finishedAt,
    });
    if (!met) allMet = false;
  }

  return { met: allMet, details };
}

export interface DependencyStatus {
  taskId: string;
  status: string;
  met: boolean;
  runId?: string;
  finishedAt?: string;
}

/**
 * After a task completes successfully, find and trigger eligible dependent tasks.
 * Returns the list of tasks that were triggered.
 */
export function triggerDependents(
  completedTaskId: string,
  chainId?: string,
): TriggeredTask[] {
  const dependents = getDependents(completedTaskId);
  const triggered: TriggeredTask[] = [];

  const effectiveChainId = chainId || `chain-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  for (const dep of dependents) {
    // Skip disabled tasks
    if (!dep.enabled) continue;

    // Check if ALL dependencies are met (not just the one that completed)
    const { met } = areDependenciesMet(dep.id);
    if (!met) continue;

    // Check if this task already has an active run (prevent double-triggering)
    const latestRun = getLatestRunForTask(dep.id);
    if (latestRun && (latestRun.status === 'running' || latestRun.status === 'queued')) {
      continue;
    }

    triggered.push({
      taskId: dep.id,
      chainId: effectiveChainId,
      triggeredBy: completedTaskId,
    });
  }

  return triggered;
}

export interface TriggeredTask {
  taskId: string;
  chainId: string;
  triggeredBy: string;
}

/**
 * Get a topological ordering of tasks (for display/planning).
 * Tasks with no dependencies come first.
 */
export function getTopologicalOrder(): string[] {
  const allTasks = listTasks();
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const t of allTasks) {
    graph.set(t.id, []);
    inDegree.set(t.id, 0);
  }

  // Build graph
  for (const t of allTasks) {
    const full = getTask(t.id);
    if (full?.dependsOn) {
      for (const dep of full.dependsOn) {
        if (graph.has(dep)) {
          graph.get(dep)!.push(t.id);
          inDegree.set(t.id, (inDegree.get(t.id) || 0) + 1);
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);

    for (const neighbor of (graph.get(node) || [])) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return order;
}

/**
 * Get a visual representation of the task dependency graph
 */
export function getDAGDisplay(): string {
  const allTasks = listTasks();
  const lines: string[] = [];

  const tasksWithDeps: { id: string; deps: string[] }[] = [];
  const independentTasks: string[] = [];

  for (const t of allTasks) {
    const full = getTask(t.id);
    if (full?.dependsOn && full.dependsOn.length > 0) {
      tasksWithDeps.push({ id: t.id, deps: full.dependsOn });
    } else {
      independentTasks.push(t.id);
    }
  }

  if (tasksWithDeps.length === 0) {
    return 'No task dependencies configured.';
  }

  lines.push('Task Dependency Graph:');
  lines.push('');

  for (const { id, deps } of tasksWithDeps) {
    const depsStr = deps.join(', ');
    const { met } = areDependenciesMet(id);
    const status = met ? '✓ ready' : '⏳ waiting';
    lines.push(`  ${id} ← [${depsStr}] (${status})`);
  }

  if (independentTasks.length > 0) {
    lines.push('');
    lines.push(`Independent tasks: ${independentTasks.join(', ')}`);
  }

  return lines.join('\n');
}
