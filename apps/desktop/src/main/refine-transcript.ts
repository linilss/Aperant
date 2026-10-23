/**
 * Refine Feature conversations, kept per feature in `.malvy/roadmap/refine/<featureId>.md`
 * (Malvy-owned) so the reasoning behind the refined fields survives, and the decisions go
 * along when the feature becomes a task.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export const REFINE_DIR = '.malvy/roadmap/refine';
const DECISIONS_MAX_CHARS = 6_000;

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

const safeId = (featureId: string) => featureId.replace(/[^\w-]/g, '_');

export function transcriptPath(projectPath: string, featureId: string): string {
  return path.join(projectPath, REFINE_DIR, `${safeId(featureId)}.md`);
}

/** The agent's question: the message without its options block, last paragraphs only */
function questionOf(assistant: string): string {
  const body = assistant.split(/\n\s*\*{0,2}Options:?\*{0,2}\s*\n/i)[0].trim();
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (paragraphs.at(-1) ?? body).replace(/\s+/g, ' ').slice(0, 400);
}

/** Question → answer pairs (the first user turn is Malvy's own kickoff, skipped) */
export function extractDecisions(history: TranscriptMessage[]): Array<{ question: string; answer: string }> {
  const decisions: Array<{ question: string; answer: string }> = [];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (prev.role !== 'assistant' || cur.role !== 'user') continue;
    if (/^please synthesize/i.test(cur.content)) continue;
    decisions.push({ question: questionOf(prev.content), answer: cur.content.replace(/\s+/g, ' ').slice(0, 500) });
  }
  return decisions;
}

export function renderTranscript(title: string, history: TranscriptMessage[]): string {
  const lines = [`# Refine: ${title}`, '', `_Saved ${new Date().toISOString()}_`, ''];
  for (const m of history) {
    // The marker line (not the heading) delimits turns, so headings inside a message are safe
    lines.push(m.role === 'assistant' ? '## Agent\n<!-- turn:assistant -->' : '## You\n<!-- turn:user -->', '', m.content.trim(), '');
  }
  return lines.join('\n');
}

export function saveTranscript(projectPath: string, featureId: string, title: string, history: TranscriptMessage[]): void {
  const file = transcriptPath(projectPath, featureId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, renderTranscript(title, history), 'utf-8');
}

/** Read a saved transcript back into messages ('' sections ignored) */
export function readTranscript(projectPath: string, featureId: string): TranscriptMessage[] {
  const file = transcriptPath(projectPath, featureId);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf-8');
  const messages: TranscriptMessage[] = [];
  const parts = text.split(/^<!-- turn:(assistant|user) -->$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const content = parts[i + 1]
      .replace(/\n## (Agent|You)\s*$/, '')
      .trim();
    if (content) messages.push({ role: parts[i] as TranscriptMessage['role'], content });
  }
  return messages;
}

/** Task-description section with the refine decisions, or '' */
export function buildDecisionsSection(projectPath: string, featureId: string): string {
  const decisions = extractDecisions(readTranscript(projectPath, featureId));
  if (decisions.length === 0) return '';
  let out = '\n## Decisions from refinement\n';
  for (const d of decisions) {
    const entry = `- **Q:** ${d.question}\n  **A:** ${d.answer}\n`;
    if (out.length + entry.length > DECISIONS_MAX_CHARS) break;
    out += entry;
  }
  return out;
}
