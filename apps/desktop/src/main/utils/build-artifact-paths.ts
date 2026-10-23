/**
 * Paths that are build output, not work: kept out of Malvy's automatic "save uncommitted
 * work" commits. Matters for names .gitignore misses, like a folder literally named
 * `bin\Debug` (a Windows-style path created on macOS/Linux), which then broke a Docker build.
 */
const ARTIFACT_SEGMENT = /^(obj|node_modules)$/i;
const BIN_CONFIG = /(^|\/)bin\/(debug|release)(\/|$)/i;

export function isBuildArtifactPath(path: string): boolean {
  if (path.includes('\\')) return true;
  if (BIN_CONFIG.test(path)) return true;
  return path.split('/').some((segment) => ARTIFACT_SEGMENT.test(segment));
}
