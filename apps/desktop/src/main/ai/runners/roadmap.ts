/**
 * Roadmap Runner
 * ==============
 *
 * AI-powered roadmap generation via the Claude CLI subprocess.
 *
 * Uses `claude --print --output-format stream-json` so that generation goes through
 * the same code path as Agent Terminals (the CLI manages its own rate-limit backoff)
 * rather than calling api.anthropic.com directly via the Vercel AI SDK.
 *
 * Multi-step process: project discovery → (optional) competitor analysis → feature generation.
 * The project's core values (.malvy/core-values.md) open both prompts as the
 * highest-priority section; the user's ranked strategic directions from the
 * Competitors page (strategy.json) are added as guidance below them.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { resolveModelId } from '../config/phase-config';
import type { ModelShorthand, ThinkingLevel } from '../config/types';
import { safeParseJson } from '../../utils/json-repair';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { getAugmentedEnvAsync, findExecutableAsync } from '../../env-utils';
import { getProjectProfileEnv } from '../../claude-profile/project-profile';
import { loadCoreValuesSection } from '../../core-values';
import { buildCompetitorSection, loadFunnelContextSection } from './roadmap-funnel-context';
import { buildRemovedFeaturesSection, readRemovedFeatures, type RemovedFeature } from '../../roadmap-removed';
import {
  createMemoryStore,
  emptyCompetitorState,
  isCompetitorAnalysisFresh,
  loadCompetitorState,
  loadDirectionTaggingSection,
  loadKnownDirectionIds,
  loadStrategyGuidance,
  sanitizeFeatureDirectionIds,
  runFullAnalysis,
  saveCompetitorState,
} from './competitors';

// =============================================================================
// Constants
// =============================================================================

const MAX_RETRIES = 3;

// =============================================================================
// Types
// =============================================================================

/** Configuration for roadmap generation */
export interface RoadmapConfig {
  /** Project directory path */
  projectDir: string;
  /** Output directory for roadmap files (defaults to .malvy/roadmap/) */
  outputDir?: string;
  /** Model shorthand (defaults to 'sonnet') */
  modelShorthand?: ModelShorthand;
  /** Thinking level (unused — kept for API compatibility) */
  thinkingLevel?: ThinkingLevel;
  /** Whether to refresh existing data */
  refresh?: boolean;
  /** Whether to enable competitor analysis */
  enableCompetitorAnalysis?: boolean;
  /** Re-run competitor analysis even if competitor_analysis.json exists */
  refreshCompetitorAnalysis?: boolean;
  /** Free-text direction from the user, e.g. what to steer away from on a regenerate */
  guidance?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/** Result of a roadmap phase */
export interface RoadmapPhaseResult {
  /** Phase name */
  phase: string;
  /** Whether the phase succeeded */
  success: boolean;
  /** Output files created */
  outputs: string[];
  /** Errors encountered */
  errors: string[];
}

/** Result of the full roadmap generation */
export interface RoadmapResult {
  /** Whether generation succeeded */
  success: boolean;
  /** Phase results */
  phases: RoadmapPhaseResult[];
  /** Path to the generated roadmap file */
  roadmapPath?: string;
  /** Error message if failed */
  error?: string;
}

/** Callback for streaming events from the roadmap runner */
export type RoadmapStreamCallback = (event: RoadmapStreamEvent) => void;

/** Events emitted during roadmap generation */
export type RoadmapStreamEvent =
  | { type: 'phase-start'; phase: string }
  | { type: 'phase-complete'; phase: string; success: boolean }
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; name: string }
  | { type: 'error'; error: string };

// =============================================================================
// CLI Runner Helper
// =============================================================================

/**
 * Spawn `claude --print --output-format stream-json` and collect the full text output.
 *
 * The prompt is written to the subprocess stdin. Stdout produces newline-delimited
 * JSON events which are mapped to RoadmapStreamEvent callbacks in real time.
 *
 * The CLI handles rate-limit backoff internally, so callers never see 429 errors.
 */
async function runPhaseViaCLI(
  prompt: string,
  projectDir: string,
  modelId: string,
  abortSignal?: AbortSignal,
  onStream?: RoadmapStreamCallback,
  allowedTools: string = 'Read,Glob,Grep',
): Promise<string> {
  const [augmentedEnv, claudePath] = await Promise.all([
    getAugmentedEnvAsync(),
    findExecutableAsync('claude'),
  ]);
  // The project's Claude account (pinned profile, else the active one)
  const profileEnv = getProjectProfileEnv({ projectPath: projectDir });
  const spawnEnv = { ...augmentedEnv, ...profileEnv };

  if (!claudePath) {
    throw new Error('claude CLI not found — make sure Claude Code is installed');
  }

  const args = [
    '--print',
    '--verbose',
    '--output-format', 'stream-json',
    '--allowedTools', allowedTools,
    '--model', modelId,
  ];

  console.error(`[Roadmap CLI] spawning: ${claudePath} ${args.join(' ')}`);

  const child = spawn(claudePath, args, {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: spawnEnv,
  });

  // Write the prompt to stdin, then close it so the CLI knows input is done
  child.stdin.write(prompt, 'utf-8');
  child.stdin.end();

  let fullText = '';
  let stdoutBuffer = '';
  let stderrOutput = '';
  // The CLI reports fatal errors (e.g. an expired login) as an is_error result
  // event on stdout. stderr often holds only unrelated warnings, so this is the
  // message to surface when the process exits non-zero.
  let resultError = '';

  // Parse stream-json events from stdout line by line
  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8');
    const lines = stdoutBuffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;

        if (event.type === 'assistant') {
          // Extract text and tool_use blocks from the message content array
          const message = event.message as Record<string, unknown> | undefined;
          const content = (message?.content ?? []) as Array<Record<string, unknown>>;
          for (const block of content) {
            if (block.type === 'text') {
              const text = String(block.text ?? '');
              fullText += text;
              if (text) onStream?.({ type: 'text-delta', text });
            } else if (block.type === 'tool_use') {
              const name = String(block.name ?? 'unknown');
              onStream?.({ type: 'tool-use', name });
            }
          }
        } else if (event.type === 'result') {
          // Use the result text as a fallback if we collected nothing from streaming
          if (fullText.length === 0 && event.result) {
            fullText = String(event.result);
          }
          if (event.is_error === true && event.result) {
            resultError = String(event.result);
          }
          if (event.subtype === 'error_during_execution') {
            const errMsg = String(event.error ?? event.result ?? 'CLI error');
            onStream?.({ type: 'error', error: errMsg });
            throw new Error(errMsg);
          }
        }
        // Other event types (system, tool_result, etc.) are silently ignored
      } catch (parseErr) {
        // Not JSON — could be ANSI progress output; ignore
        if (!(parseErr instanceof SyntaxError)) throw parseErr;
      }
    }
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrOutput += chunk.toString('utf-8');
  });

  // Wire up abort signal
  const abortHandler = () => {
    child.kill('SIGTERM');
  };
  abortSignal?.addEventListener('abort', abortHandler);

  await new Promise<void>((resolve, reject) => {
    child.on('close', (code) => {
      abortSignal?.removeEventListener('abort', abortHandler);

      if (abortSignal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      if (code !== 0) {
        const errDetail = resultError || stderrOutput.trim() || `exit code ${code}`;
        console.error(`[Roadmap CLI] process exited with code ${code}: ${errDetail}`);
        reject(new Error(`claude CLI failed: ${errDetail}`));
        return;
      }

      resolve();
    });

    child.on('error', (err) => {
      abortSignal?.removeEventListener('abort', abortHandler);
      reject(err);
    });
  });

  console.error(`[Roadmap CLI] phase complete, textChars: ${fullText.length}`);
  return fullText;
}

// =============================================================================
// Discovery Phase
// =============================================================================

/**
 * Run the discovery phase — analyze project and determine audience/vision.
 */
async function runDiscoveryPhase(
  projectDir: string,
  outputDir: string,
  refresh: boolean,
  modelId: string,
  abortSignal?: AbortSignal,
  onStream?: RoadmapStreamCallback,
  guidance?: string,
): Promise<RoadmapPhaseResult> {
  const discoveryFile = join(outputDir, 'roadmap_discovery.json');
  const projectIndexFile = join(projectDir, '.malvy', 'project_index.json');

  if (existsSync(discoveryFile) && !refresh) {
    return { phase: 'discovery', success: true, outputs: [discoveryFile], errors: [] };
  }

  const errors: string[] = [];

  const loadedDiscoveryPrompt = tryLoadPrompt('roadmap_discovery');
  console.error(`[Roadmap Discovery] prompt loaded: ${loadedDiscoveryPrompt !== null}, model: ${modelId}, projectDir: ${projectDir}, indexExists: ${existsSync(projectIndexFile)}`);

  const contextBlock =
    `\n\n**Project Directory**: ${projectDir}\n` +
    `**Project Index File**: ${projectIndexFile}\n` +
    buildGuidanceSection(guidance) +
    loadStrategyGuidance(projectDir, { valuesAlreadyShown: true }) +
    `\nRead the project index file first, then explore the codebase. ` +
    `Output your findings wrapped in <roadmap_discovery> tags as instructed above.`;

  const systemPrompt = loadedDiscoveryPrompt
    ? loadedDiscoveryPrompt + contextBlock
    : `Analyze the project at "${projectDir}". Read "${projectIndexFile}" and key source files, then output a discovery JSON wrapped in <roadmap_discovery> tags with fields: project_name, project_type, tech_stack, target_audience, product_vision, current_state, competitive_context, constraints, created_at.`;

  const userPrompt =
    `Analyze the project at "${projectDir}". ` +
    `Start by reading the project index at "${projectIndexFile}", then read README.md, package.json (or equivalent), and a few key source files. ` +
    `After exploring, you MUST output your complete analysis wrapped in <roadmap_discovery> tags as a JSON object. ` +
    `Do the exploration first, then output the <roadmap_discovery> block. Do not stop after tool calls — always finish with the JSON output.`;

  const values = loadCoreValuesSection(projectDir);
  const combinedPrompt =
    `${values}${systemPrompt}\n\n${userPrompt}` +
    (values ? '\nThe product_vision and constraints must reflect the CORE VALUES at the top.' : '');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let fullText = '';

    try {
      fullText = await runPhaseViaCLI(combinedPrompt, projectDir, modelId, abortSignal, onStream);

      // Write full AI response to debug file for inspection
      try {
        const debugPath = join(outputDir, `debug_discovery_attempt_${attempt + 1}.txt`);
        writeFileSync(debugPath, `=== MODEL: ${modelId} ===\n=== CHARS: ${fullText.length} ===\n\n${fullText}`, 'utf-8');
      } catch { /* ignore */ }

      // Extract inline JSON from <roadmap_discovery>...</roadmap_discovery> tags
      const match = fullText.match(/<roadmap_discovery>([\s\S]*?)<\/roadmap_discovery>/);
      if (match) {
        const data = safeParseJson<Record<string, unknown>>(match[1].trim());
        if (data) {
          const required = ['project_name', 'target_audience', 'product_vision'];
          const missing = required.filter((k) => !(k in data));
          if (missing.length === 0) {
            writeFileSync(discoveryFile, JSON.stringify(data, null, 2), 'utf-8');
            return { phase: 'discovery', success: true, outputs: [discoveryFile], errors: [] };
          }
          errors.push(`Attempt ${attempt + 1}: Missing fields: ${missing.join(', ')}`);
        } else {
          errors.push(`Attempt ${attempt + 1}: Invalid JSON in <roadmap_discovery> block`);
        }
      } else {
        const hasOpen = fullText.includes('<roadmap_discovery>');
        const hasClose = fullText.includes('</roadmap_discovery>');
        console.error(`[Roadmap Discovery] Tag check — open: ${hasOpen}, close: ${hasClose}`);
        errors.push(`Attempt ${attempt + 1}: No <roadmap_discovery> block in AI response (open=${hasOpen}, close=${hasClose})`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Roadmap Discovery] attempt ${attempt + 1} error: ${msg}`);
      errors.push(`Attempt ${attempt + 1}: ${msg}`);
      if (abortSignal?.aborted) break;
    }
  }

  return { phase: 'discovery', success: false, outputs: [], errors };
}

// =============================================================================
// Competitor Analysis Phase
// =============================================================================

/**
 * Competitor analysis phase — delegates to the Competitors page pipeline
 * (competitors/pipeline.ts) so there is one competitor flow. A fresh analysis
 * from that page (or an earlier run) is reused as-is; otherwise discover +
 * profile run and write competitor_analysis.json, so the result shows up on the
 * Competitors page. Directions are synthesized too when the user hasn't saved a
 * ranking yet; a saved ranking (strategy.json) is never overwritten.
 *
 * Failure is non-fatal: the roadmap is still generated without competitor insights.
 */
async function runCompetitorAnalysisPhase(
  projectDir: string,
  outputDir: string,
  refresh: boolean,
  modelId: string,
  abortSignal?: AbortSignal,
  onStream?: RoadmapStreamCallback,
): Promise<RoadmapPhaseResult> {
  const competitorFile = join(outputDir, 'competitor_analysis.json');
  const existing = loadCompetitorState(projectDir);

  if (!refresh && existsSync(competitorFile) && isCompetitorAnalysisFresh(existing)) {
    onStream?.({ type: 'text-delta', text: 'Reusing the competitor analysis from the Competitors page.\n' });
    return { phase: 'competitor_analysis', success: true, outputs: [competitorFile], errors: [] };
  }

  const manualFile = join(outputDir, 'manual_competitors.json');
  const manualRaw = existsSync(manualFile)
    ? safeParseJson<{ competitors?: Array<{ name?: string; url?: string }> }>(readFileSync(manualFile, 'utf-8'))
    : null;
  const extraManual = (manualRaw?.competitors ?? [])
    .filter((c) => typeof c?.name === 'string' && c.name.trim())
    .map((c) => ({ name: String(c.name), url: typeof c.url === 'string' ? c.url : '' }));

  const store = createMemoryStore(existing ?? emptyCompetitorState(), (state) => saveCompetitorState(projectDir, state));
  try {
    const outcome = await runFullAnalysis(
      {
        projectDir,
        store,
        modelId,
        abortSignal,
        extraManual,
        onEvent: (event) => {
          if (event.kind === 'competitor' && event.competitor.status === 'done') {
            onStream?.({ type: 'text-delta', text: `Profiled ${event.competitor.name}\n` });
          } else if (event.kind === 'phase') {
            onStream?.({ type: 'text-delta', text: `Competitors: ${event.phase}…\n` });
          }
        },
      },
      // Synthesize directions too unless the user already ranked them on the Competitors page
      { focus: existing?.focus, count: existing?.competitorCount, synthesize: !existing?.rankingSavedAt },
    );
    if (outcome.success) {
      return { phase: 'competitor_analysis', success: true, outputs: [competitorFile], errors: [] };
    }
    return { phase: 'competitor_analysis', success: false, outputs: [], errors: [outcome.error ?? (outcome.aborted ? 'Aborted' : 'Failed')] };
  } catch (error) {
    return {
      phase: 'competitor_analysis',
      success: false,
      outputs: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

// =============================================================================
// Features Phase
// =============================================================================

/**
 * Render the user's regenerate guidance as a prompt section.
 * Placed after the file references so it reads as the most recent instruction,
 * and framed as overriding the previous roadmap's direction — the whole point is
 * to correct where the last generation went.
 */
export function buildGuidanceSection(guidance?: string): string {
  const text = guidance?.trim();
  if (!text) return '';
  return (
    `\n**DIRECTION FROM THE USER** (takes priority over the previous roadmap's direction — ` +
    `follow it when choosing the vision, audience, phases and features):\n` +
    `${text}\n`
  );
}

/** Features-phase rule added when core values are set */
export const CORE_VALUES_FEATURE_RULE =
  'Every feature must respect the CORE VALUES at the top: leave out features that conflict with them, ' +
  'or keep one only as priority "wont" with the conflicting value named in its rationale. ' +
  'Prefer "must"/"should" for features that directly serve a core value.';

/**
 * Run the features phase — generate and prioritize roadmap features.
 */
async function runFeaturesPhase(
  projectDir: string,
  outputDir: string,
  refresh: boolean,
  modelId: string,
  abortSignal?: AbortSignal,
  onStream?: RoadmapStreamCallback,
  guidance?: string,
  _useCompetitorAnalysis: boolean = false,
): Promise<RoadmapPhaseResult> {
  const roadmapFile = join(outputDir, 'roadmap.json');
  const competitorFile = join(outputDir, 'competitor_analysis.json');
  const discoveryFile = join(outputDir, 'roadmap_discovery.json');
  const projectIndexFile = join(projectDir, '.malvy', 'project_index.json');

  if (!existsSync(discoveryFile)) {
    return { phase: 'features', success: false, outputs: [], errors: ['Discovery file not found'] };
  }

  if (existsSync(roadmapFile) && !refresh) {
    return { phase: 'features', success: true, outputs: [roadmapFile], errors: [] };
  }

  const preservedFeatures = loadPreservedFeatures(roadmapFile);
  const errors: string[] = [];

  const loadedFeaturesPrompt = tryLoadPrompt('roadmap_features');

  // Dismissed features stay on the board but are prompted as rejections, not as features to keep
  const isDismissed = (f: Record<string, unknown>) => f.status === 'dismissed';
  const keptFeatures = preservedFeatures.filter((f) => !isDismissed(f));
  const dismissedFeatures: RemovedFeature[] = preservedFeatures.filter(isDismissed).map((f) => ({
    title: String(f.title ?? ''),
    description: typeof f.description === 'string' ? f.description.slice(0, 200) : undefined,
    removedAt: '',
  }));

  let preservedSection = '';
  if (keptFeatures.length > 0) {
    const preservedInfo = keptFeatures
      .map((f) => `  - ${(f as Record<string, string>).id ?? 'unknown'}: ${(f as Record<string, string>).title ?? 'Untitled'}`)
      .join('\n');
    preservedSection =
      `\n**EXISTING FEATURES TO PRESERVE** (do NOT regenerate these — generate NEW complementary features):\n${preservedInfo}\n`;
  }

  // The Competitors page's analysis counts even when this run didn't (re)run that phase
  const competitorSection = existsSync(competitorFile) ? buildCompetitorSection(competitorFile) : '';
  const funnelContext = await loadFunnelContextSection(projectDir);

  const contextBlock =
    `\n\n**Discovery File**: ${discoveryFile}\n` +
    `**Project Index File**: ${projectIndexFile}\n` +
    competitorSection +
    preservedSection +
    buildRemovedFeaturesSection([...dismissedFeatures, ...readRemovedFeatures(outputDir)]) +
    buildGuidanceSection(guidance) +
    loadStrategyGuidance(projectDir, { valuesAlreadyShown: true }) +
    loadDirectionTaggingSection(projectDir) +
    funnelContext +
    `\nRead the discovery file first, then output your complete roadmap wrapped in <roadmap_features> tags as instructed above.`;

  const systemPrompt = loadedFeaturesPrompt
    ? loadedFeaturesPrompt + contextBlock
    : `You are a product strategist. Read the discovery file at "${discoveryFile}" and generate a complete roadmap JSON wrapped in <roadmap_features> tags with fields: id, project_name, version, vision, target_audience (with "primary" key), phases (array), features (array, at least 8 items with id/title/description/rationale/priority/complexity/impact/phase_id/dependencies/status/acceptance_criteria/user_stories), metadata.`;

  const userPrompt =
    `Read the discovery file at "${discoveryFile}" and the project index at "${projectIndexFile}". ` +
    `Generate a complete strategic roadmap with at least 8 prioritized features across 3-4 phases. ` +
    `After reading those files, you MUST output the full roadmap JSON wrapped in <roadmap_features> tags. ` +
    `Do not stop after tool calls — always finish with the JSON output.`;

  const values = loadCoreValuesSection(projectDir);
  const combinedPrompt = `${values}${systemPrompt}\n\n${userPrompt}${values ? `\n${CORE_VALUES_FEATURE_RULE}` : ''}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let fullText = '';

    try {
      fullText = await runPhaseViaCLI(combinedPrompt, projectDir, modelId, abortSignal, onStream);

      const match = fullText.match(/<roadmap_features>([\s\S]*?)<\/roadmap_features>/);
      if (match) {
        const data = safeParseJson<Record<string, unknown>>(match[1].trim());
        if (data) {
          const required = ['phases', 'features', 'vision', 'target_audience'];
          const missing = required.filter((k) => !(k in data));
          const featureCount = ((data.features as unknown[]) ?? []).length;

          const targetAudience = data.target_audience;
          if (typeof targetAudience !== 'object' || targetAudience === null || !(targetAudience as Record<string, unknown>).primary) {
            missing.push('target_audience.primary');
          }

          if (missing.length === 0 && featureCount >= 3) {
            // Keep only direction ids that exist in strategy.json
            const knownDirectionIds = loadKnownDirectionIds(projectDir);
            sanitizeFeatureDirectionIds(data.features as Record<string, unknown>[], knownDirectionIds);
            sanitizeFeatureDirectionIds(preservedFeatures, knownDirectionIds, false);
            if (preservedFeatures.length > 0) {
              data.features = mergeFeatures(data.features as Record<string, unknown>[], preservedFeatures);
            }
            writeFileSync(roadmapFile, JSON.stringify(data, null, 2), 'utf-8');
            return { phase: 'features', success: true, outputs: [roadmapFile], errors: [] };
          }
          errors.push(`Attempt ${attempt + 1}: Missing fields or too few features (${featureCount}) — missing: ${missing.join(', ')}`);
        } else {
          errors.push(`Attempt ${attempt + 1}: Invalid JSON in <roadmap_features> block`);
        }
      } else {
        errors.push(`Attempt ${attempt + 1}: No <roadmap_features> block in AI response`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Attempt ${attempt + 1}: ${msg}`);
      if (abortSignal?.aborted) break;
    }
  }

  return { phase: 'features', success: false, outputs: [], errors };
}

// =============================================================================
// Feature Preservation Helpers
// =============================================================================

/**
 * Load features from existing roadmap that should be preserved.
 * Preserves features with status planned/in_progress/done/dismissed, linked specs, or internal source.
 */
function loadPreservedFeatures(roadmapFile: string): Record<string, unknown>[] {
  if (!existsSync(roadmapFile)) return [];

  const data = safeParseJson<Record<string, unknown>>(readFileSync(roadmapFile, 'utf-8'));
  if (!data) return [];

  const features: Record<string, unknown>[] = (data.features as Record<string, unknown>[]) ?? [];

  return features.filter((feature) => {
    const status = feature.status as string | undefined;
    const hasLinkedSpec = Boolean(feature.linked_spec_id);
    const source = feature.source as Record<string, unknown> | undefined;
    const isInternal = typeof source === 'object' && source !== null && source.provider === 'internal';

    return (
      status === 'planned' || status === 'in_progress' || status === 'done' || status === 'dismissed' ||
      hasLinkedSpec || isInternal
    );
  });
}

/**
 * Merge new AI-generated features with preserved features.
 * Preserved features take priority; deduplicates by ID and title.
 */
function mergeFeatures(
  newFeatures: Record<string, unknown>[],
  preserved: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (preserved.length === 0) return newFeatures;

  const preservedIds = new Set(
    preserved.filter((f) => f.id).map((f) => f.id as string),
  );
  const preservedTitles = new Set(
    preserved
      .filter((f) => f.title)
      .map((f) => (f.title as string).trim().toLowerCase()),
  );

  const merged = [...preserved];
  for (const feature of newFeatures) {
    const id = feature.id as string | undefined;
    const title = ((feature.title as string) ?? '').trim().toLowerCase();

    if (id && preservedIds.has(id)) continue;
    if (title && preservedTitles.has(title)) continue;
    merged.push(feature);
  }

  return merged;
}

// =============================================================================
// Roadmap Runner (Main Entry Point)
// =============================================================================

/**
 * Run the complete roadmap generation process.
 *
 * Multi-phase pipeline:
 * 1. Discovery — analyze project, infer audience and vision
 * 2. Competitor analysis (optional) — web research into competitors' pain points
 * 3. Features — generate and prioritize roadmap features
 */
export async function runRoadmapGeneration(
  config: RoadmapConfig,
  onStream?: RoadmapStreamCallback,
): Promise<RoadmapResult> {
  const {
    projectDir,
    modelShorthand = 'sonnet',
    refresh = false,
    enableCompetitorAnalysis = false,
    refreshCompetitorAnalysis = false,
    guidance,
    abortSignal,
  } = config;

  const outputDir = config.outputDir ?? join(projectDir, '.malvy', 'roadmap');
  const modelId = resolveModelId(modelShorthand);

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const phases: RoadmapPhaseResult[] = [];

  // Phase 1: Discovery
  onStream?.({ type: 'phase-start', phase: 'discovery' });
  const discoveryResult = await runDiscoveryPhase(
    projectDir, outputDir, refresh, modelId, abortSignal, onStream, guidance,
  );
  phases.push(discoveryResult);
  onStream?.({ type: 'phase-complete', phase: 'discovery', success: discoveryResult.success });

  if (!discoveryResult.success) {
    return {
      success: false,
      phases,
      error: `Discovery failed: ${discoveryResult.errors.join('; ')}`,
    };
  }

  // Phase 2 (optional): Competitor Analysis — non-fatal on failure
  if (enableCompetitorAnalysis) {
    onStream?.({ type: 'phase-start', phase: 'competitor_analysis' });
    const competitorResult = await runCompetitorAnalysisPhase(
      projectDir, outputDir, refreshCompetitorAnalysis, modelId, abortSignal, onStream,
    );
    phases.push(competitorResult);
    onStream?.({ type: 'phase-complete', phase: 'competitor_analysis', success: competitorResult.success });
    if (!competitorResult.success) {
      if (abortSignal?.aborted) {
        return { success: false, phases, error: 'Aborted' };
      }
      onStream?.({ type: 'error', error: `Competitor analysis failed (continuing without it): ${competitorResult.errors.join('; ')}` });
    }
  }

  // Phase 3: Feature Generation
  onStream?.({ type: 'phase-start', phase: 'features' });
  const featuresResult = await runFeaturesPhase(
    projectDir, outputDir, refresh, modelId, abortSignal, onStream, guidance, enableCompetitorAnalysis,
  );
  phases.push(featuresResult);
  onStream?.({ type: 'phase-complete', phase: 'features', success: featuresResult.success });

  if (!featuresResult.success) {
    return {
      success: false,
      phases,
      error: `Feature generation failed: ${featuresResult.errors.join('; ')}`,
    };
  }

  return {
    success: true,
    phases,
    roadmapPath: join(outputDir, 'roadmap.json'),
  };
}
