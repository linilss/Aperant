import { escapeShellPath } from '../../../shared/utils/shell-escape';
import type { DeployScript } from '../../../shared/types';

/** Shell command that runs a deploy script from the project root. */
export function buildDeployCommand(script: DeployScript, args: string): string {
  const trimmed = args.trim();
  return `bash ${escapeShellPath(`./${script.relativePath}`)}${trimmed ? ` ${trimmed}` : ''}`;
}
