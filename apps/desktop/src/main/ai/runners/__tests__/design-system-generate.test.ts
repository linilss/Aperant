import { describe, expect, it, vi } from 'vitest';

vi.mock('../../cli/claude-cli', () => ({ runClaudeCliDetailed: vi.fn() }));
vi.mock('../../../cli-tool-manager', () => ({ getToolPath: () => 'git' }));

import { GENERATED_DESIGN_DIR, buildDesignGeneratePrompt } from '../design-system-generate';

describe('design system generation prompt', () => {
  it('writes only into the Malvy snapshot folder, in the Claude Design System layout', () => {
    const prompt = buildDesignGeneratePrompt('Chippio2');
    expect(GENERATED_DESIGN_DIR).toBe('.malvy/design-system/project');
    expect(prompt).toContain(`only inside ${GENERATED_DESIGN_DIR}/`);
    expect(prompt).toContain('tokens.json');
    expect(prompt).toContain('components/<Name>/README.md');
    expect(prompt).toContain('Do not invent a new look');
  });
});
