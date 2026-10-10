/**
 * Ideation Runner
 * ===============
 *
 * AI-powered idea generation via the Claude CLI subprocess.
 *
 * Uses `claude --print --verbose --output-format stream-json` so that generation
 * goes through the same code path as Agent Terminals, avoiding direct API calls
 * and the associated OAuth subscription rate limit issues.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveModelId } from '../config/phase-config';
import type { ModelShorthand, ThinkingLevel } from '../config/types';
import { getAugmentedEnvAsync, findExecutableAsync } from '../../env-utils';
import { getClaudeProfileManager } from '../../claude-profile-manager';
import { loadCoreValuesSection } from '../../core-values';
import { loadIdeaDirectionTaggingSection, loadStrategyGuidance } from './competitors/guidance';
import {
  buildKanbanContextSection,
  buildRoadmapContextSection,
  loadRoadmapFeaturesForContext,
  type IdeationContextTask,
} from './ideation-context';

// =============================================================================
// Constants
// =============================================================================

/** Supported ideation types */
export const IDEATION_TYPES = [
  'code_improvements',
  'ui_ux_improvements',
  'documentation_gaps',
  'security_hardening',
  'performance_optimizations',
  'code_quality',
] as const;

export type IdeationType = (typeof IDEATION_TYPES)[number];

/** Human-readable labels for ideation types */
export const IDEATION_TYPE_LABELS: Record<IdeationType, string> = {
  code_improvements: 'Code Improvements',
  ui_ux_improvements: 'UI/UX Improvements',
  documentation_gaps: 'Documentation Gaps',
  security_hardening: 'Security Hardening',
  performance_optimizations: 'Performance Optimizations',
  code_quality: 'Code Quality & Refactoring',
};

/** Prompt file mapping per ideation type */
const IDEATION_TYPE_PROMPTS: Record<IdeationType, string> = {
  code_improvements: 'ideation_code_improvements.md',
  ui_ux_improvements: 'ideation_ui_ux.md',
  documentation_gaps: 'ideation_documentation.md',
  security_hardening: 'ideation_security.md',
  performance_optimizations: 'ideation_performance.md',
  code_quality: 'ideation_code_quality.md',
};

// =============================================================================
// Types
// =============================================================================

/** Configuration for running ideation */
export interface IdeationConfig {
  /** Project directory path */
  projectDir: string;
  /** Output directory for results */
  outputDir: string;
  /** Prompts directory containing ideation prompt files */
  promptsDir: string;
  /** Type of ideation to run */
  ideationType: IdeationType;
  /** Model shorthand (defaults to 'sonnet') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (unused — kept for API compatibility) */
  thinkingLevel?: ThinkingLevel;
  /** Maximum ideas per type (defaults to 5) */
  maxIdeasPerType?: number;
  /** List existing roadmap features (read from roadmap.json) to avoid duplicates */
  includeRoadmapContext?: boolean;
  /** List existing kanban tasks (`existingTasks`) to avoid duplicates */
  includeKanbanContext?: boolean;
  /** Existing tasks for the kanban context (supplied by the caller) */
  existingTasks?: IdeationContextTask[];
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/** Result of an ideation run */
export interface IdeationResult {
  /** Whether the run succeeded */
  success: boolean;
  /** Full response text from the agent */
  text: string;
  /** Error message if failed */
  error?: string;
}

/** Callback for streaming events from the ideation runner */
export type IdeationStreamCallback = (event: IdeationStreamEvent) => void;

/** Events emitted during ideation streaming */
export type IdeationStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; name: string }
  | { type: 'error'; error: string };

// =============================================================================
// Ideation Runner
// =============================================================================

/**
 * Run an ideation agent for a specific ideation type.
 *
 * Spawns `claude --print --verbose --output-format stream-json` with the
 * ideation prompt on stdin. The CLI writes output JSON files directly via
 * its Write tool. Streaming events are forwarded to the callback.
 */
export async function runIdeation(
  config: IdeationConfig,
  onStream?: IdeationStreamCallback,
): Promise<IdeationResult> {
  const {
    projectDir,
    outputDir,
    promptsDir,
    ideationType,
    modelShorthand = 'sonnet',
    maxIdeasPerType = 5,
    abortSignal,
  } = config;

  // Load prompt file
  const promptFile = IDEATION_TYPE_PROMPTS[ideationType];
  const promptPath = join(promptsDir, promptFile);

  if (!existsSync(promptPath)) {
    return { success: false, text: '', error: `Prompt not found: ${promptPath}` };
  }

  let prompt: string;
  try {
    prompt = readFileSync(promptPath, 'utf-8');
  } catch (error) {
    return {
      success: false,
      text: '',
      error: `Failed to read prompt: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Core values open the prompt as its highest-priority section
  const values = loadCoreValuesSection(projectDir);
  if (values) {
    prompt = `${values}Skip ideas that conflict with these core values, however valuable they look otherwise.\n\n---\n\n${prompt}`;
  }

  // Add context (matches original format)
  prompt += `\n\n---\n\n**Output Directory**: ${outputDir}\n`;
  prompt += `**Project Directory**: ${projectDir}\n`;
  prompt += `**Max Ideas**: ${maxIdeasPerType}\n`;
  // Funnel handoff: the user's ranked directions from the Competitors page
  const strategy = loadStrategyGuidance(projectDir, { valuesAlreadyShown: true });
  if (strategy) {
    prompt += `${strategy}Favor ideas that serve the pursued directions; skip ideas that mainly serve avoided ones.\n`;
  }
  prompt += loadIdeaDirectionTaggingSection(projectDir);
  // Existing work, so ideas don't duplicate what is already planned
  if (config.includeRoadmapContext) {
    prompt += buildRoadmapContextSection(loadRoadmapFeaturesForContext(projectDir));
  }
  if (config.includeKanbanContext && config.existingTasks) {
    prompt += buildKanbanContextSection(config.existingTasks);
  }

  const userPrompt = `Analyze the project at ${projectDir} and generate up to ${maxIdeasPerType} ${ideationType.replace(/_/g, ' ')} ideas. Use the available tools to explore the codebase, then write your findings as a JSON file to the output directory.`;
  const combinedPrompt = `${prompt}\n\n${userPrompt}`;

  const [augmentedEnv, claudePath] = await Promise.all([
    getAugmentedEnvAsync(),
    findExecutableAsync('claude'),
  ]);
  if (!claudePath) {
    return { success: false, text: '', error: 'claude CLI not found — make sure Claude Code is installed' };
  }

  const modelId = resolveModelId(modelShorthand);
  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--allowedTools', 'Read,Glob,Grep,Write',
    '--model', modelId,
  ];

  const profileEnv = getClaudeProfileManager().getActiveProfileEnv();
  const spawnEnv = { ...augmentedEnv, ...profileEnv };
  console.error(`[Ideation CLI] spawning: ${claudePath} ${args.join(' ')} (type: ${ideationType})`);

  const child = spawn(claudePath, args, {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnEnv,
  });

  child.stdin.write(combinedPrompt, 'utf-8');
  child.stdin.end();

  let responseText = '';
  let stdoutBuffer = '';
  let stderrOutput = '';
  // Fatal CLI errors (e.g. an expired login) arrive as an is_error result on
  // stdout; stderr may only hold unrelated warnings
  let resultError = '';

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8');
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;

        if (event.type === 'assistant') {
          const message = event.message as Record<string, unknown> | undefined;
          const content = (message?.content ?? []) as Array<Record<string, unknown>>;
          for (const block of content) {
            if (block.type === 'text') {
              const text = String(block.text ?? '');
              responseText += text;
              if (text) onStream?.({ type: 'text-delta', text });
            } else if (block.type === 'tool_use') {
              onStream?.({ type: 'tool-use', name: String(block.name ?? 'unknown') });
            }
          }
        } else if (event.type === 'result') {
          if (responseText.length === 0 && event.result) {
            responseText = String(event.result);
          }
          if (event.is_error === true && event.result) {
            resultError = String(event.result);
          }
          if (event.subtype === 'error_during_execution') {
            const errMsg = String(event.error ?? event.result ?? 'CLI error');
            onStream?.({ type: 'error', error: errMsg });
          }
        }
      } catch (parseErr) {
        if (!(parseErr instanceof SyntaxError)) throw parseErr;
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString('utf-8');
  });

  const abortHandler = () => child.kill('SIGTERM');
  abortSignal?.addEventListener('abort', abortHandler);

  try {
    await new Promise<void>((resolve, reject) => {
      child.on('close', (code) => {
        abortSignal?.removeEventListener('abort', abortHandler);
        if (abortSignal?.aborted) { reject(new Error('Aborted')); return; }
        if (code !== 0) {
          reject(new Error(`claude CLI failed: ${resultError || stderrOutput.trim() || `exit code ${code}`}`));
          return;
        }
        resolve();
      });
      child.on('error', (err) => {
        abortSignal?.removeEventListener('abort', abortHandler);
        reject(err);
      });
    });

    console.error(`[Ideation CLI] complete, textChars: ${responseText.length}`);
    return { success: true, text: responseText };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    onStream?.({ type: 'error', error: errorMsg });
    return { success: false, text: responseText, error: errorMsg };
  }
}
