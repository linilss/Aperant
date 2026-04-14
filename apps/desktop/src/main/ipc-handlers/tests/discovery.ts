import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import type { TestProject } from '../../../shared/types/tests';

/**
 * Recursively collect files matching a predicate, up to `maxDepth` directory
 * levels below the `rootDir`.  Skips `node_modules` and hidden directories
 * (names starting with `.`) to keep discovery fast.
 */
async function walkDirectory(
  dir: string,
  predicate: (filePath: string) => boolean,
  maxDepth: number,
  currentDepth = 0,
): Promise<string[]> {
  if (currentDepth > maxDepth) return [];

  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];

  for (const entry of entries) {
    // Skip hidden dirs and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = await walkDirectory(fullPath, predicate, maxDepth, currentDepth + 1);
      results.push(...sub);
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Returns true for .csproj files whose name matches the test project naming
 * conventions: *.Tests.csproj, *.Test.csproj
 */
function isDotnetTestProject(filePath: string): boolean {
  const name = path.basename(filePath);
  return /\.(Tests|Test)\.csproj$/i.test(name);
}

/**
 * Returns true for package.json files (node_modules already excluded above).
 */
function isPackageJson(filePath: string): boolean {
  return path.basename(filePath) === 'package.json';
}

/**
 * Reads a package.json file and returns true when it defines a "test" script.
 */
async function hasTestScript(packageJsonPath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const json = JSON.parse(content) as { scripts?: Record<string, string> };
    return typeof json.scripts?.test === 'string' && json.scripts.test.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Derives a stable, relative project ID from the absolute project path and the
 * root directory.  Uses forward slashes for consistency across platforms.
 */
function makeProjectId(projectDir: string, absolutePath: string): string {
  return path.relative(projectDir, absolutePath).replace(/\\/g, '/');
}

/**
 * Derives a human-readable name from a file path.
 * For .csproj files: filename stem (e.g. `MyApp.Tests`).
 * For package.json files: parent directory name.
 */
function makeProjectName(filePath: string): string {
  const basename = path.basename(filePath);
  if (basename === 'package.json') {
    return path.basename(path.dirname(filePath));
  }
  return basename.replace(/\.csproj$/i, '');
}

/**
 * Discovers test projects under `projectDir` (up to 4 levels deep).
 *
 * Finds:
 *  - *.Tests.csproj / *.Test.csproj  → type: 'dotnet'
 *  - package.json with a "test" script → type: 'node'
 */
export async function discoverTestProjects(projectDir: string): Promise<TestProject[]> {
  const [csprojFiles, packageJsonFiles] = await Promise.all([
    walkDirectory(projectDir, isDotnetTestProject, 4),
    walkDirectory(projectDir, isPackageJson, 4),
  ]);

  const testProjects: TestProject[] = [];

  for (const csprojPath of csprojFiles) {
    testProjects.push({
      id: makeProjectId(projectDir, csprojPath),
      name: makeProjectName(csprojPath),
      path: csprojPath,
      type: 'dotnet',
      tests: [],
      isRunning: false,
    });
  }

  // Check each package.json for a test script
  const nodeChecks = await Promise.all(
    packageJsonFiles.map(async (pkgPath) => {
      const has = await hasTestScript(pkgPath);
      return has ? pkgPath : null;
    }),
  );

  for (const pkgPath of nodeChecks) {
    if (!pkgPath) continue;
    testProjects.push({
      id: makeProjectId(projectDir, pkgPath),
      name: makeProjectName(pkgPath),
      path: pkgPath,
      type: 'node',
      tests: [],
      isRunning: false,
    });
  }

  return testProjects;
}
