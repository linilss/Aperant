/**
 * Task Memory Context Builder
 *
 * Builds the body of the "PROJECT MEMORY" prompt section for a task's agent
 * sessions (spec, planner, coder, QA). Runs in the main process, where the
 * memory database lives; the result is passed to the worker as a plain string.
 *
 * Order: pinned → user-verified → most relevant to the task. Developer pointers
 * (user_taught) are skipped because they are already injected via .malvy/pointers.md.
 * Unverified (needsReview) memories need a higher confidence and are marked as such.
 */

import type { Memory, MemorySearchFilters } from '../types';
import { estimateTokens } from '../retrieval/context-packer';

export const TASK_MEMORY_LIMIT = 12;
export const TASK_MEMORY_TOKEN_BUDGET = 1500;
export const TASK_MEMORY_MIN_CONFIDENCE = 0.4;
export const UNVERIFIED_MEMORY_MIN_CONFIDENCE = 0.6;

const MAX_ITEM_CHARS = 600;
const MAX_FILES_SHOWN = 3;
/** How many project memories to scan for pinned/verified ones */
const PRIORITY_SCAN_LIMIT = 500;

export interface TaskMemorySources {
  /** Structured / semantic search (MemoryService.search) */
  search(filters: MemorySearchFilters): Promise<Memory[]>;
  /** Keyword-only (BM25/FTS) fallback used when semantic search fails or finds nothing */
  keywordSearch?(query: string, projectId: string, limit: number): Promise<Memory[]>;
}

export interface TaskMemoryContextOptions {
  projectId: string;
  /** Task title + description + spec summary */
  query: string;
  limit?: number;
  tokenBudget?: number;
  onLog?: (message: string) => void;
}

/**
 * Returns the formatted memory list, or '' when nothing relevant is found or
 * every lookup failed (never throws).
 */
export async function buildTaskMemoryContext(
  sources: TaskMemorySources,
  options: TaskMemoryContextOptions,
): Promise<string> {
  const { projectId, query, onLog } = options;
  const limit = options.limit ?? TASK_MEMORY_LIMIT;
  const tokenBudget = options.tokenBudget ?? TASK_MEMORY_TOKEN_BUDGET;
  const eligible = (m: Memory) => isEligible(m, projectId);

  let priority: Memory[] = [];
  try {
    const all = await sources.search({
      projectId,
      excludeDeprecated: true,
      minConfidence: TASK_MEMORY_MIN_CONFIDENCE,
      sort: 'confidence',
      limit: PRIORITY_SCAN_LIMIT,
    });
    priority = all.filter((m) => eligible(m) && (m.pinned || m.userVerified));
  } catch (error) {
    onLog?.(`Memory: pinned/verified lookup failed: ${errorMessage(error)}`);
  }

  let relevant: Memory[] = [];
  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    try {
      relevant = await sources.search({
        query: trimmedQuery,
        projectId,
        excludeDeprecated: true,
        minConfidence: TASK_MEMORY_MIN_CONFIDENCE,
        limit: limit * 2,
      });
    } catch (error) {
      onLog?.(`Memory: semantic search failed, using keyword search: ${errorMessage(error)}`);
    }
    relevant = relevant.filter(eligible);

    if (relevant.length === 0 && sources.keywordSearch) {
      try {
        relevant = (await sources.keywordSearch(trimmedQuery, projectId, limit * 2)).filter(eligible);
      } catch (error) {
        onLog?.(`Memory: keyword search failed: ${errorMessage(error)}`);
      }
    }
  }

  const ordered = orderMemories(priority, relevant);
  return formatTaskMemories(ordered, { limit, tokenBudget });
}

/** pinned → verified → the rest in relevance order, without duplicates */
export function orderMemories(priority: Memory[], relevant: Memory[]): Memory[] {
  const seen = new Set<string>();
  const result: Memory[] = [];
  const rank = (m: Memory) => (m.pinned ? 0 : m.userVerified ? 1 : 2);
  const combined = [...priority, ...relevant]
    .map((m, index) => ({ m, index }))
    .sort((a, b) => rank(a.m) - rank(b.m) || a.index - b.index);
  for (const { m } of combined) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    result.push(m);
  }
  return result;
}

/** Format memories as bullet lines, stopping at the item limit or token budget */
export function formatTaskMemories(
  memories: Memory[],
  options: { limit?: number; tokenBudget?: number } = {},
): string {
  const limit = options.limit ?? TASK_MEMORY_LIMIT;
  const tokenBudget = options.tokenBudget ?? TASK_MEMORY_TOKEN_BUDGET;
  const lines: string[] = [];
  let tokens = 0;

  for (const memory of memories) {
    if (lines.length >= limit) break;
    const line = formatMemoryLine(memory);
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens > tokenBudget) break;
    lines.push(line);
    tokens += lineTokens;
  }

  return lines.join('\n');
}

function formatMemoryLine(memory: Memory): string {
  const status = memory.pinned
    ? ' [pinned]'
    : memory.userVerified
      ? ' [verified]'
      : memory.needsReview
        ? ' [unverified]'
        : '';
  const content = memory.content.replace(/\s+/g, ' ').trim();
  const text = content.length > MAX_ITEM_CHARS ? `${content.slice(0, MAX_ITEM_CHARS)}…` : content;
  const files = memory.relatedFiles.slice(0, MAX_FILES_SHOWN);
  const fileRef = files.length > 0
    ? ` (files: ${files.join(', ')}${memory.relatedFiles.length > files.length ? ', …' : ''})`
    : '';
  return `- [${memory.type}]${status} ${text}${fileRef}`;
}

function isEligible(memory: Memory, projectId: string): boolean {
  if (memory.deprecated) return false;
  if (memory.projectId && memory.projectId !== projectId) return false;
  // Developer pointers are already in the prompt via .malvy/pointers.md
  if (memory.source === 'user_taught') return false;
  if (memory.confidence < TASK_MEMORY_MIN_CONFIDENCE) return false;
  const unverified = memory.needsReview && !memory.userVerified && !memory.pinned;
  if (unverified && memory.confidence < UNVERIFIED_MEMORY_MIN_CONFIDENCE) return false;
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
