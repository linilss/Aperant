/**
 * Pull what a failed QA report says is wrong (qa_report.md written by the QA
 * reviewer): unmet acceptance criteria, blocking findings and recommended fixes.
 */

export interface QaReportSummary {
  /** e.g. "FAILED", "REJECTED", "APPROVED" when the report states it */
  status?: string;
  unmet: string[];
  blocking: string[];
  recommended: string[];
}

function section(md: string, heading: RegExp): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s/.test(l) && heading.test(l));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** List items ("- x", "1. x"), each with its indented continuation lines */
function items(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s{0,3}(?:[-*]|\d+[.)])\s+(.*)$/);
    if (m) out.push(m[1].trim());
    else if (out.length > 0 && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line.trim()}`;
  }
  return out.filter(Boolean);
}

export function parseQaReport(md: string): QaReportSummary {
  const status = md.match(/^\s*\**Status\**:?\**\s*([A-Z_]+)/im)?.[1];
  const criteria = items(section(md, /Acceptance Criteria/i));
  return {
    status,
    unmet: criteria.filter((c) => c.startsWith('❌')).map((c) => c.replace(/^❌\s*/, '')),
    blocking: items(section(md, /Blocking|Critical|Issues Found|Must fix/i)),
    recommended: items(section(md, /Recommended/i)),
  };
}

/** Feedback for the fixer agent ("Fix with agent"), built from the report */
export function buildFixFeedback(summary: QaReportSummary): string {
  const parts: string[] = ['Fix what QA found, then make sure the verify command passes.'];
  if (summary.blocking.length) parts.push('Blocking:', ...summary.blocking.map((b, i) => `${i + 1}. ${b}`));
  if (summary.unmet.length) parts.push('Unmet acceptance criteria:', ...summary.unmet.map((u) => `- ${u}`));
  if (summary.recommended.length) parts.push('Also fix if cheap and safe:', ...summary.recommended.map((r) => `- ${r}`));
  parts.push('If a criterion needs runtime evidence (simulator, screenshots), produce it with the project scripts where possible; otherwise say exactly what is left for the user to check.');
  return parts.join('\n');
}
