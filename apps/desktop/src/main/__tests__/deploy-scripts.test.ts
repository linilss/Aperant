import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDeployScripts } from '../deploy-scripts';

describe('findDeployScripts', () => {
  let root: string;

  const write = (rel: string, content = '#!/bin/bash\n') => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'deploy-scripts-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds deploy*.sh in the root and nested folders, root first', async () => {
    write('deploy.sh');
    write('deploy-ios.sh');
    write('apple/deploy-ios.sh');
    write('build.sh');
    write('deployment-notes.sh');

    const scripts = await findDeployScripts(root);

    expect(scripts.map((s) => s.relativePath)).toEqual(['deploy-ios.sh', 'deploy.sh', 'apple/deploy-ios.sh']);
  });

  it('skips hidden, dependency and too-deep folders', async () => {
    write('node_modules/pkg/deploy.sh');
    write('.git/deploy.sh');
    write('a/b/c/deploy.sh');
    write('a/b/deploy.sh');

    const scripts = await findDeployScripts(root);

    expect(scripts.map((s) => s.relativePath)).toEqual(['a/b/deploy.sh']);
  });

  it('reads the leading comment block as description and usage', async () => {
    write(
      'deploy.sh',
      '#!/bin/bash\n# Build and push images to ACR.\n# Then restart the App Services.\n# Usage: ./deploy.sh [tag] [api|web|all]\nset -e\n# not part of the header\n'
    );

    const [script] = await findDeployScripts(root);

    expect(script.description).toBe('Build and push images to ACR. Then restart the App Services.');
    expect(script.usage).toBe('./deploy.sh [tag] [api|web|all]');
  });

  it('returns an empty description when the script has no header comment', async () => {
    write('deploy.sh', '#!/bin/bash\nset -e\n');

    const [script] = await findDeployScripts(root);

    expect(script.description).toBe('');
    expect(script.usage).toBeUndefined();
  });
});
