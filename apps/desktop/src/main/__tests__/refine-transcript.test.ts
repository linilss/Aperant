import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDecisionsSection, extractDecisions, readTranscript, saveTranscript } from '../refine-transcript';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const history = [
  { role: 'user' as const, content: 'I want to refine an existing roadmap feature called "Loans".' },
  {
    role: 'assistant' as const,
    content: '## What I found\nBoth apps plot one line.\n\nWhat should the toggles start as?\n\n**Options:**\n1. All on — quick lens\n2. Remember per device — sticky'
  },
  { role: 'user' as const, content: '1. All on — quick lens' },
  { role: 'assistant' as const, content: 'Where should the chart live?\n\n**Options:**\n1. Inline\n2. Detail screen' },
  { role: 'user' as const, content: 'Please synthesize the refined feature details now and output the feature_data block.' },
  { role: 'assistant' as const, content: '<feature_data>{}</feature_data>' }
];

describe('refine transcripts', () => {
  it('round-trips through the saved file, headings inside messages included', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'refine-'));
    saveTranscript(dir, 'feature-1', 'Loans', history);
    expect(readTranscript(dir, 'feature-1')).toEqual(history);
  });

  it('turns question/answer pairs into task decisions, skipping kickoff and finish', () => {
    expect(extractDecisions(history)).toEqual([
      { question: 'What should the toggles start as?', answer: '1. All on — quick lens' }
    ]);
    dir = mkdtempSync(path.join(tmpdir(), 'refine-'));
    saveTranscript(dir, 'feature-1', 'Loans', history);
    const section = buildDecisionsSection(dir, 'feature-1');
    expect(section).toContain('## Decisions from refinement');
    expect(section).toContain('**A:** 1. All on — quick lens');
    expect(buildDecisionsSection(dir, 'missing')).toBe('');
  });
});
