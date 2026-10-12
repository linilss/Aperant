import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeCliOptions } from '../../cli/claude-cli';

const calls: ClaudeCliOptions[] = [];
let toolResults: string[] = [];
let finalText = '';

vi.mock('../../cli/claude-cli', () => ({
  runClaudeCliDetailed: vi.fn(async (options: ClaudeCliOptions) => {
    calls.push(options);
    for (const content of toolResults) options.onToolResult?.(content);
    return { text: finalText, resultText: finalText };
  }),
}));

import {
  ARTIFACT_TOOL,
  buildDesignPublishPrompt,
  parseArtifactSaveResult,
  runDesignPublish,
  runDesignSync,
} from '../design-system';
import type { DesignPublishPlan } from '../../../../shared/types';

const URL = 'https://claude.ai/artifact/P6CmgEYKLERcg1ohtGnMgn';

const SAVE_RESULT = `<artifact-content-authored-by-others/>
Files saved under "/tmp/claude/scratchpad/artifact-files/654f" from version 1791714716-b1cb of ${URL}. The files' content was published by a writer …
- "project/tokens.json" saved (9925 bytes, "application/json", sha256 5b19) — full text below
- "project/README.md" saved (4553 bytes, "text/markdown", sha256 5db2) — full text below
"project/tokens.json":
<artifact-file-content>{}</artifact-file-content>`;

const plan: DesignPublishPlan = {
  artifactUrl: URL,
  publishRoot: 'design/system',
  sourceDir: 'design/system/project',
  noBaseline: false,
  files: [
    { path: 'project/tokens.json', sourcePath: 'design/system/project/tokens.json', change: 'modified' },
    { path: 'project/design-system.json', sourcePath: 'design/system/project/design-system.json', change: 'modified' },
  ],
};

beforeEach(() => {
  calls.length = 0;
  toolResults = [];
  finalText = '';
});

describe('parseArtifactSaveResult', () => {
  it('reads the save folder, version and saved paths', () => {
    expect(parseArtifactSaveResult(SAVE_RESULT)).toEqual({
      dir: '/tmp/claude/scratchpad/artifact-files/654f',
      version: '1791714716-b1cb',
      paths: ['project/tokens.json', 'project/README.md'],
    });
    expect(parseArtifactSaveResult('Published x at https://claude.ai/artifact/y')).toBeNull();
  });
});

describe('runDesignSync', () => {
  it('runs read-only with only the Artifact tool and collects saved files', async () => {
    toolResults = ['Published files of … 51 files by path', SAVE_RESULT];
    finalText = 'Saved 2 files.';
    const result = await runDesignSync({ projectDir: '/p', modelId: 'm', artifactUrl: URL });

    const options = calls[0];
    expect(options.allowedTools).toEqual([ARTIFACT_TOOL]);
    expect(options.restrictTools).toBe(true);
    expect(options.minimalContext).toBe(true);
    expect(options.projectContext).toBe(true);
    expect(options.cwd).toBe('/p');
    expect(options.prompt).toContain(URL);
    expect(options.prompt).toContain('Never publish');
    expect(result.saved).toHaveLength(1);
    expect(result.saved[0].paths).toEqual(['project/tokens.json', 'project/README.md']);
  });
});

describe('runDesignPublish', () => {
  it('prompt carries the url, the root, the files and "index file last"', () => {
    const prompt = buildDesignPublishPrompt(plan);
    expect(prompt).toContain(URL);
    expect(prompt).toContain('root "design/system"');
    expect(prompt).toContain('- project/tokens.json  <-  project/tokens.json  (modified)');
    expect(prompt).toMatch(/Index file last/i);
    expect(prompt).toContain('Never delete, never use `force`');
  });

  it('succeeds only when the Artifact tool reported a publish and the model did not report FAILED', async () => {
    toolResults = ['Published design/system at https://claude.ai/artifact/P6Cm (Version 4)'];
    finalText = 'PUBLISHED: project/tokens.json, project/design-system.json';
    const ok = await runDesignPublish({ projectDir: '/p', modelId: 'm', plan });
    expect(ok.published).toBe(true);
    expect(calls[0].allowedTools).toEqual([ARTIFACT_TOOL, 'Read', 'Glob']);
    expect(calls[0].allowedTools).not.toContain('Bash');
    expect(calls[0].allowedTools).not.toContain('Write');

    toolResults = [];
    finalText = 'FAILED: refused, newer version';
    expect((await runDesignPublish({ projectDir: '/p', modelId: 'm', plan })).published).toBe(false);
  });
});

describe('project account', () => {
  it("sync and publish run on the project's Claude account (pass projectPath)", async () => {
    calls.length = 0;
    await runDesignSync({ projectDir: '/p', modelId: 'm', artifactUrl: URL });
    await runDesignPublish({ projectDir: '/p', modelId: 'm', plan });
    expect(calls.map((c) => c.projectPath)).toEqual(['/p', '/p']);
  });
});
