import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { TestSolution } from '../../../shared/types/tests';

const SOLUTION_RELATIVE_PATH = path.join('.auto-claude', 'tests', 'solution.json');

function solutionPath(projectDir: string): string {
  return path.join(projectDir, SOLUTION_RELATIVE_PATH);
}

/**
 * Persists the test solution to `.auto-claude/tests/solution.json`.
 * Creates parent directories if they do not exist.
 */
export async function saveSolution(projectDir: string, solution: TestSolution): Promise<void> {
  const filePath = solutionPath(projectDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(solution, null, 2), 'utf-8');
}

/**
 * Loads the test solution from `.auto-claude/tests/solution.json`.
 * Returns null when the file is missing or unreadable.
 */
export async function loadSolution(projectDir: string): Promise<TestSolution | null> {
  try {
    const content = await fs.readFile(solutionPath(projectDir), 'utf-8');
    return JSON.parse(content) as TestSolution;
  } catch {
    return null;
  }
}
