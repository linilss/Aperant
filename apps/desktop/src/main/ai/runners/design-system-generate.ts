/**
 * Generate a design system for a project that has none: an agent reads the project's own
 * UI code (CSS variables, Tailwind config, XAML resources, SwiftUI colours, components)
 * and writes it in the Claude Design System layout under `.malvy/design-system/project/`
 * (Malvy-owned, not in the repo). The Design view then reads it like a synced snapshot.
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { getToolPath } from '../../cli-tool-manager';
import { runClaudeCliDetailed } from '../cli/claude-cli';
import { DESIGN_SNAPSHOT_DIR } from '../../design-system';

export const GENERATED_DESIGN_DIR = `${DESIGN_SNAPSHOT_DIR}/project`;

const TOKENS_EXAMPLE = `{
  "name": "<Product>",
  "version": 1,
  "color": {
    "themes": [{ "id": "dark", "name": "Dark" }, { "id": "light", "name": "Light" }],
    "tokens": [
      { "name": "bg", "value": { "dark": "#0d0e10", "light": "#f4f2ed" }, "usage": "App background. code: --bg / Colors.xaml Bg" }
    ]
  },
  "type": {
    "families": { "display": "\\"Inter\\", system-ui, sans-serif" },
    "groups": [
      { "name": "Text", "family": "display", "styles": [
        { "name": "body", "fontSize": "16px", "lineHeight": "24px", "fontWeight": 400, "sample": "Real copy from the app", "usage": "Running text. code: body" }
      ] }
    ]
  },
  "spacing": { "xs": "4px", "sm": "8px", "md": "16px" },
  "radius": { "sm": "6px", "md": "12px" }
}`;

export function buildDesignGeneratePrompt(projectName: string): string {
  return (
    `Create the design system for "${projectName}" from what its UI code already does. Do not invent a new look.\n\n` +
    '## Find the real design\n' +
    'Search the repo for: CSS custom properties (:root, app.css, globals.css), Tailwind config, theme files, ' +
    'XAML ResourceDictionaries (Colors.xaml, Styles.xaml), SwiftUI Color/Font extensions and asset catalogs, ' +
    'Android colors.xml, font imports, and the most used UI components (buttons, cards, inputs, lists, nav). ' +
    'Read docs that describe the design (CLAUDE.md, docs/design*). Use the values you find; where the code has ' +
    'none (e.g. no spacing scale), derive one from the values actually used and say so in the usage text.\n\n' +
    `## Write (only inside ${GENERATED_DESIGN_DIR}/ — never touch any other file)\n` +
    `- ${GENERATED_DESIGN_DIR}/README.md — brand book: product, voice and tone, principles, colour/type/spacing/` +
    'radius rules, light/dark, do and don\'t, with real copy from the app. Short and concrete.\n' +
    `- ${GENERATED_DESIGN_DIR}/tokens.json — exactly this shape (add every real token; "usage" names where it is used and the code identifier):\n` +
    `${TOKENS_EXAMPLE}\n` +
    `- ${GENERATED_DESIGN_DIR}/design-system.json — {"name": "<Product> design system", "version": 1}\n` +
    `- ${GENERATED_DESIGN_DIR}/components/<Name>/README.md (what it is, variants, states, when to use, the code that implements it) ` +
    'and components/<Name>/preview.html (a standalone HTML page rendering its variants with the tokens inlined as CSS variables, ' +
    'light and dark side by side) for the 5–10 components the app uses most.\n\n' +
    'When done, reply with one line: DONE: <n> tokens, <m> components — or FAILED: <why>.'
  );
}

function changedOutsideMalvy(projectDir: string): string[] {
  try {
    return execFileSync(getToolPath('git'), ['status', '--porcelain', '--', '.', ':(exclude).malvy'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function runDesignGenerate(options: {
  projectDir: string;
  projectName: string;
  modelId: string;
  onProgress?: (text: string) => void;
}): Promise<{ ok: boolean; message: string; strayChanges: string[] }> {
  const before = new Set(changedOutsideMalvy(options.projectDir));
  const result = await runClaudeCliDetailed({
    prompt: buildDesignGeneratePrompt(options.projectName),
    cwd: options.projectDir,
    modelId: options.modelId,
    allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
    restrictTools: true,
    maxTurns: 120,
    projectPath: options.projectDir,
    onText: options.onProgress,
    onToolUse: (name, input) => {
      const file = typeof input.file_path === 'string' ? input.file_path : typeof input.pattern === 'string' ? input.pattern : '';
      options.onProgress?.(`\n${name} ${file}\n`);
    }
  });
  const strayChanges = changedOutsideMalvy(options.projectDir).filter((line) => !before.has(line));
  const tokensWritten = existsSync(path.join(options.projectDir, GENERATED_DESIGN_DIR, 'tokens.json'));
  const verdict = /^(DONE|FAILED):\s*(.*)$/m.exec(result.text);
  return {
    ok: tokensWritten && verdict?.[1] !== 'FAILED',
    message: verdict?.[2] ?? (tokensWritten ? 'Generated' : 'No tokens.json was written'),
    strayChanges
  };
}
