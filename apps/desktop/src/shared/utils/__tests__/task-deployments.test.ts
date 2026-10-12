import { describe, expect, it } from 'vitest';
import { resolveProjectDeployScript } from '../task-deployments';
import type { DeployScript } from '../../types';

const script = (relativePath: string): DeployScript => ({
  relativePath,
  name: relativePath.split('/').pop() ?? relativePath,
  description: ''
});

describe('resolveProjectDeployScript', () => {
  const scripts = [script('deploy.sh'), script('apple/deploy-ios.sh')];

  it('returns the configured script', () => {
    expect(resolveProjectDeployScript(scripts, { deployScript: 'apple/deploy-ios.sh' })?.relativePath).toBe(
      'apple/deploy-ios.sh'
    );
  });

  it('returns null when the configured script no longer exists', () => {
    expect(resolveProjectDeployScript(scripts, { deployScript: 'gone.sh' })).toBeNull();
  });

  it('falls back to the only script when nothing is configured', () => {
    expect(resolveProjectDeployScript([script('deploy.sh')], undefined)?.relativePath).toBe('deploy.sh');
  });

  it('asks (null) when several scripts exist and none is configured', () => {
    expect(resolveProjectDeployScript(scripts, {})).toBeNull();
  });
});
