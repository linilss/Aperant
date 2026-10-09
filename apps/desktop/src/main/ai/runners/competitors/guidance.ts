/**
 * Funnel handoff: turn the user's ranked strategic directions into a prompt
 * section for downstream generation (roadmap discovery/features, ideation).
 */

import type { CompetitorStrategyState, StrategicDirection } from '../../../../shared/types/competitors';
import { loadCompetitorState } from './persistence';

/** How many top non-avoided directions count as "pursue" */
export const PURSUE_COUNT = 3;

export interface RankedDirections {
  pursue: StrategicDirection[];
  later: StrategicDirection[];
  avoid: StrategicDirection[];
}

/** Split ranked directions; empty when the user never saved a ranking */
export function splitRankedDirections(state: CompetitorStrategyState | null): RankedDirections {
  if (!state?.rankingSavedAt || state.directions.length === 0) return { pursue: [], later: [], avoid: [] };
  const active = state.directions.filter((d) => !d.avoid);
  return {
    pursue: active.slice(0, PURSUE_COUNT),
    later: active.slice(PURSUE_COUNT),
    avoid: state.directions.filter((d) => d.avoid),
  };
}

const noteSuffix = (d: StrategicDirection) => (d.note ? ` User note: "${d.note}"` : '');

/**
 * Prompt section built from a saved ranking; '' when there is none.
 * Pursue = top 3 non-avoided (in order), avoided = steer away, notes included.
 */
export function buildStrategyGuidance(state: CompetitorStrategyState | null): string {
  const { pursue, later, avoid } = splitRankedDirections(state);
  if (pursue.length === 0 && avoid.length === 0) return '';

  const lines: string[] = [
    '',
    '**STRATEGIC DIRECTION** (ranked by the user from a competitor analysis — align the vision, priorities and features with it):',
  ];
  if (pursue.length > 0) {
    lines.push('Pursue, in priority order:');
    pursue.forEach((d, i) => {
      const parts = [d.description, d.opportunity ? `Opportunity: ${d.opportunity}` : ''].filter(Boolean).join(' ');
      lines.push(`${i + 1}. ${d.title}${parts ? ` — ${parts}` : ''}${noteSuffix(d)}`);
    });
  }
  if (later.length > 0) {
    lines.push(`Lower priority: ${later.map((d) => `${d.title}${noteSuffix(d)}`).join('; ')}`);
  }
  if (avoid.length > 0) {
    lines.push('Steer away from (do not propose work that mainly serves these):');
    for (const d of avoid) lines.push(`- ${d.title}${noteSuffix(d)}`);
  }
  lines.push(
    'Prefer work that advances direction #1 first; when assigning MoSCoW priority, ' +
      'give "must"/"should" to features that advance the pursued directions and "wont" to ones that mainly serve avoided directions.',
  );
  return `${lines.join('\n')}\n`;
}

/** Load `.malvy/roadmap/strategy.json` and build the guidance section ('' when absent) */
export function loadStrategyGuidance(projectDir: string): string {
  try {
    return buildStrategyGuidance(loadCompetitorState(projectDir));
  } catch {
    return '';
  }
}
