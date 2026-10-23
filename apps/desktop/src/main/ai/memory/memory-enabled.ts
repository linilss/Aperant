/**
 * Built-in memory on/off resolution.
 *
 * The app-wide `memoryEnabled` setting (onboarding Memory step) is the default.
 * A project can override it from Project Settings → Memory, which is stored in the
 * project's `.malvy/.env` under the legacy key `GRAPHITI_ENABLED` (name kept so
 * existing project files keep working).
 */

export const PROJECT_MEMORY_ENV_KEY = 'GRAPHITI_ENABLED';

export function resolveMemoryEnabled(
  appMemoryEnabled: boolean | undefined,
  projectEnvValue: string | undefined,
): boolean {
  const projectValue = projectEnvValue?.trim().toLowerCase();
  if (projectValue === 'true') return true;
  if (projectValue === 'false') return false;
  return appMemoryEnabled === true;
}
