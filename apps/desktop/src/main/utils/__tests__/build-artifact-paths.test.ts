import { describe, expect, it } from 'vitest';
import { isBuildArtifactPath } from '../build-artifact-paths';

describe('isBuildArtifactPath', () => {
  it('flags backslash names and build output folders', () => {
    expect(isBuildArtifactPath('src/Trainr.Web/bin\\Debug/net10.0/x.dll')).toBe(true);
    expect(isBuildArtifactPath('src/App/bin/Release/net10.0/App.dll')).toBe(true);
    expect(isBuildArtifactPath('src/App/obj/project.assets.json')).toBe(true);
    expect(isBuildArtifactPath('web/node_modules/a/index.js')).toBe(true);
  });

  it('keeps real source, including a scripts bin/ folder', () => {
    expect(isBuildArtifactPath('src/App/Program.cs')).toBe(false);
    expect(isBuildArtifactPath('bin/setup')).toBe(false);
    expect(isBuildArtifactPath('src/objects/Model.ts')).toBe(false);
  });
});
