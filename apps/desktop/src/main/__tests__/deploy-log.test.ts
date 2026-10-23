import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDeployLog, resolveDeployment } from '../deploy-log';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('parseDeployLog', () => {
  it('is not done without the exit marker', () => {
    expect(parseDeployLog('==> Archiving build 202610131402\n').done).toBe(false);
  });

  it('reads a Trainr-style TestFlight result', () => {
    const r = parseDeployLog(
      '==> Version 1.0.4 -> 1.0.5\n==> Archiving build 202610131402\nTestFlight: 1.0.5 (202610131402) is VALID (internal group)\n__MALVY_DEPLOY_EXIT=0\n'
    );
    expect(r).toMatchObject({ done: true, exitCode: 0, version: '1.0.5', build: '202610131402' });
    expect(r.summary).toContain('TestFlight: 1.0.5');
  });

  it('reads a Memory-style result (version bump + build line)', () => {
    const r = parseDeployLog('\u001b[32m==> Version 1.0.4 -> 1.0.5\u001b[0m\n==> Publishing build 202610131402\nTestFlight: build 202610131402 is VALID\n__MALVY_DEPLOY_EXIT=0');
    expect(r).toMatchObject({ version: '1.0.5', build: '202610131402' });
  });

  it('reads a web deploy and a failure', () => {
    expect(parseDeployLog('Live: 20261013-abc123\n__MALVY_DEPLOY_EXIT=0').version).toBe('20261013-abc123');
    expect(parseDeployLog('error MSB3552\n__MALVY_DEPLOY_EXIT=1').exitCode).toBe(1);
  });
});

describe('resolveDeployment', () => {
  it('turns a finished running deploy into succeeded/failed with its version', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'deploylog-'));
    mkdirSync(path.join(dir, '.malvy', 'deploys'), { recursive: true });
    writeFileSync(path.join(dir, '.malvy/deploys/a.log'), 'TestFlight: 1.0.5 (202610131402) is VALID\n__MALVY_DEPLOY_EXIT=0\n');
    const d = { script: 'apple/deploy-ios.sh', at: 'T', log: '.malvy/deploys/a.log', status: 'running' as const };
    expect(resolveDeployment(dir, d)).toMatchObject({ status: 'succeeded', version: '1.0.5', build: '202610131402' });
    const old = { script: 'deploy.sh', at: 'T' };
    expect(resolveDeployment(dir, old)).toBe(old);
  });
});
