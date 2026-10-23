import { readdir, readFile } from 'fs/promises';
import path from 'path';
import type { DeployScript } from '../shared/types';

const DEPLOY_SCRIPT_PATTERN = /^deploy([-_.][\w.-]+)?\.sh$/i;
const IGNORED_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', 'build', 'out', 'vendor', 'Pods']);
const MAX_DEPTH = 2;

/**
 * Finds `deploy*.sh` scripts in the project root and up to two directory levels below it
 * (e.g. `deploy.sh`, `deploy-ios.sh`, `apple/deploy-ios.sh`), sorted root-first.
 */
export async function findDeployScripts(projectPath: string): Promise<DeployScript[]> {
  const found: string[] = [];
  await walk(projectPath, '', 0, found);

  const scripts = await Promise.all(found.map((rel) => describeScript(projectPath, rel)));
  return scripts.sort(
    (a, b) =>
      a.relativePath.split('/').length - b.relativePath.split('/').length ||
      a.relativePath.localeCompare(b.relativePath)
  );
}

async function walk(root: string, rel: string, depth: number, found: string[]): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isFile() && DEPLOY_SCRIPT_PATTERN.test(entry.name)) {
      found.push(entryRel);
    } else if (
      entry.isDirectory() &&
      depth < MAX_DEPTH &&
      !entry.name.startsWith('.') &&
      !IGNORED_DIRS.has(entry.name)
    ) {
      await walk(root, entryRel, depth + 1, found);
    }
  }
}

/** Reads the leading comment block: description lines plus an optional `Usage:` line. */
async function describeScript(projectPath: string, relativePath: string): Promise<DeployScript> {
  const content = await readFile(path.join(projectPath, relativePath), 'utf-8').catch(() => '');
  const description: string[] = [];
  let usage: string | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#!')) continue;
    if (!trimmed.startsWith('#')) {
      if (trimmed === '' && description.length === 0) continue;
      break;
    }
    const text = trimmed.replace(/^#+\s?/, '').trim();
    const usageMatch = text.match(/^usage:\s*(.+)$/i);
    if (usageMatch) {
      usage = usageMatch[1];
    } else if (text) {
      description.push(text);
    }
  }

  return {
    relativePath,
    name: path.basename(relativePath),
    description: description.join(' '),
    usage
  };
}
