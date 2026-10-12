/**
 * Release Guard
 * =============
 *
 * Task agents never release. Deploying, publishing, uploading builds and pushing
 * to a remote are done by the user from Malvy's Deploy button after merging.
 *
 * This module is the single source for that rule:
 * - `RELEASE_DISALLOWED_TOOLS` — `--disallowedTools` patterns for the `claude` CLI
 *   (build/QA sessions in worker.ts, and claude-cli.ts when Bash is mapped)
 * - `findReleaseCommand()` — the matcher used by the SDK-path bash validator
 * - `isReleaseStepText()` — classifier for implementation-plan subtasks
 *
 * Design-system artifacts on claude.ai count as releases too: task agents update the
 * source files in the repo and the user publishes from Context → Design.
 */

/** Command prefixes (tokens) that release something. Matched after `git`/`npx` option skipping. */
export const RELEASE_COMMAND_PREFIXES: readonly (readonly string[])[] = [
  ['git', 'push'],
  ['az', 'webapp'],
  ['az', 'acr'],
  ['az', 'containerapp', 'up'],
  ['az', 'staticwebapp'],
  ['kubectl', 'apply'],
  ['helm', 'upgrade'],
  ['helm', 'install'],
  ['terraform', 'apply'],
  ['fly', 'deploy'],
  ['flyctl', 'deploy'],
  ['vercel'],
  ['netlify', 'deploy'],
  ['firebase', 'deploy'],
  ['npm', 'publish'],
  ['pnpm', 'publish'],
  ['yarn', 'publish'],
  ['yarn', 'npm', 'publish'],
  ['dotnet', 'nuget', 'push'],
  ['nuget', 'push'],
  ['cargo', 'publish'],
  ['twine', 'upload'],
  ['docker', 'push'],
  ['xcrun', 'altool'],
  ['fastlane'],
  ['gh', 'release'],
];

/** Script-name words: `deploy*.sh`, `apple/deploy-ios.sh`, `npm run release`, `make publish` … */
export const RELEASE_SCRIPT_WORDS: readonly string[] = ['deploy', 'release', 'publish'];

const PACKAGE_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const SHELL_RUNNERS = new Set(['bash', 'sh', 'zsh', 'source', '.', 'pwsh']);
const COMMAND_WRAPPERS = new Set(['env', 'sudo', 'time', 'nohup', 'exec', 'command', 'npx', 'bunx']);
/** git global options that take a value (`git -C dir push`) */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/**
 * Claude Code tools that publish to claude.ai (design-system artifacts, claude.ai/design
 * projects). The CLI can't restrict a tool by action, so the whole tool is denied; the
 * Context → Design runners (sync/publish) are separate spawns that don't get this guard.
 */
export const ARTIFACT_PUBLISH_TOOLS: readonly string[] = ['Artifact', 'DesignSync'];

/**
 * `--disallowedTools` patterns for the claude CLI. Deny rules win over `--allowedTools`
 * and the CLI checks each part of a compound command (`cd x && git push`) separately.
 */
export const RELEASE_DISALLOWED_TOOLS: readonly string[] = [
  ...RELEASE_COMMAND_PREFIXES.map((prefix) => `Bash(${prefix.join(' ')}:*)`),
  'Bash(git -C * push*)',
  ...RELEASE_SCRIPT_WORDS.flatMap((word) => [
    `Bash(./${word}*)`,
    `Bash(${word}*.sh*)`,
    `Bash(*/${word}*.sh*)`,
    `Bash(bash *${word}*)`,
    `Bash(sh *${word}*)`,
    `Bash(npm run ${word}*)`,
    `Bash(pnpm run ${word}*)`,
    `Bash(yarn ${word}*)`,
    `Bash(make ${word}*)`,
  ]),
  ...ARTIFACT_PUBLISH_TOOLS,
];

/** CLI args that block release commands; append to any `claude` spawn that allows Bash. */
export function releaseGuardCliArgs(): string[] {
  return ['--disallowedTools', RELEASE_DISALLOWED_TOOLS.join(',')];
}

/** Tool args for build/QA/spec sessions run through the claude CLI (worker.ts). */
export function taskAgentCliToolArgs(): string[] {
  return ['--allowedTools', 'Read,Write,Edit,Bash,Glob,Grep,WebFetch', ...releaseGuardCliArgs()];
}

const SCRIPT_WORD_RE = new RegExp(`(${RELEASE_SCRIPT_WORDS.join('|')})`, 'i');
const SCRIPT_EXT_RE = /\.(sh|bash|zsh|ps1)$/i;

function basename(token: string): string {
  const parts = token.split(/[\\/]/);
  return parts[parts.length - 1] ?? token;
}

/** `deploy.sh`, `./deploy-ios.sh`, `scripts/release`, `apple/deploy-ios.sh` */
function isReleaseScriptToken(token: string): boolean {
  const name = basename(token);
  if (!SCRIPT_WORD_RE.test(name)) return false;
  if (SCRIPT_EXT_RE.test(name)) return true;
  // Extension-less executables invoked by path (./deploy, bin/release)
  const startsWithWord = RELEASE_SCRIPT_WORDS.some((w) => name.toLowerCase().startsWith(w));
  return startsWithWord && /[\\/]/.test(token);
}

function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n`]|\$\(|[()]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tokenize(segment: string): string[] {
  const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((t) => t.replace(/^["']|["']$/g, ''));
}

/** Drop leading `VAR=value` assignments and wrappers like `env`, `sudo`, `npx`. */
function stripPrefixes(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) { i++; continue; }
    if (COMMAND_WRAPPERS.has(tok)) {
      i++;
      // skip wrapper flags (env -i, npx --yes)
      while (i < tokens.length && tokens[i].startsWith('-')) i++;
      continue;
    }
    break;
  }
  return tokens.slice(i);
}

/** `git -C dir -c x=y push` → `git push` */
function normalizeGit(tokens: string[]): string[] {
  if (basename(tokens[0] ?? '') !== 'git') return tokens;
  const out = ['git'];
  let i = 1;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    i += GIT_OPTIONS_WITH_VALUE.has(tokens[i]) ? 2 : 1;
  }
  return out.concat(tokens.slice(i));
}

function matchSegment(rawTokens: string[]): boolean {
  let tokens = stripPrefixes(rawTokens);
  if (tokens.length === 0) return false;
  tokens = normalizeGit(tokens);
  const cmd = basename(tokens[0]).toLowerCase();

  if (isReleaseScriptToken(tokens[0])) return true;

  if (SHELL_RUNNERS.has(cmd)) {
    const script = tokens.slice(1).find((t) => !t.startsWith('-'));
    return !!script && isReleaseScriptToken(script);
  }

  if (PACKAGE_RUNNERS.has(cmd)) {
    const rest = tokens.slice(1).filter((t) => !t.startsWith('-'));
    const script = rest[0] === 'run' || rest[0] === 'run-script' ? rest[1] : rest[0];
    if (script && RELEASE_SCRIPT_WORDS.some((w) => script.toLowerCase().startsWith(w))) return true;
  }

  if (cmd === 'make') {
    const targets = tokens.slice(1).filter((t) => !t.startsWith('-') && !t.includes('='));
    if (targets.some((t) => RELEASE_SCRIPT_WORDS.some((w) => t.toLowerCase().startsWith(w)))) return true;
  }

  const lowered = [cmd, ...tokens.slice(1).map((t) => t.toLowerCase())];
  return RELEASE_COMMAND_PREFIXES.some((prefix) => prefix.every((p, i) => lowered[i] === p));
}

/**
 * Returns the offending segment when `command` would release/deploy/publish/push,
 * otherwise null. Used by the SDK-path bash validator.
 */
export function findReleaseCommand(command: string): string | null {
  for (const segment of splitSegments(command)) {
    if (matchSegment(tokenize(segment))) return segment;
  }
  return null;
}

export const RELEASE_BLOCK_REASON =
  'Releasing is not allowed for task agents (deploy, publish, build uploads, git push). ' +
  "The user releases from Malvy's Deploy button after merging. Skip this step and continue.";

// =============================================================================
// Plan subtask classifier
// =============================================================================

/** Leading verbs that mean the subtask writes/changes code (e.g. "Update deploy.sh to …"). */
const AUTHORING_VERB_RE =
  /^(create|add|write|update|modify|fix|implement|refactor|document|edit|extend|rename|remove|delete|move|test|review|change|improve|adjust|configure|set up|setup|harden|clean)\b/i;

const RELEASE_TEXT_PATTERNS: readonly RegExp[] = [
  /\btestflight\b/i,
  /\bapp store connect\b/i,
  /\b(upload|submit)\w*\b[^.]*\b(app store|play store|google play)\b/i,
  /\bpush(ed|es|ing)?\s+(it\s+|the\s+\w+\s+|changes\s+)?(to\s+)?(origin|main|master|remote|production|prod)\b/i,
  /\bdeploy(s|ed|ing)?\s+(it\s+|the\s+\w+\s+)?(to\s+)?(prod|production|staging|azure|aws|gcp|fly|vercel|netlify|heroku|the server|live)\b/i,
  /\brelease\s+(to\s+)?(prod|production|users)\b/i,
  /\b(re)?publish\w*\b[^.]*\b(design[- ]system|artifact)\b/i,
];

/**
 * True when a plan subtask is clearly a release step (deploy/TestFlight/push to main/publish)
 * rather than code work. Conservative: an authoring verb up front ("Update deploy.sh …")
 * is always code work.
 */
export function isReleaseStepText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || AUTHORING_VERB_RE.test(trimmed)) return false;

  if (RELEASE_TEXT_PATTERNS.some((re) => re.test(trimmed))) return true;

  // Commands mentioned in the text: `./deploy.sh`, `apple/deploy-ios.sh`, `git push`, `npm publish`
  if (trimmed.split(/\s+/).some((tok) => isReleaseScriptToken(tok.replace(/[,;:.)(`'"]+$|^[`'"(]+/g, '')))) {
    return true;
  }
  // Multi-word release commands anywhere in the text ("Run npm publish", "then git push")
  const lowered = trimmed.toLowerCase();
  if (RELEASE_COMMAND_PREFIXES.some((p) => p.length > 1 && new RegExp(`\\b${p.join('\\s+')}\\b`).test(lowered))) {
    return true;
  }
  return findReleaseCommand(trimmed.replace(/`/g, ' ')) !== null;
}
