import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../shared/constants';
import { getAugmentedEnvAsync, findExecutableAsync } from '../../env-utils';
import { resolveModelId } from '../config/phase-config';
import type { ModelShorthand } from '../config/types';
import { tryLoadPrompt } from '../prompts/prompt-loader';
import { getClaudeProfileManager } from '../../claude-profile-manager';
import { writeFileAtomicSync } from '../../utils/atomic-file';
import { ImplementationPlanSchema } from '../schema/implementation-plan';
import { projectStore } from '../../project-store';
import { safeParseJson } from '../../utils/json-repair';

export type RefinePhaseName = 'understand' | 'prd' | 'grill' | 'plan' | 'proofread';

export type RefinePhaseStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface RefinePhase {
  name: RefinePhaseName;
  index: number;
  status: RefinePhaseStatus;
  label: string;
}

export interface RefineOrchestratorConfig {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  projectDir: string;
  specDir: string;
  terminalId: string;
  autoMode: boolean;
  modelShorthand?: ModelShorthand;
  getMainWindow: () => BrowserWindow | null;
}

const PHASE_DEFINITIONS: Array<{ name: RefinePhaseName; label: string }> = [
  { name: 'understand', label: 'Understand' },
  { name: 'prd', label: 'Write PRD' },
  { name: 'grill', label: 'Grill' },
  { name: 'plan', label: 'Plan' },
  { name: 'proofread', label: 'Proofread' },
];

const MAX_CONTEXT_BUDGET = 30_000;
const RECENT_PHASE_FULL_FIDELITY = 2;
const SESSION_FILENAME = 'refine_session.json';

export interface RefineSessionData {
  currentPhase: RefinePhaseName | null;
  completedPhases: RefinePhaseName[];
  phaseOutputs: Record<string, string>;
  mode: 'auto' | 'interactive';
  updatedAt: string;
}

export class RefineOrchestrator {
  private phases: RefinePhase[];
  private currentPhaseIndex = -1;
  private phaseOutputs: Map<RefinePhaseName, string> = new Map();
  private outputBuffer = '';
  private activeChild: ChildProcess | null = null;
  private abortController: AbortController | null = null;
  private config: RefineOrchestratorConfig;
  private isRunning = false;

  constructor(config: RefineOrchestratorConfig) {
    this.config = config;
    this.phases = PHASE_DEFINITIONS.map((def, index) => ({
      ...def,
      index,
      status: 'pending' as RefinePhaseStatus,
    }));
  }

  getPhases(): RefinePhase[] {
    return [...this.phases];
  }

  getCurrentPhase(): RefinePhase | null {
    if (this.currentPhaseIndex < 0 || this.currentPhaseIndex >= this.phases.length) return null;
    return this.phases[this.currentPhaseIndex];
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const session = this.loadSession();
    if (session && session.completedPhases.length > 0) {
      for (const [name, output] of Object.entries(session.phaseOutputs)) {
        this.phaseOutputs.set(name as RefinePhaseName, output);
      }
      for (const completedName of session.completedPhases) {
        const phase = this.phases.find(p => p.name === completedName);
        if (phase) phase.status = 'completed';
      }
      this.emitPhaseChange();

      this.writeToTerminal(`\x1b[1;36m═══ Resuming refine pipeline ═══\x1b[0m\r\n`);
      for (const name of session.completedPhases) {
        this.writeToTerminal(`  \x1b[32m✓\x1b[0m ${name}\r\n`);
      }
      this.writeToTerminal(`\r\n`);

      const firstIncomplete = this.phases.findIndex(p => p.status === 'pending');
      if (firstIncomplete >= 0) {
        await this.runPhase(firstIncomplete);
      } else {
        this.writeToTerminal(`\x1b[1;32m═══ All phases already completed ═══\x1b[0m\r\n`);
        this.isRunning = false;
      }
    } else {
      await this.runPhase(0);
    }
  }

  static loadSessionStatic(specDir: string): RefineSessionData | null {
    const sessionPath = join(specDir, SESSION_FILENAME);
    if (!existsSync(sessionPath)) return null;
    try {
      return JSON.parse(readFileSync(sessionPath, 'utf-8')) as RefineSessionData;
    } catch {
      return null;
    }
  }

  static deleteSession(specDir: string): void {
    const sessionPath = join(specDir, SESSION_FILENAME);
    try {
      if (existsSync(sessionPath)) {
        const { unlinkSync } = require('node:fs') as typeof import('node:fs');
        unlinkSync(sessionPath);
      }
    } catch { /* best effort */ }
  }

  async skipPhase(): Promise<void> {
    if (!this.isRunning) return;
    const current = this.getCurrentPhase();
    if (!current) return;

    this.abortController?.abort();
    this.activeChild?.kill('SIGTERM');
    current.status = 'skipped';
    this.emitPhaseChange();

    if (this.currentPhaseIndex < this.phases.length - 1) {
      await this.runPhase(this.currentPhaseIndex + 1);
    } else {
      this.isRunning = false;
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.activeChild?.kill('SIGTERM');
    this.isRunning = false;
  }

  private async runPhase(index: number): Promise<void> {
    if (index >= this.phases.length) {
      this.isRunning = false;
      return;
    }

    this.currentPhaseIndex = index;
    const phase = this.phases[index];
    phase.status = 'active';
    this.emitPhaseChange();
    this.saveSession();

    this.writeToTerminal(`\r\n\x1b[1;36m═══ Phase ${index + 1}/${this.phases.length}: ${phase.label} ═══\x1b[0m\r\n\r\n`);

    if (phase.name === 'proofread') {
      try {
        await this.runProofreadPhase();
        phase.status = 'completed';
        this.emitPhaseChange();
        this.saveSession();
      } catch (err) {
        if (this.abortController?.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        this.writeToTerminal(`\r\n\x1b[31mError in proofread: ${msg}\x1b[0m\r\n`);
        phase.status = 'completed';
        this.emitPhaseChange();
      }
      this.writeToTerminal(`\r\n\x1b[1;32m═══ Refine pipeline complete ═══\x1b[0m\r\n`);
      this.isRunning = false;
      return;
    }

    const prompt = this.buildPhasePrompt(phase);
    if (!prompt) {
      this.writeToTerminal(`\x1b[33mSkipping ${phase.label} — prompt not found\x1b[0m\r\n`);
      phase.status = 'skipped';
      this.emitPhaseChange();
      this.saveSession();
      await this.runPhase(index + 1);
      return;
    }

    try {
      const output = await this.runCliPhase(prompt);
      const structured = this.extractStructuredOutput(output, phase.name);
      if (structured) {
        this.phaseOutputs.set(phase.name, structured);
        this.persistPhaseArtifacts(phase.name, structured);
      }
      phase.status = 'completed';
      this.emitPhaseChange();
      this.saveSession();

      if (this.currentPhaseIndex < this.phases.length - 1) {
        await this.runPhase(this.currentPhaseIndex + 1);
      } else {
        this.writeToTerminal(`\r\n\x1b[1;32m═══ Refine pipeline complete ═══\x1b[0m\r\n`);
        this.markTaskAsRefined();
        this.isRunning = false;
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.writeToTerminal(`\r\n\x1b[31mError in ${phase.label}: ${msg}\x1b[0m\r\n`);
      phase.status = 'completed';
      this.emitPhaseChange();
      if (this.currentPhaseIndex < this.phases.length - 1) {
        await this.runPhase(this.currentPhaseIndex + 1);
      } else {
        this.isRunning = false;
      }
    }
  }

  private async runCliPhase(prompt: string): Promise<string> {
    const [augmentedEnv, claudePath] = await Promise.all([
      getAugmentedEnvAsync(),
      findExecutableAsync('claude'),
    ]);
    if (!claudePath) {
      throw new Error('Claude CLI not found — make sure Claude Code is installed');
    }

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const modelId = resolveModelId(this.config.modelShorthand ?? 'sonnet');
    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--allowedTools', 'Read,Glob,Grep',
      '--model', modelId,
    ];

    const profileEnv = getClaudeProfileManager().getActiveProfileEnv();
    const spawnEnv = { ...augmentedEnv, ...profileEnv };
    const child = spawn(claudePath, args, {
      cwd: this.config.projectDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: spawnEnv,
    });
    this.activeChild = child;

    const onAbort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdin.write(prompt, 'utf-8');
    child.stdin.end();

    child.stderr?.on('data', () => { /* drain */ });

    let responseText = '';
    let stdoutBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (event.type === 'assistant') {
          const message = event.message as Record<string, unknown> | undefined;
          const content = (message?.content ?? []) as Array<Record<string, unknown>>;
          for (const block of content) {
            if (block.type === 'text') {
              const text = String(block.text ?? '');
              if (text) {
                responseText += text;
                this.writeToTerminal(text.replace(/\n/g, '\r\n'));
              }
            } else if (block.type === 'tool_use') {
              const name = String(block.name ?? 'unknown');
              const input = block.input as Record<string, unknown> | undefined;
              const summary = input?.file_path
                ? String(input.file_path)
                : input?.pattern
                ? `pattern: ${input.pattern}`
                : '';
              this.writeToTerminal(`\x1b[2m🔧 ${name} ${summary}\x1b[0m\r\n`);
            }
          }
        } else if (event.type === 'result') {
          if (responseText.length === 0 && event.result) {
            responseText = String(event.result);
            this.writeToTerminal(responseText.replace(/\n/g, '\r\n'));
          }
          if (event.subtype === 'error_during_execution') {
            throw new Error(String(event.error ?? event.result ?? 'CLI error'));
          }
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      child.on('close', () => {
        signal.removeEventListener('abort', onAbort);
        this.activeChild = null;
        resolve();
      });
      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        this.activeChild = null;
        reject(err);
      });
    });

    if (signal.aborted) throw new Error('Aborted');

    return responseText;
  }

  private buildPhasePrompt(phase: RefinePhase): string | null {
    let promptName: string;
    if (phase.name === 'grill' && this.config.autoMode) {
      promptName = 'refine/refine_grill_auto';
    } else {
      promptName = `refine/refine_${phase.name}`;
    }

    const systemPrompt = tryLoadPrompt(promptName);
    if (!systemPrompt) return null;

    const taskContext = `# Task\n**Title:** ${this.config.taskTitle}\n**Description:** ${this.config.taskDescription}`;
    const priorContext = this.buildAccumulatedContext();

    return `${systemPrompt}\n\n${taskContext}\n\n${priorContext}`;
  }

  private buildAccumulatedContext(): string {
    const entries = Array.from(this.phaseOutputs.entries());
    if (entries.length === 0) return '';

    let totalLen = 0;
    const parts: string[] = [];

    for (let i = entries.length - 1; i >= 0; i--) {
      const [name, output] = entries[i];
      const isRecent = entries.length - i <= RECENT_PHASE_FULL_FIDELITY;
      let text = output;

      if (!isRecent && totalLen + text.length > MAX_CONTEXT_BUDGET) {
        text = text.slice(0, 2000) + '\n... (truncated)';
      }

      parts.unshift(`## Prior Phase: ${name}\n${text}`);
      totalLen += text.length;
    }

    return `# Context from Prior Phases\n\n${parts.join('\n\n')}`;
  }

  private extractStructuredOutput(text: string, phase: RefinePhaseName): string | null {
    const tagMap: Record<RefinePhaseName, string> = {
      understand: 'understanding',
      prd: 'prd',
      grill: 'grill_decisions',
      plan: 'plan_json',
      proofread: 'findings',
    };
    const tag = tagMap[phase];
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
    const match = text.match(regex);
    return match ? match[1].trim() : null;
  }

  private writeToTerminal(data: string): void {
    const win = this.config.getMainWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.TERMINAL_OUTPUT, this.config.terminalId, data);
    }
  }

  private async runProofreadPhase(): Promise<void> {
    const perspectives = [
      { name: 'Risks & Security', prompt: 'refine/refine_proofread_risks' },
      { name: 'Feasibility & Dependencies', prompt: 'refine/refine_proofread_feasibility' },
      { name: 'Clarity & Scope', prompt: 'refine/refine_proofread_clarity' },
    ];

    const allFindings: Array<{ perspective: string; phase: string; category: string; issue: string; fix: string }> = [];

    for (let i = 0; i < perspectives.length; i++) {
      const perspective = perspectives[i];
      this.writeToTerminal(`\x1b[2m── Review ${i + 1}/${perspectives.length}: ${perspective.name} ──\x1b[0m\r\n\r\n`);

      const systemPrompt = tryLoadPrompt(perspective.prompt);
      if (!systemPrompt) {
        this.writeToTerminal(`\x1b[33mPrompt not found for ${perspective.name}\x1b[0m\r\n`);
        continue;
      }

      const context = this.buildAccumulatedContext();
      const planJson = this.phaseOutputs.get('plan') ?? '';
      const fullPrompt = `${systemPrompt}\n\n# Plan to Review\n${planJson}\n\n${context}`;

      try {
        const output = await this.runCliPhase(fullPrompt);
        const findings = this.extractFindings(output);
        for (const f of findings) {
          allFindings.push({ ...f, perspective: perspective.name });
        }
        this.writeToTerminal(`\r\n\x1b[2m  → ${findings.length} finding(s)\x1b[0m\r\n\r\n`);
      } catch (err) {
        if (this.abortController?.signal.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        this.writeToTerminal(`\r\n\x1b[33m⚠ ${perspective.name} failed: ${msg}\x1b[0m\r\n`);
      }
    }

    const grouped = this.groupFindings(allFindings);
    const consensus = grouped.filter(g => g.perspectives >= 2);
    const skipped = grouped.length - consensus.length;

    this.writeToTerminal(`\r\n\x1b[1mProofread complete.\x1b[0m\r\n`);
    this.writeToTerminal(`  ${allFindings.length} findings reviewed by 3 perspectives\r\n`);
    this.writeToTerminal(`  \x1b[32m${consensus.length} consensus\x1b[0m (≥2/3) — `);

    if (consensus.length > 0) {
      this.writeToTerminal(`applying fixes...\r\n`);
      for (const c of consensus) {
        this.writeToTerminal(`  \x1b[32m•\x1b[0m Phase ${c.phase}: ${c.issue.slice(0, 80)}\r\n`);
      }

      await this.runSynthesisPass(consensus);
    } else {
      this.writeToTerminal(`no fixes needed\r\n`);
    }

    this.writeToTerminal(`  \x1b[2m${skipped} skipped\x1b[0m (single-perspective only)\r\n`);
  }

  private extractFindings(text: string): Array<{ phase: string; category: string; issue: string; fix: string }> {
    const findings: Array<{ phase: string; category: string; issue: string; fix: string }> = [];
    const findingRegex = /<finding\s+phase="([^"]*)"\s+category="([^"]*)"\s+issue="([^"]*)"\s+fix="([^"]*)"\s*\/>/g;
    let match: RegExpExecArray | null;
    while ((match = findingRegex.exec(text)) !== null) {
      findings.push({ phase: match[1], category: match[2], issue: match[3], fix: match[4] });
    }
    return findings;
  }

  private groupFindings(
    findings: Array<{ perspective: string; phase: string; category: string; issue: string; fix: string }>
  ): Array<{ phase: string; category: string; issue: string; fix: string; perspectives: number }> {
    const groups = new Map<string, { phase: string; category: string; issue: string; fix: string; perspectiveSet: Set<string> }>();

    for (const f of findings) {
      const key = `${f.phase}:${f.category}`;
      const existing = groups.get(key);
      if (existing) {
        existing.perspectiveSet.add(f.perspective);
        if (f.fix.length > existing.fix.length) existing.fix = f.fix;
      } else {
        groups.set(key, { phase: f.phase, category: f.category, issue: f.issue, fix: f.fix, perspectiveSet: new Set([f.perspective]) });
      }
    }

    return Array.from(groups.values()).map(g => ({
      phase: g.phase,
      category: g.category,
      issue: g.issue,
      fix: g.fix,
      perspectives: g.perspectiveSet.size,
    }));
  }

  private async runSynthesisPass(
    consensus: Array<{ phase: string; category: string; issue: string; fix: string }>
  ): Promise<void> {
    const synthesizePrompt = tryLoadPrompt('refine/refine_synthesize');
    if (!synthesizePrompt) {
      this.writeToTerminal(`\x1b[33m⚠ Synthesize prompt not found — skipping auto-fix\x1b[0m\r\n`);
      return;
    }

    const planJson = this.phaseOutputs.get('plan') ?? '';
    const findingsBlock = consensus
      .map(f => `- Phase ${f.phase} (${f.category}): ${f.issue}\n  Fix: ${f.fix}`)
      .join('\n');

    const prompt = `${synthesizePrompt}\n\n# Current Plan\n${planJson}\n\n# Consensus Findings to Apply\n${findingsBlock}`;

    try {
      const output = await this.runCliPhase(prompt);
      const updatedPlan = this.extractStructuredOutput(output, 'plan');
      if (updatedPlan) {
        this.phaseOutputs.set('plan', updatedPlan);
        this.persistPhaseArtifacts('plan', updatedPlan);
        this.writeToTerminal(`\r\n\x1b[32m✓ Plan updated with ${consensus.length} fix(es)\x1b[0m\r\n`);
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.writeToTerminal(`\r\n\x1b[33m⚠ Synthesis failed: ${msg} — keeping original plan\x1b[0m\r\n`);
    }
  }

  private persistPhaseArtifacts(phase: RefinePhaseName, output: string): void {
    try {
      mkdirSync(this.config.specDir, { recursive: true });

      if (phase === 'prd') {
        const specPath = join(this.config.specDir, 'spec.md');
        writeFileAtomicSync(specPath, `# Specification\n\n## Overview\n\n${output}`);
        this.writeToTerminal(`\r\n\x1b[2m→ Wrote spec.md\x1b[0m\r\n`);
      }

      if (phase === 'plan') {
        const parsed = safeParseJson(output);
        if (!parsed) {
          this.writeToTerminal(`\r\n\x1b[33m⚠ Plan output was not valid JSON — skipping file write\x1b[0m\r\n`);
          return;
        }

        const now = new Date().toISOString();
        const plan = {
          ...parsed,
          created_at: (parsed as Record<string, unknown>).created_at ?? now,
          updated_at: now,
          spec_file: 'spec.md',
        };

        const validation = ImplementationPlanSchema.safeParse(plan);
        if (!validation.success) {
          this.writeToTerminal(`\r\n\x1b[33m⚠ Plan failed schema validation — writing raw output\x1b[0m\r\n`);
        }

        const planPath = join(this.config.specDir, 'implementation_plan.json');
        writeFileAtomicSync(planPath, JSON.stringify(validation.success ? validation.data : plan, null, 2));
        this.writeToTerminal(`\r\n\x1b[2m→ Wrote implementation_plan.json\x1b[0m\r\n`);

        this.invalidateTaskCache();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.writeToTerminal(`\r\n\x1b[33m⚠ Failed to persist ${phase} artifact: ${msg}\x1b[0m\r\n`);
    }
  }

  private invalidateTaskCache(): void {
    const projects = projectStore.getProjects();
    for (const project of projects) {
      if (project.path === this.config.projectDir) {
        projectStore.invalidateTasksCache(project.id);
        const win = this.config.getMainWindow();
        if (win) {
          win.webContents.send(IPC_CHANNELS.TASK_REFINE_APPLIED, this.config.taskId, project.id);
        }
        break;
      }
    }
  }

  private emitPhaseChange(): void {
    const win = this.config.getMainWindow();
    if (!win) return;
    const current = this.getCurrentPhase();
    win.webContents.send(
      IPC_CHANNELS.TASK_REFINE_PHASE_CHANGE,
      this.config.taskId,
      current?.name ?? '',
      current?.index ?? -1,
      this.phases.map(p => ({ name: p.name, label: p.label, status: p.status })),
    );
  }

  private markTaskAsRefined(): void {
    try {
      const metadataPath = join(this.config.specDir, 'task_metadata.json');
      let metadata: Record<string, unknown> = {};
      if (existsSync(metadataPath)) {
        const content = readFileSync(metadataPath, 'utf-8');
        metadata = JSON.parse(content) as Record<string, unknown>;
      }
      metadata.refined = true;
      metadata.refinedAt = new Date().toISOString();
      mkdirSync(this.config.specDir, { recursive: true });
      writeFileAtomicSync(metadataPath, JSON.stringify(metadata, null, 2));
      this.invalidateTaskCache();
    } catch { /* best effort */ }
  }

  private getSessionPath(): string {
    return join(this.config.specDir, SESSION_FILENAME);
  }

  private saveSession(): void {
    try {
      mkdirSync(this.config.specDir, { recursive: true });
      const data: RefineSessionData = {
        currentPhase: this.getCurrentPhase()?.name ?? null,
        completedPhases: this.phases
          .filter(p => p.status === 'completed')
          .map(p => p.name),
        phaseOutputs: Object.fromEntries(this.phaseOutputs),
        mode: this.config.autoMode ? 'auto' : 'interactive',
        updatedAt: new Date().toISOString(),
      };
      writeFileAtomicSync(this.getSessionPath(), JSON.stringify(data, null, 2));
    } catch { /* best effort — don't break the pipeline */ }
  }

  private loadSession(): RefineSessionData | null {
    return RefineOrchestrator.loadSessionStatic(this.config.specDir);
  }
}
