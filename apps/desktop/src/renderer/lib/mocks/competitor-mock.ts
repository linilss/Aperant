/**
 * Mock implementation for the Competitors page (browser UI development)
 */

const noop = () => () => undefined;

export const competitorMock = {
  getCompetitors: async () => ({
    success: true,
    data: { state: null, isRunning: false, phase: null }
  }),
  analyzeCompetitors: () => undefined,
  stopCompetitors: () => undefined,
  refreshCompetitor: () => undefined,
  resynthesizeDirections: () => undefined,
  saveDirectionRanking: async () => ({ success: false, error: 'Not available in browser mock' }),
  moveCompetitorToPool: async () => ({ success: false, error: 'Not available in browser mock' }),
  addManualCompetitor: async () => ({ success: false, error: 'Not available in browser mock' }),
  onCompetitorsProgress: noop,
  onCompetitorsComplete: noop,
  onCompetitorsError: noop
};
