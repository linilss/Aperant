/**
 * Deploy outcome from the log a task deploy writes (`.malvy/deploys/<id>.log`, see
 * withDeployLog in the renderer): exit code, and what went out — an App Store /
 * TestFlight version + build, or a web version — read from the script's own output.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type { TaskDeployment } from '../shared/types';

export const DEPLOY_EXIT_MARKER = '__MALVY_DEPLOY_EXIT=';

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export interface DeployLogResult {
  done: boolean;
  exitCode?: number;
  version?: string;
  build?: string;
  /** The script's own success line, e.g. "TestFlight: 1.0.5 (202610131402) is VALID" */
  summary?: string;
  /** Steps that printed their __MALVY_STEP_OK marker */
  stepsOk: string[];
  webVersion?: string;
}

const lastMatch = (text: string, re: RegExp): RegExpMatchArray | null => {
  let found: RegExpMatchArray | null = null;
  for (const m of text.matchAll(new RegExp(re.source, `${re.flags.replace('g', '')}g`))) found = m;
  return found;
};

export function parseDeployLog(raw: string): DeployLogResult {
  const text = raw.replace(ANSI, '').replace(/\r/g, '');
  const exit = lastMatch(text, /__MALVY_DEPLOY_EXIT=(\d+)/);
  const stepsOk = [...text.matchAll(/__MALVY_STEP_OK=(.+)$/gm)].map((m) => m[1].trim());
  const result: DeployLogResult = { done: !!exit, stepsOk };
  if (exit) result.exitCode = Number(exit[1]);

  const testflight = lastMatch(text, /TestFlight:\s*([\d.]+)\s*\((\d{6,})\)/);
  const bumped = lastMatch(text, /Version\s+[\d.]+\s*->\s*([\d.]+)/);
  const build = lastMatch(text, /\bbuild\s+(\d{10,14})\b/i);
  const live = lastMatch(text, /^Live:\s*(\S+)/m);
  result.version = testflight?.[1] ?? bumped?.[1] ?? live?.[1];
  if (live && (testflight || bumped)) result.webVersion = live[1];
  result.build = testflight?.[2] ?? build?.[1];
  const summary = lastMatch(text, /^.*\b(TestFlight|Live)\b.*$/m);
  if (summary) result.summary = summary[0].replace(/^=+>\s*/, '').trim().slice(0, 160);
  return result;
}

/** A running deployment with its log resolved, or the same object when nothing changed. */
export function resolveDeployment(projectPath: string, deployment: TaskDeployment): TaskDeployment {
  if (deployment.status !== 'running' || !deployment.log) return deployment;
  const file = path.join(projectPath, deployment.log);
  if (!existsSync(file)) return deployment;
  let parsed: DeployLogResult;
  try {
    parsed = parseDeployLog(readFileSync(file, 'utf-8'));
  } catch {
    return deployment;
  }
  if (!parsed.done) return deployment;
  return {
    ...deployment,
    status: parsed.exitCode === 0 ? 'succeeded' : 'failed',
    ...(parsed.version ? { version: parsed.version } : {}),
    ...(parsed.build ? { build: parsed.build } : {}),
    ...(parsed.summary ? { summary: parsed.summary } : {}),
    ...(parsed.webVersion ? { webVersion: parsed.webVersion } : {}),
    ...(parsed.stepsOk.length > 0 ? { stepsOk: parsed.stepsOk } : {})
  };
}
