/**
 * Task Learning — write path for agent memory.
 *
 * Turns insights distilled from a finished task (gotchas, patterns, per-file
 * insights) into project memories. Learned memories are inferred, so they are
 * stored with moderate confidence and `needsReview: true`; the user verifies,
 * pins or deprecates them in Context → Memories. Near-duplicates of existing
 * memories (including deprecated ones the user already rejected) are skipped.
 */

import type { Memory, MemoryRecordEntry, MemorySearchFilters, MemoryType } from './types';

export const LEARNED_MEMORY_CONFIDENCE = 0.6;
export const TASK_LEARNING_TAG = 'task_learning';
export const MAX_LEARNED_MEMORIES_PER_TASK = 6;

const MAX_RELATED_FILES = 10;
const MIN_CONTENT_CHARS = 15;
const DUPLICATE_SIMILARITY = 0.6;
const EXISTING_SCAN_LIMIT = 1000;

/** Subset of ExtractedInsights (runners/insight-extractor) used here */
export interface TaskInsights {
  gotchas_discovered: string[];
  patterns_discovered: string[];
  file_insights: Array<{ file: string; insight: string }>;
}

export interface TaskLearningInput {
  projectId: string;
  specId: string;
  /** Files changed by the task (relative to the repo root) */
  changedFiles: string[];
  insights: TaskInsights;
}

export interface TaskLearningStore {
  search(filters: MemorySearchFilters): Promise<Memory[]>;
  store(entry: MemoryRecordEntry): Promise<string>;
}

export function specTag(specId: string): string {
  return `spec:${specId}`;
}

/** Map extracted insights to memory entries (before dedupe) */
export function insightsToMemoryEntries(input: TaskLearningInput): MemoryRecordEntry[] {
  const relatedFiles = input.changedFiles.slice(0, MAX_RELATED_FILES);
  const base = {
    projectId: input.projectId,
    source: 'observer_inferred' as const,
    confidence: LEARNED_MEMORY_CONFIDENCE,
    needsReview: true,
    sessionId: input.specId,
    tags: [TASK_LEARNING_TAG, specTag(input.specId)],
  };

  const entries: MemoryRecordEntry[] = [];
  const add = (type: MemoryType, content: string, files: string[]) => {
    const text = content.trim();
    if (text.length < MIN_CONTENT_CHARS) return;
    entries.push({ ...base, type, content: text, relatedFiles: files, scope: files.length > 0 ? 'module' : 'global' });
  };

  for (const gotcha of input.insights.gotchas_discovered ?? []) add('gotcha', gotcha, relatedFiles);
  for (const pattern of input.insights.patterns_discovered ?? []) add('pattern', pattern, relatedFiles);
  for (const fi of input.insights.file_insights ?? []) {
    if (fi?.file && fi.insight) add('module_insight', `${fi.file}: ${fi.insight}`, [fi.file]);
  }
  return entries;
}

/**
 * Store learned memories, skipping near-duplicates of existing project memories
 * and of each other. Returns how many were stored and skipped.
 */
export async function storeTaskLearnings(
  store: TaskLearningStore,
  input: TaskLearningInput,
): Promise<{ stored: number; skipped: number }> {
  const candidates = insightsToMemoryEntries(input);
  if (candidates.length === 0) return { stored: 0, skipped: 0 };

  const existing = await store.search({
    projectId: input.projectId,
    excludeDeprecated: false,
    limit: EXISTING_SCAN_LIMIT,
  });
  const known = existing.filter((m) => m.projectId === input.projectId).map((m) => tokenize(m.content));

  let stored = 0;
  let skipped = 0;
  for (const entry of candidates) {
    if (stored >= MAX_LEARNED_MEMORIES_PER_TASK) {
      skipped++;
      continue;
    }
    const tokens = tokenize(entry.content);
    if (known.some((k) => similarity(tokens, k) >= DUPLICATE_SIMILARITY)) {
      skipped++;
      continue;
    }
    await store.store(entry);
    known.push(tokens);
    stored++;
  }
  return { stored, skipped };
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2),
  );
}

/** Overlap coefficient: shared tokens / size of the smaller set */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}
