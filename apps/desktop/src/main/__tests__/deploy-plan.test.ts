import { describe, expect, it, vi } from 'vitest';

vi.mock('../cli-tool-manager', () => ({ getToolPath: () => 'git' }));

import { deployChainFor, lastSuccessfulCommits, planDeploySteps, watchedFolder } from '../deploy-plan';
import { buildChainCommand } from '../../renderer/components/deploy/deploy-command';

describe('deployChainFor', () => {
  it('uses the configured chain', () => {
    expect(deployChainFor(['deploy.sh', 'scripts/smoke-prod.sh'], ['deploy.sh', 'apple/deploy-ios.sh'])).toEqual([
      'deploy.sh',
      'scripts/smoke-prod.sh'
    ]);
  });

  it('runs every deploy script when each folder has one', () => {
    expect(deployChainFor(undefined, ['deploy.sh', 'apple/deploy-ios.sh'])).toEqual(['deploy.sh', 'apple/deploy-ios.sh']);
  });

  it('asks (or uses the chosen script) when several share a folder', () => {
    const discovered = ['deploy-android.sh', 'deploy-ios.sh', 'deploy.sh'];
    expect(deployChainFor(undefined, discovered)).toEqual([]);
    expect(deployChainFor([], discovered, 'deploy.sh')).toEqual(['deploy.sh']);
  });
});

describe('planDeploySteps', () => {
  it('skips a subfolder deploy whose folder did not change since it last succeeded', () => {
    const changed = vi.fn((_from: string, folder: string) => folder !== 'apple');
    const steps = planDeploySteps(
      ['deploy.sh', 'scripts/smoke-prod.sh', 'apple/deploy-ios.sh'],
      new Map([['apple/deploy-ios.sh', 'abc']]),
      changed
    );
    expect(steps.map((s) => [s.script, s.run, s.reason])).toEqual([
      ['deploy.sh', true, 'always'],
      ['scripts/smoke-prod.sh', true, 'always'],
      ['apple/deploy-ios.sh', false, 'unchanged']
    ]);
  });

  it('runs a subfolder deploy that never succeeded', () => {
    expect(planDeploySteps(['apple/deploy-ios.sh'], new Map(), () => false)[0]).toMatchObject({ run: true, reason: 'first' });
  });

  it('only deploy scripts watch their folder', () => {
    expect(watchedFolder('apple/deploy-ios.sh')).toBe('apple');
    expect(watchedFolder('scripts/smoke-prod.sh')).toBeNull();
    expect(watchedFolder('deploy.sh')).toBeNull();
  });

  it('takes the newest successful commit per step', () => {
    const map = lastSuccessfulCommits([
      { script: 'x', at: '2026-10-01', commit: 'old', stepsOk: ['apple/deploy-ios.sh'] },
      { script: 'x', at: '2026-10-05', commit: 'new', stepsOk: ['apple/deploy-ios.sh', 'deploy.sh'] },
      { script: 'x', at: '2026-10-09', commit: 'failed' }
    ]);
    expect(map.get('apple/deploy-ios.sh')).toBe('new');
  });
});

describe('buildChainCommand', () => {
  it('chains steps with success markers, args only for a lone step', () => {
    expect(buildChainCommand(['deploy.sh', 'apple/deploy-ios.sh'], 'prod')).toBe(
      `bash './deploy.sh' && echo "__MALVY_STEP_OK=deploy.sh" && bash './apple/deploy-ios.sh' && echo "__MALVY_STEP_OK=apple/deploy-ios.sh"`
    );
    expect(buildChainCommand(['deploy.sh'], 'prod')).toBe(`bash './deploy.sh' prod && echo "__MALVY_STEP_OK=deploy.sh"`);
  });
});
