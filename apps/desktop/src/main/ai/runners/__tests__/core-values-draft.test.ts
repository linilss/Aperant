import { describe, expect, it, vi } from 'vitest';

const cliMock = vi.fn();
vi.mock('../../cli/claude-cli', () => ({
  runClaudeCliDetailed: (opts: unknown) => cliMock(opts),
}));
vi.mock('../competitors/project-brief', () => ({
  buildProjectBrief: () => '### Source: .malvy/docs/project_summary.json\nA memory game for toddlers',
}));

import {
  CORE_VALUES_DRAFT_MAX_TURNS,
  buildCoreValuesDraftPrompt,
  parseCoreValuesDraft,
  runCoreValuesDraft,
} from '../core-values-draft';

describe('core values draft', () => {
  it('builds the prompt from the project brief', () => {
    const prompt = buildCoreValuesDraftPrompt('/p');
    expect(prompt).toContain('A memory game for toddlers');
    expect(prompt).toContain('<core_values>');
  });

  it('parses the last block, stripping fences', () => {
    expect(parseCoreValuesDraft('<core_values>x</core_values> <core_values>```md\n- Calm\n```</core_values>')).toBe('- Calm');
    expect(parseCoreValuesDraft('no block')).toBeNull();
    expect(parseCoreValuesDraft('<core_values>  </core_values>')).toBeNull();
  });

  it('runs read-only with project context and few turns', async () => {
    cliMock.mockResolvedValueOnce({ text: '<core_values>- Kids can never lose.</core_values>', resultText: '' });

    await expect(runCoreValuesDraft({ projectDir: '/p', modelId: 'm' })).resolves.toBe('- Kids can never lose.');
    expect(cliMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedTools: ['Read', 'Glob', 'Grep'],
        restrictTools: true,
        minimalContext: true,
        projectContext: true,
        maxTurns: CORE_VALUES_DRAFT_MAX_TURNS,
      }),
    );
  });

  it("runs on the project's Claude account (passes projectPath)", async () => {
    cliMock.mockResolvedValueOnce({ text: '<core_values>- Calm</core_values>', resultText: '' });
    await runCoreValuesDraft({ projectDir: '/p', modelId: 'm' });
    expect(cliMock).toHaveBeenLastCalledWith(expect.objectContaining({ projectPath: '/p', cwd: '/p' }));
  });

  it('throws without a block', async () => {
    cliMock.mockResolvedValueOnce({ text: 'sorry', resultText: '' });
    await expect(runCoreValuesDraft({ projectDir: '/p', modelId: 'm' })).rejects.toThrow('<core_values>');
  });
});
