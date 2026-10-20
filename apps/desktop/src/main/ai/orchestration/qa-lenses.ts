/**
 * QA review lenses (after the /proofread skill)
 * =============================================
 *
 * Before the main QA reviewer runs, two independent read-only reviewers look at
 * the same diff with a different focus and model:
 *   - risk (deep):  bugs, data loss, security, races, migrations
 *   - scan (fast):  dead code, debug leftovers, naming, the project's own patterns
 * Their findings are handed to the main reviewer, which also checks every
 * acceptance criterion and runs the tests, then consolidates: dedupe, rank by
 * consensus, block only on critical findings and unmet criteria.
 */

import { execFileSync } from 'node:child_process';

import { safeParseJson } from '../../utils/json-repair';

export type LensId = 'risk' | 'scan';
export type FindingSeverity = 'critical' | 'major' | 'minor';

export interface LensFinding {
  severity: FindingSeverity;
  file: string;
  line?: number;
  issue: string;
  fix: string;
}

export interface LensResult {
  lens: LensId;
  findings: LensFinding[];
  /** Set when the lens could not run (the review continues without it) */
  error?: string;
}

/** Runs one read-only lens review; returns the model's text */
export type LensRunner = (input: { lens: LensId; prompt: string; model: string }) => Promise<string>;

/** Model per lens: a deep model for risks, a fast one for the scan */
export const LENS_MODELS: Record<LensId, string> = { risk: 'opus', scan: 'haiku' };

const MAX_DIFF_CHARS = 80_000;
const MAX_FINDINGS_PER_LENS = 15;

const LENS_FOCUS: Record<LensId, string> = {
  risk:
    'Focus on RISKS: logic bugs, null/undefined paths, missing error handling at boundaries (I/O, network, IPC), ' +
    'race conditions, data loss, security (injection, secrets, auth), broken migrations or contracts, and ' +
    'behaviour the spec did not ask for.',
  scan:
    'Focus on a FAST SCAN: dead or unreachable code, leftover debug output, unused variables/imports, misleading ' +
    'names, copy-paste slips, and places that break the patterns the surrounding code clearly uses.',
};

/** Branch the task was cut from: the first of the usual main branches that exists */
function resolveBase(projectDir: string): string | null {
  for (const ref of ['origin/main', 'main', 'origin/dev', 'dev', 'origin/develop', 'develop', 'origin/master', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: projectDir, stdio: 'ignore' });
      return execFileSync('git', ['merge-base', 'HEAD', ref], { cwd: projectDir, encoding: 'utf-8' }).trim() || null;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** The task's changes (committed and not) against its base, capped for the prompt; '' when unavailable */
export function readTaskDiff(projectDir: string): string {
  const base = resolveBase(projectDir);
  if (!base) return '';
  try {
    const stat = execFileSync('git', ['diff', '--stat', base], { cwd: projectDir, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 });
    const diff = execFileSync('git', ['diff', base, '--', '.', ':(exclude).malvy'], {
      cwd: projectDir,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const body = diff.length > MAX_DIFF_CHARS ? `${diff.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated; read the files for the rest)` : diff;
    return `${stat.trim()}\n\n${body}`;
  } catch {
    return '';
  }
}

export function buildLensPrompt(lens: LensId, diff: string, spec: string): string {
  return [
    `You are one of several independent code reviewers of a finished task. ${LENS_FOCUS[lens]}`,
    'You run non-interactively and are read-only: never edit files. Use Read/Grep/Glob only to check context the diff does not show.',
    'Rules: only report real issues you can point at (file + line). Do not flag style that matches the surrounding file. ' +
      'Do not re-litigate decisions the spec states. Do not suggest changes that alter intended behaviour. No findings is a fine answer.',
    `## Spec\n${spec.slice(0, 20_000) || '(none)'}`,
    `## Diff\n${diff || '(no diff available — read the changed files)'}`,
    'Finish with exactly one block, valid JSON, nothing after it:\n' +
      '<qa_findings>[{"severity":"critical|major|minor","file":"path","line":12,"issue":"one sentence","fix":"one sentence"}]</qa_findings>',
  ].join('\n\n');
}

const SEVERITIES: readonly FindingSeverity[] = ['critical', 'major', 'minor'];

/** Parse the last `<qa_findings>` block; [] when absent or unusable */
export function parseLensFindings(text: string): LensFinding[] {
  const body = [...text.matchAll(/<qa_findings>([\s\S]*?)<\/qa_findings>/g)].at(-1)?.[1];
  if (!body) return [];
  const raw = safeParseJson<unknown>(body.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => ({
      severity: (SEVERITIES as readonly string[]).includes(String(f.severity)) ? (f.severity as FindingSeverity) : 'minor',
      file: typeof f.file === 'string' ? f.file : '',
      line: typeof f.line === 'number' ? f.line : undefined,
      issue: typeof f.issue === 'string' ? f.issue.trim() : '',
      fix: typeof f.fix === 'string' ? f.fix.trim() : '',
    }))
    .filter((f) => f.issue)
    .slice(0, MAX_FINDINGS_PER_LENS);
}

/** Run both lenses in parallel; a lens that fails is reported, never fatal */
export async function runReviewLenses(diff: string, spec: string, runner: LensRunner): Promise<LensResult[]> {
  const lenses: LensId[] = ['risk', 'scan'];
  return Promise.all(
    lenses.map(async (lens) => {
      try {
        const text = await runner({ lens, prompt: buildLensPrompt(lens, diff, spec), model: LENS_MODELS[lens] });
        return { lens, findings: parseLensFindings(text) };
      } catch (error) {
        return { lens, findings: [], error: error instanceof Error ? error.message : String(error) };
      }
    })
  );
}

/** Prompt section for the main reviewer: the lens findings plus how to consolidate them */
export function buildLensSection(results: LensResult[]): string {
  const lines: string[] = ['## INDEPENDENT REVIEWS (consolidate these — /proofread style)'];
  for (const r of results) {
    lines.push(`### ${r.lens === 'risk' ? 'Risk review (deep model)' : 'Fast scan'}`);
    if (r.error) lines.push(`(did not run: ${r.error})`);
    else if (r.findings.length === 0) lines.push('(no findings)');
    else {
      for (const f of r.findings) {
        lines.push(`- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.issue} Fix: ${f.fix}`);
      }
    }
  }
  lines.push(
    '### How to consolidate',
    '- Verify each finding against the code yourself; drop the ones that are wrong.',
    '- Merge duplicates (same file, line and concern); a finding raised by more than one review ranks higher, but a single-review finding still counts.',
    '- REJECT only for: a failing test/verify command, an unmet acceptance criterion, or a verified critical finding. ' +
      'Major and minor findings go into qa_report.md under "Recommended Fixes" without blocking sign-off.',
    "- Don't flag style that matches the surrounding file. Don't re-litigate decisions the spec, the grill decisions or the refine decisions made — list such findings under \"Skipped (decided earlier)\".",
    ''
  );
  return lines.join('\n');
}

/** Extra rules for the main reviewer, always appended */
export const QA_CRITERIA_RULES = [
  '## ACCEPTANCE CRITERIA CHECKLIST (required in qa_report.md)',
  'Add a section "## Acceptance Criteria" listing EVERY acceptance criterion from the spec, each on its own line as',
  '`- ✅ <criterion> — <evidence: file:line, test name or screenshot>` or `- ❌ <criterion> — <what is missing>`.',
  'A criterion is met only with concrete evidence. Any ❌ means REJECTED.',
  '## TESTS FOR NEW BEHAVIOUR',
  'New or changed behaviour needs a test that would fail without the change. Existing tests that merely still pass are not evidence.',
  'Missing tests for new logic are a blocking finding (the fixer writes them). Pure UI/layout changes may rely on screenshots instead.',
  '',
].join('\n');

/** Count ✅ / ❌ lines in the report's Acceptance Criteria section */
export function countCriteria(report: string): { met: number; total: number } | null {
  const section = report.split(/^## Acceptance Criteria\s*$/m)[1];
  if (!section) return null;
  const body = section.split(/^## /m)[0];
  const met = (body.match(/^\s*-\s*✅/gm) ?? []).length;
  const unmet = (body.match(/^\s*-\s*❌/gm) ?? []).length;
  return met + unmet > 0 ? { met, total: met + unmet } : null;
}
