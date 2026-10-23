/**
 * Core values in the competitor funnel: first in the directions prompt, the
 * values_fit / conflicts_with_values fields (parse, sort, persist) and the
 * strategy guidance used by roadmap + ideation.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../prompts/prompt-loader', () => ({
  tryLoadPrompt: (name: string) => `# ${name}`,
}));

import { CORE_VALUES_HEADING } from '../../../../core-values';
import type { CompetitorProfile, CompetitorStrategyState, StrategicDirection } from '../../../../../shared/types/competitors';
import { buildStrategyGuidance, loadStrategyGuidance } from '../guidance';
import { emptyCompetitorState, loadCompetitorState, saveCompetitorState } from '../persistence';
import { buildDirectionsPrompt, parseDirections } from '../pipeline';

const VALUES = '- Kids can never lose.\n- No ads or dark patterns.';

const direction = (title: string, overrides: Partial<StrategicDirection> = {}): StrategicDirection => ({
  id: `dir-${title.toLowerCase()}`,
  title,
  description: '',
  occupiedBy: [],
  opportunity: '',
  fit: '',
  fitSources: [],
  risk: '',
  valuesFit: '',
  conflictsWithValues: false,
  avoid: false,
  note: '',
  ...overrides,
});

const analyzed = [{ name: 'Rival', positioning: 'Rival app' } as unknown as CompetitorProfile];

describe('core values in the competitor funnel', () => {
  let dir: string;
  const writeValues = (text: string) => {
    mkdirSync(path.join(dir, '.malvy'), { recursive: true });
    writeFileSync(path.join(dir, '.malvy', 'core-values.md'), text);
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'malvy-cv-competitors-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('directions prompt', () => {
    it('opens with the core values and asks for values_fit / conflicts_with_values', () => {
      writeValues(VALUES);
      const prompt = buildDirectionsPrompt(dir, emptyCompetitorState(), analyzed, 3, 5);

      expect(prompt.startsWith(CORE_VALUES_HEADING)).toBe(true);
      expect(prompt).toContain('Kids can never lose.');
      expect(prompt.indexOf(CORE_VALUES_HEADING)).toBeLessThan(prompt.indexOf('# competitor_directions'));
      expect(prompt).toContain('Only propose directions consistent with the CORE VALUES');
      expect(prompt).toContain('"conflicts_with_values": true');
    });

    it('has no core values section without values', () => {
      const prompt = buildDirectionsPrompt(dir, emptyCompetitorState(), analyzed, 3, 5);

      expect(prompt).not.toContain('## CORE VALUES');
      expect(prompt.startsWith('# competitor_directions')).toBe(true);
      expect(prompt).toContain('None set');
    });
  });

  describe('parseDirections', () => {
    const block = (list: unknown[]) => `<strategic_directions>${JSON.stringify(list)}</strategic_directions>`;

    it('reads values_fit, sorts conflicting directions last and suggests Avoid for them', () => {
      const directions = parseDirections(
        block([
          { title: 'Ad-supported', values_fit: 'Breaks "No ads".', conflicts_with_values: true },
          { title: 'Calm play', values_fit: 'Serves "Kids can never lose".', conflicts_with_values: false },
          { title: 'Co-op', values_fit: 'Nobody loses.' },
        ]),
        [],
        5,
      );

      expect(directions?.map((d) => d.title)).toEqual(['Calm play', 'Co-op', 'Ad-supported']);
      expect(directions?.[0]).toMatchObject({ valuesFit: 'Serves "Kids can never lose".', conflictsWithValues: false, avoid: false });
      expect(directions?.[2]).toMatchObject({ valuesFit: 'Breaks "No ads".', conflictsWithValues: true, avoid: true });
      expect(directions?.[1].conflictsWithValues).toBe(false);
    });

    it("keeps the user's earlier avoid decision for a same-titled conflicting direction", () => {
      const directions = parseDirections(
        block([{ title: 'Ad-supported', conflicts_with_values: true }]),
        [direction('Ad-supported', { avoid: false, note: 'Keep visible' })],
        5,
      );
      expect(directions?.[0]).toMatchObject({ conflictsWithValues: true, avoid: false, note: 'Keep visible' });
    });

    it('persists the values fields in strategy.json', () => {
      const state: CompetitorStrategyState = {
        ...emptyCompetitorState(),
        directions: [direction('Ads', { valuesFit: 'Breaks No ads', conflictsWithValues: true, avoid: true })],
      };
      saveCompetitorState(dir, state);

      expect(loadCompetitorState(dir)?.directions[0]).toMatchObject({
        valuesFit: 'Breaks No ads',
        conflictsWithValues: true,
      });
    });
  });

  describe('strategy guidance', () => {
    const ranked = (): CompetitorStrategyState => ({
      ...emptyCompetitorState(),
      directions: [direction('Calm'), direction('Ads', { avoid: true, conflictsWithValues: true })],
      rankingSavedAt: '2026-10-10T00:00:00.000Z',
    });

    it('puts the core values above pursue/avoid', () => {
      const text = buildStrategyGuidance(ranked(), VALUES);

      const values = text.indexOf(CORE_VALUES_HEADING);
      expect(values).toBeGreaterThanOrEqual(0);
      expect(values).toBeLessThan(text.indexOf('**STRATEGIC DIRECTION**'));
      expect(values).toBeLessThan(text.indexOf('Pursue, in priority order'));
      expect(text).toContain('subordinate to the CORE VALUES');
      expect(text).toMatch(/Ads \(flagged as conflicting with the core values/);
    });

    it('only refers to the values when the caller already shows them', () => {
      const text = buildStrategyGuidance(ranked(), VALUES, { valuesAlreadyShown: true });
      expect(text).not.toContain(CORE_VALUES_HEADING);
      expect(text).toContain('subordinate to the CORE VALUES');
    });

    it('gives the values alone without a saved ranking, and nothing when both are empty', () => {
      expect(buildStrategyGuidance(null, VALUES).trim().startsWith(CORE_VALUES_HEADING)).toBe(true);
      expect(buildStrategyGuidance(null, '')).toBe('');
      expect(buildStrategyGuidance(ranked(), '')).not.toContain('CORE VALUES');
    });

    it('loads the values from the project', () => {
      writeValues(VALUES);
      expect(loadStrategyGuidance(dir)).toContain(CORE_VALUES_HEADING);
      expect(loadStrategyGuidance(dir, { valuesAlreadyShown: true })).toBe('');
    });
  });
});
