/** A group of Planning tasks to build as one task (Consolidate & enqueue) */
export interface TaskGroup {
  title: string;
  summary: string;
  /** Spec ids in build order */
  specIds: string[];
  reason: string;
}

/** Description for a consolidated task: the parts' specs in build order */
export function buildConsolidatedDescription(group: TaskGroup, specs: Map<string, { title: string; spec: string }>): string {
  const parts = group.specIds.map((id, i) => {
    const s = specs.get(id);
    const body = (s?.spec ?? '').replace(/^# .*\n/, '').trim();
    return `### Part ${i + 1}: ${s?.title ?? id}\n(from task ${id})\n\n${body}`;
  });
  return [
    `# ${group.title}`,
    group.summary,
    `## Parts (build in this order)\nThis task merges ${group.specIds.length} planned tasks. Every part's acceptance criteria still apply.`,
    ...parts,
  ]
    .filter(Boolean)
    .join('\n\n');
}
