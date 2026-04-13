import { create } from 'zustand';

export interface ADOPRReviewFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'quality' | 'logic' | 'style' | 'performance';
  title: string;
  description: string;
  file: string;
  line: number;
  suggestedFix?: string;
  fixable: boolean;
}

export interface ADOPRReviewResult {
  pullRequestId: number;
  repositoryName: string;
  success: boolean;
  findings: ADOPRReviewFinding[];
  summary: string;
  overallStatus: 'approve' | 'request_changes' | 'comment';
  verdict: string;
  verdictReasoning: string;
  reviewedAt: string;
  reviewedCommitSha?: string;
  isFollowupReview?: boolean;
  hasPostedFindings?: boolean;
  postedFindingIds?: string[];
}

export interface ADOPRReviewProgress {
  phase: 'fetching' | 'analyzing' | 'generating' | 'complete';
  pullRequestId: number;
  progress: number;
  message: string;
}

export interface ADOPRNewCommitsCheck {
  hasNewCommits: boolean;
  commitCount: number;
  latestCommitSha?: string;
  latestCommitMessage?: string;
}

interface ADOPRReviewEntry {
  pullRequestId: number;
  isReviewing: boolean;
  progress: ADOPRReviewProgress | null;
  result: ADOPRReviewResult | null;
  error: string | null;
  newCommitsCheck: ADOPRNewCommitsCheck | null;
}

interface ADOPRReviewStoreState {
  // Key: `${projectId}:${pullRequestId}`
  reviews: Record<string, ADOPRReviewEntry>;

  startReview: (projectId: string, pullRequestId: number) => void;
  setProgress: (projectId: string, progress: ADOPRReviewProgress) => void;
  setResult: (projectId: string, result: ADOPRReviewResult) => void;
  setError: (projectId: string, pullRequestId: number, error: string) => void;
  setLoadedResult: (projectId: string, result: ADOPRReviewResult) => void;
  setNewCommitsCheck: (projectId: string, pullRequestId: number, check: ADOPRNewCommitsCheck) => void;
  resetReview: (projectId: string, pullRequestId: number) => void;
  getReview: (projectId: string, pullRequestId: number) => ADOPRReviewEntry | null;
}

function reviewKey(projectId: string, pullRequestId: number): string {
  return `${projectId}:${pullRequestId}`;
}

function defaultEntry(pullRequestId: number): ADOPRReviewEntry {
  return { pullRequestId, isReviewing: false, progress: null, result: null, error: null, newCommitsCheck: null };
}

export const useADOPRReviewStore = create<ADOPRReviewStoreState>((set, get) => ({
  reviews: {},

  startReview: (projectId, pullRequestId) =>
    set(state => ({
      reviews: {
        ...state.reviews,
        [reviewKey(projectId, pullRequestId)]: {
          ...defaultEntry(pullRequestId),
          isReviewing: true,
        },
      },
    })),

  setProgress: (projectId, progress) =>
    set(state => {
      const key = reviewKey(projectId, progress.pullRequestId);
      const existing = state.reviews[key] ?? defaultEntry(progress.pullRequestId);
      return { reviews: { ...state.reviews, [key]: { ...existing, progress } } };
    }),

  setResult: (projectId, result) =>
    set(state => {
      const key = reviewKey(projectId, result.pullRequestId);
      const existing = state.reviews[key] ?? defaultEntry(result.pullRequestId);
      return { reviews: { ...state.reviews, [key]: { ...existing, isReviewing: false, result, error: null } } };
    }),

  setError: (projectId, pullRequestId, error) =>
    set(state => {
      const key = reviewKey(projectId, pullRequestId);
      const existing = state.reviews[key] ?? defaultEntry(pullRequestId);
      return { reviews: { ...state.reviews, [key]: { ...existing, isReviewing: false, error } } };
    }),

  setLoadedResult: (projectId, result) =>
    set(state => {
      const key = reviewKey(projectId, result.pullRequestId);
      const existing = state.reviews[key] ?? defaultEntry(result.pullRequestId);
      // Don't overwrite an active in-progress review
      if (existing.isReviewing) return state;
      return { reviews: { ...state.reviews, [key]: { ...existing, result } } };
    }),

  setNewCommitsCheck: (projectId, pullRequestId, check) =>
    set(state => {
      const key = reviewKey(projectId, pullRequestId);
      const existing = state.reviews[key] ?? defaultEntry(pullRequestId);
      return { reviews: { ...state.reviews, [key]: { ...existing, newCommitsCheck: check } } };
    }),

  resetReview: (projectId, pullRequestId) =>
    set(state => {
      const key = reviewKey(projectId, pullRequestId);
      return { reviews: { ...state.reviews, [key]: defaultEntry(pullRequestId) } };
    }),

  getReview: (projectId, pullRequestId) =>
    get().reviews[reviewKey(projectId, pullRequestId)] ?? null,
}));
