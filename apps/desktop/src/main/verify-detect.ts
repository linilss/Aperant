/**
 * Verify command when the project sets none: build + tests detected from the
 * project's files. "none" in the settings turns the gate off.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', '.malvy', 'bin', 'obj', 'dist', 'out', 'build', '.build']);

/** Test projects (*Tests.csproj / *.Tests.csproj) up to two levels down */
function dotnetTestProjects(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, depth: number) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP.has(e.name) && depth < 2) walk(path.join(current, e.name), depth + 1);
      else if (e.isFile() && /tests?\.csproj$/i.test(e.name)) found.push(path.relative(dir, path.join(current, e.name)));
    }
  };
  walk(dir, 0);
  return found.sort();
}

/** Detected verify command for a project; undefined when nothing fits */
export function detectVerifyCommand(projectPath: string): string | undefined {
  const parts: string[] = [];

  const pkgFile = path.join(projectPath, 'package.json');
  if (existsSync(pkgFile)) {
    try {
      const scripts = (JSON.parse(readFileSync(pkgFile, 'utf-8')) as { scripts?: Record<string, string> }).scripts ?? {};
      if (scripts.typecheck) parts.push('npm run typecheck');
      if (scripts.test && !/no test specified/.test(scripts.test)) parts.push('npm test');
    } catch {
      // unreadable package.json: skip Node
    }
  }

  // .NET: run the test projects (building a MAUI solution would be slow and needs device workloads)
  const tests = dotnetTestProjects(projectPath);
  for (const t of tests) parts.push(`dotnet test "${t}" -v q -nologo`);

  if (existsSync(path.join(projectPath, 'Package.swift'))) parts.push('swift test');

  return parts.length > 0 ? parts.join(' && ') : undefined;
}

/** The verify command a task uses: the setting, "none" = off, empty = detected */
export function resolveVerifyCommand(setting: string | undefined, projectPath: string): string | undefined {
  const value = setting?.trim();
  if (value?.toLowerCase() === 'none') return undefined;
  return value || detectVerifyCommand(projectPath);
}
