/**
 * Project Index Summary
 * =====================
 *
 * Compact, prompt-friendly summary of project_index.json. Spec agents get this
 * instead of the full index (which grows with dependencies, routes, models and
 * env vars) and Read the file itself when they need the details.
 */

import type { ProjectIndex, ServiceInfo } from '../../../shared/types';

export const PROJECT_INDEX_SUMMARY_MAX_CHARS = 2500;

const MAX_KEY_DIRS_PER_SERVICE = 6;

function formatService(name: string, service: ServiceInfo, projectRoot: string): string {
  const stack = [service.language, service.framework].filter(Boolean).join(' / ');
  const details = [
    stack,
    service.type && service.type !== 'unknown' ? service.type : '',
    service.package_manager ? `pm: ${service.package_manager}` : '',
    service.entry_point ? `entry: ${service.entry_point}` : '',
    service.testing ? `tests: ${service.testing}` : '',
  ].filter(Boolean);

  const dirs = Object.values(service.key_directories ?? {})
    .slice(0, MAX_KEY_DIRS_PER_SERVICE)
    .map((dir) => (dir.purpose ? `${dir.path} (${dir.purpose})` : dir.path));
  if (dirs.length > 0) details.push(`dirs: ${dirs.join(', ')}`);

  const relPath = projectRoot && service.path?.startsWith(`${projectRoot}/`)
    ? service.path.slice(projectRoot.length + 1)
    : service.path;
  const path = relPath && relPath !== name ? ` (${relPath})` : '';
  return `- ${name}${path}${details.length > 0 ? `: ${details.join('; ')}` : ''}`;
}

/**
 * Summarize a project index as a few markdown lines, capped at `maxChars`.
 * Services that don't fit are counted, not listed. Returns null when the
 * input is not a parseable project index.
 */
export function summarizeProjectIndex(
  index: string | ProjectIndex,
  maxChars: number = PROJECT_INDEX_SUMMARY_MAX_CHARS,
): string | null {
  let parsed: ProjectIndex;
  try {
    parsed = typeof index === 'string' ? (JSON.parse(index) as ProjectIndex) : index;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const services = Object.entries(parsed.services ?? {});
  const header: string[] = [
    `Project type: ${parsed.project_type ?? 'unknown'} (${services.length} service${services.length === 1 ? '' : 's'})`,
  ];

  const infra = parsed.infrastructure ?? {};
  const infraParts = [
    infra.ci ? `CI: ${infra.ci}` : '',
    infra.docker_compose ? `docker compose: ${infra.docker_compose}` : '',
    infra.docker_services?.length ? `docker services: ${infra.docker_services.join(', ')}` : '',
    infra.deployment ? `deployment: ${infra.deployment}` : '',
  ].filter(Boolean);
  if (infraParts.length > 0) header.push(`Infrastructure: ${infraParts.join('; ')}`);

  const conv = parsed.conventions ?? {};
  const convParts = [
    conv.js_linting ? `lint: ${conv.js_linting}` : '',
    conv.python_linting ? `python lint: ${conv.python_linting}` : '',
    conv.formatting ? `format: ${conv.formatting}` : '',
    conv.python_formatting ? `python format: ${conv.python_formatting}` : '',
    conv.typescript ? 'TypeScript' : '',
    conv.git_hooks ? `git hooks: ${conv.git_hooks}` : '',
  ].filter(Boolean);
  if (convParts.length > 0) header.push(`Conventions: ${convParts.join('; ')}`);

  const lines = [...header];
  if (services.length > 0) lines.push('Services:');

  let length = lines.join('\n').length;
  let listed = 0;
  for (const [name, service] of services) {
    const line = formatService(name, service, parsed.project_root ?? '');
    // Reserve room for the "more services" note
    if (length + line.length + 1 > maxChars - 60) break;
    lines.push(line);
    length += line.length + 1;
    listed++;
  }
  if (listed < services.length) {
    lines.push(`- ... ${services.length - listed} more service(s) in the full index`);
  }

  return lines.join('\n');
}
