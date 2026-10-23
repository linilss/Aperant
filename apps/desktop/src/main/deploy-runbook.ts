/**
 * The project's deploy runbook: `.malvy/deploy.md`, read by the deploy agent the
 * Kanban Deploy button starts. Malvy-owned (never in the repo's tracked files).
 *
 * Shape (free markdown, two sections Malvy reads):
 *   ## Steps   — what to run, in order, with conditions ("only if apple/ changed")
 *   ## Verify  — shell commands Malvy itself runs after the agent; all must exit 0
 *                (one per line inside ```bash fences, or `- \`cmd\`` bullets)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export const DEPLOY_RUNBOOK_FILE = '.malvy/deploy.md';

export function readRunbook(projectPath: string): string | null {
  const file = path.join(projectPath, DEPLOY_RUNBOOK_FILE);
  try {
    return existsSync(file) ? readFileSync(file, 'utf-8') : null;
  } catch {
    return null;
  }
}

export function writeRunbook(projectPath: string, content: string): void {
  const file = path.join(projectPath, DEPLOY_RUNBOOK_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`, 'utf-8');
}

/** Body of a `## <heading>` section (up to the next `## `), or '' */
function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s+/.test(l) && heading.test(l.replace(/^##\s+/, '')));
  if (start === -1) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s+/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

/** Commands in the Verify section: lines in ``` fences, or `code` in bullets. Comments skipped. */
export function parseVerifyCommands(markdown: string): string[] {
  const body = section(markdown, /^verify\b/i);
  const commands: string[] = [];
  let inFence = false;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (line && !line.startsWith('#')) commands.push(line);
      continue;
    }
    const bullet = line.match(/^[-*]\s+`([^`]+)`/);
    if (bullet) commands.push(bullet[1].trim());
  }
  return commands;
}

/** The project's own deploy rules from CLAUDE.md ("Definition of done" / "Deploy" section), if any */
export function extractClaudeMdDeployRules(claudeMd: string): string {
  const lines = claudeMd.split('\n');
  const start = lines.findIndex((l) => /^#{2,3}\s+.*(definition of done|deploy|release)/i.test(l));
  if (start === -1) return '';
  const level = (lines[start].match(/^#+/) ?? ['##'])[0].length;
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  return lines.slice(start, end === -1 ? undefined : end).join('\n').trim();
}

/**
 * A first runbook from what the project has: its deploy*.sh scripts (root first, a
 * subfolder script only when that folder changed), smoke-test scripts, and the deploy
 * rules from CLAUDE.md quoted for the agent. The user edits it from there.
 */
export function seedRunbook(projectName: string, deployScripts: string[], smokeScripts: string[], claudeMd: string): string {
  const rules = extractClaudeMdDeployRules(claudeMd);
  const steps: string[] = [];
  let n = 1;
  for (const script of deployScripts.filter((s) => !s.includes('/'))) {
    steps.push(`${n++}. **${script.replace(/\.sh$/, '')}**: \`./${script}\``);
  }
  for (const smoke of smokeScripts) {
    steps.push(`${n++}. **smoke**: \`./${smoke}\` (after the deploys above)`);
  }
  for (const script of deployScripts.filter((s) => s.includes('/'))) {
    const folder = path.posix.dirname(script);
    steps.push(`${n++}. **${folder}**: \`./${script}\` — only if files under \`${folder}/\` changed since the last verified deploy`);
  }
  if (/\bpush\b/i.test(rules)) steps.push(`${n++}. **push**: commit any version bumps the scripts made, then \`git push origin HEAD\``);

  return [
    `# Deploy runbook — ${projectName}`,
    '',
    'The Kanban Deploy button follows this file: an agent picks the steps for what changed, Malvy runs them. Edit it freely.',
    '',
    '## Steps',
    '',
    ...(steps.length > 0 ? steps : ['1. (no deploy scripts found — describe the deploy here)']),
    '',
    ...(rules ? ['## Project rules (from CLAUDE.md)', '', ...rules.split('\n').map((l) => `> ${l}`.trimEnd()), ''] : []),
    '## Verify',
    '',
    'Malvy runs these itself after the agent finishes; every one must exit 0 for the deploy to count as live.',
    'Leave it empty to rely on the steps\' own exit codes (scripts that wait for /version or TestFlight already check).',
    '',
    '```bash',
    '# curl -fsS https://example.com/health',
    '```',
    ''
  ].join('\n');
}
