import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  computePublishPlan,
  DESIGN_CONFIG_FILE,
  DESIGN_SNAPSHOT_DIR,
  detectDesignSystem,
  expandBraces,
  loadDesignData,
  readDesignConfig,
  readDesignFile,
  recordPublished,
  saveDesignOverrides,
  writeSnapshotFromSaved,
} from '../design-system';
import {
  parseCssCustomProperties,
  parseTokensJson,
  parseXamlColors,
  xamlColorToCss,
} from '../design-system-tokens';

let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  root = mkdtempSync(path.join(tmpdir(), 'design-system-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

const TOKENS_JSON = JSON.stringify({
  name: 'Family',
  version: 1,
  meta: { source: 'code' },
  color: {
    themes: [{ id: 'light' }, { id: 'dark' }],
    tokens: [
      { name: 'bg', value: { light: '#f6f2ec', dark: '#121614' }, usage: 'Page background.' },
      { name: 'm-blue', value: '#4c7bd9', usage: 'Member color.' },
    ],
  },
  type: {
    families: { serif: '"Fraunces", Georgia, serif', sans: '"Figtree", system-ui, sans-serif' },
    groups: [
      {
        name: 'Display',
        family: 'serif',
        styles: [{ name: 'page-title', fontSize: '32px', lineHeight: 1.15, fontWeight: 600, sample: 'Hej, Linus' }],
      },
      { name: 'Text', family: 'sans', styles: [{ name: 'body', fontSize: '16px', lineHeight: 1.45, fontWeight: 400 }] },
    ],
  },
  spacing: { tokens: [{ name: 'space-xs', value: '4px' }] },
  radius: { tokens: [{ name: 'r-l', value: '16px', usage: 'Cards.' }] },
});

const INDEX_JSON = JSON.stringify({ v: 3, title: 'Family', docs: { readme: 'project/README.md' } });

/** Modeled after Family/CLAUDE.md: table row with the source folder + publishing rules with `root:` */
const FAMILY_CLAUDE_MD = `# CLAUDE.md

Family: family assistant (web + iPhone).

| Dir | What | Details |
|-----|------|---------|
| \`src/Family.Web\` | ASP.NET Core 10 | \`src/Family.Web/CLAUDE.md\` |
| \`docs/\` | \`api.md\`, \`design.md\` (tokens "Hearth") | |
| \`design/system/project/\` | Source of the **Family Design System** artifact (https://claude.ai/artifact/P6CmgEYKLERcg1ohtGnMgn): tokens, brand book, component guidelines + previews, icons, logos | type rules: \`SKILL.md\` on the artifact |

## Definition of done
5. Design changed (a token, a new or changed component, an icon, copy rules): update \`design/system/project/\` (tokens.json,
   README.md, \`components/<Comp>/README.md\` + \`preview.html\`, \`components/bundle.css\` from \`app.css\` without the token blocks)
   and publish the changed files to the design system artifact (Artifact publish with \`url\`, \`root: design/system\`; new icons
   are uploaded as assets and recorded in \`design-system.json\`, which goes last).
`;

/** Modeled after Memory/CLAUDE.md: link + list of sources, no local design folder */
const MEMORY_CLAUDE_MD = `# Memory

Swedish learning-game collection for iPad.

## Design system — keep it in sync

The Claude Design system **Memory Design System** is the reference for colors, type, illustrations, components and the voice/level rules:
https://claude.ai/artifact/DWbXu677zcqw81EE5A8yy1

When a change touches any of these, update the design system in the same piece of work (read its file, edit, republish to that url):
- colors/sizes in \`Memory/Resources/Styles/Colors.xaml\` or new color constants → \`project/tokens.json\`
- new games/categories or level rules → \`project/games.md\`
- voice, phrases, music or sound rules → \`project/voice.md\`
`;

/** Modeled after XR/CLAUDE.md: Swedish, sources with brace expansion */
const XR_CLAUDE_MD = `# XR

## Konventioner
- UI-text på svenska.
- Designsystem: https://claude.ai/artifact/ALs38FAzRTHsG5p1nP6ChF (Claude Design System-artifact). Källor: \`XR.Web/wwwroot/css/app.css\` (webben, referens), \`XR/Resources/Styles/{Colors,Styles}.xaml\` och \`XR/Resources/Images\` (appen). Ändras färger: uppdatera designsystemet i samma ändring (läs artifacten först, publicera bara de ändrade filerna under \`project/\`, \`components/bundle.css\` = app.css utan \`:root\`-blocken).
- Fråga innan nya Azure-resurser skapas.
`;

const XAML = `<?xml version="1.0" encoding="UTF-8" ?>
<ResourceDictionary xmlns="http://schemas.microsoft.com/dotnet/2021/maui" xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml">
    <!-- Pastel palette for kids -->
    <Color x:Key="PastelBackground">#FFF5F0FF</Color>
    <Color x:Key="PastelPink">#FFD6C1</Color>
    <!-- Original colors kept for compatibility -->
    <Color x:Key="Primary">#7B5EA7</Color>
    <Color x:Key="White">White</Color>
    <SolidColorBrush x:Key="PrimaryBrush" Color="{StaticResource Primary}"/>
</ResourceDictionary>`;

const APP_CSS = `/* app */
:root {
    color-scheme: light;
    --bg: #f6f3ec;
    --accent: #1f4a3a;
    --radius: 16px;
    --radius-sm: 10px;
    --shadow: 0 1px 2px rgba(27, 38, 33, 0.04);
    --font-body: "Figtree", system-ui, sans-serif;
    --bottom-nav: 0px;
}

@media (prefers-color-scheme: dark) {
    :root {
        --bg: #121614;
        --accent: #8cc5a4;
    }
}

@media (max-width: 700px) {
    :root { --bottom-nav: calc(64px + env(safe-area-inset-bottom)); }
}
.btn { color: var(--accent); }
`;

describe('detectDesignSystem', () => {
  it('Family: artifact link, documented source folder and publish root', () => {
    const dir = project({
      'CLAUDE.md': FAMILY_CLAUDE_MD,
      'design/system/project/tokens.json': TOKENS_JSON,
      'design/system/project/design-system.json': INDEX_JSON,
      'design/system/project/README.md': '# Family brand book\n\nCalm and warm.',
      'design/system/project/components/Button/README.md': '# Button\n\nButtons trigger one action.',
      'design/system/project/components/Button/preview.html': '<button class="btn">Spara</button>',
      'design/system/project/assets/Icons/plus.svg': '<svg/>',
    });
    const d = detectDesignSystem(dir);
    expect(d.artifactUrl).toBe('https://claude.ai/artifact/P6CmgEYKLERcg1ohtGnMgn');
    expect(d.name).toBe('Family Design System');
    expect(d.sourceDir).toBe('design/system/project');
    expect(d.publishRoot).toBe('design/system');
    expect(d.docFile).toBe('CLAUDE.md');
    expect(d.overridden).toEqual({ artifactUrl: false, sourceDir: false });

    const data = loadDesignData(dir, d);
    expect(data.origin).toBe('source');
    expect(data.name).toBe('Family');
    expect(data.colors.map((c) => c.name)).toEqual(['bg', 'm-blue']);
    expect(data.components).toEqual([
      {
        name: 'Button',
        description: 'Buttons trigger one action.',
        path: 'design/system/project/components/Button/README.md',
        previewPath: 'design/system/project/components/Button/preview.html',
      },
    ]);
    expect(data.docs).toEqual([{ title: 'Family brand book', path: 'design/system/project/README.md' }]);
  });

  it('Memory: link + name, Colors.xaml as token file, no source folder', () => {
    const dir = project({
      'CLAUDE.md': MEMORY_CLAUDE_MD,
      'Memory/Resources/Styles/Colors.xaml': XAML,
      'design/icons.md': '# Icons',
    });
    const d = detectDesignSystem(dir);
    expect(d.artifactUrl).toBe('https://claude.ai/artifact/DWbXu677zcqw81EE5A8yy1');
    expect(d.name).toBe('Memory Design System');
    expect(d.sourceDir).toBeNull();
    expect(d.publishRoot).toBeNull();
    expect(d.tokenFiles).toEqual(['Memory/Resources/Styles/Colors.xaml']);

    const data = loadDesignData(dir, d);
    expect(data.origin).toBe('tokenFiles');
    expect(data.colors[0]).toEqual({ name: 'PastelBackground', value: '#F5F0FF', group: 'Pastel palette for kids' });
    expect(computePublishPlan(dir, d)).toBeNull();
  });

  it('XR: brace-expanded sources, generic "Claude Design System" is not used as the name', () => {
    const dir = project({
      'CLAUDE.md': XR_CLAUDE_MD,
      'XR.Web/wwwroot/css/app.css': APP_CSS,
      'XR/Resources/Styles/Colors.xaml': XAML,
      'XR/Resources/Styles/Styles.xaml': '<ResourceDictionary/>',
    });
    const d = detectDesignSystem(dir);
    expect(d.artifactUrl).toBe('https://claude.ai/artifact/ALs38FAzRTHsG5p1nP6ChF');
    expect(d.name).toBeNull();
    expect(d.tokenFiles).toEqual(['XR.Web/wwwroot/css/app.css', 'XR/Resources/Styles/Colors.xaml']);

    const data = loadDesignData(dir, d);
    expect(data.origin).toBe('tokenFiles');
    expect(data.colors.find((c) => c.name === 'bg')).toMatchObject({ group: 'app.css', values: { dark: '#121614' } });
    expect(data.colors.find((c) => c.name === 'Primary')?.group).toBe('Original colors kept for compatibility');
  });

  it('finds a design-system.json without any link and ignores links far from design wording', () => {
    const dir = project({
      'CLAUDE.md': '# App\n\nSee the roadmap: https://claude.ai/artifact/abc123\n\nMore text.\n',
      'web/ui/kit/design-system.json': INDEX_JSON,
      'node_modules/x/y/design-system.json': INDEX_JSON,
    });
    const d = detectDesignSystem(dir);
    expect(d.artifactUrl).toBeNull();
    expect(d.candidates).toEqual([
      { url: 'https://claude.ai/artifact/abc123', file: 'CLAUDE.md', line: 3, nearDesignWording: false },
    ]);
    expect(d.sourceDir).toBe('web/ui/kit');
    expect(d.publishRoot).toBe('web/ui');
  });

  it('reads links from nested CLAUDE.md and AGENTS.md', () => {
    const dir = project({
      'README.md': 'nothing',
      'apps/web/AGENTS.md': 'Our design tokens live in https://claude.ai/design/p/xyz-1\n',
    });
    expect(detectDesignSystem(dir).artifactUrl).toBe('https://claude.ai/design/p/xyz-1');
  });

  it('overrides from .malvy/design-system.json win, and empty strings clear them', () => {
    const dir = project({ 'CLAUDE.md': FAMILY_CLAUDE_MD, 'design/system/project/tokens.json': TOKENS_JSON, 'other/kit/tokens.json': '{}' });
    saveDesignOverrides(dir, { artifactUrl: 'https://claude.ai/artifact/Override1', sourceDir: 'other/kit/' });
    expect(readDesignConfig(dir)).toEqual({ artifactUrl: 'https://claude.ai/artifact/Override1', sourceDir: 'other/kit' });
    const d = detectDesignSystem(dir);
    expect(d.artifactUrl).toBe('https://claude.ai/artifact/Override1');
    expect(d.sourceDir).toBe('other/kit');
    expect(d.overridden).toEqual({ artifactUrl: true, sourceDir: true });

    saveDesignOverrides(dir, { artifactUrl: '', sourceDir: '' });
    expect(detectDesignSystem(dir).artifactUrl).toBe('https://claude.ai/artifact/P6CmgEYKLERcg1ohtGnMgn');
    expect(() => saveDesignOverrides(dir, { artifactUrl: 'https://evil.example/artifact/x' })).toThrow();
    expect(() => saveDesignOverrides(dir, { sourceDir: '../outside' })).toThrow();
    // Only .malvy is written
    expect(existsSync(path.join(dir, DESIGN_CONFIG_FILE))).toBe(true);
  });

  it('expands brace paths', () => {
    expect(expandBraces('XR/Resources/Styles/{Colors,Styles}.xaml')).toEqual([
      'XR/Resources/Styles/Colors.xaml',
      'XR/Resources/Styles/Styles.xaml',
    ]);
  });
});

describe('token parsing', () => {
  it('tokens.json (Claude Design System format)', () => {
    const t = parseTokensJson(JSON.parse(TOKENS_JSON));
    expect(t.name).toBe('Family');
    expect(t.colors[0]).toEqual({
      name: 'bg',
      value: '#f6f2ec',
      values: { light: '#f6f2ec', dark: '#121614' },
      usage: 'Page background.',
    });
    expect(t.typography[0]).toEqual({
      name: 'page-title',
      family: '"Fraunces", Georgia, serif',
      size: '32px',
      weight: '600',
      lineHeight: '1.15',
      sample: 'Hej, Linus',
      group: 'Display',
    });
    expect(t.radii).toEqual([{ name: 'r-l', value: '16px', usage: 'Cards.' }]);
    expect(t.spacing).toEqual([{ name: 'space-xs', value: '4px' }]);
  });

  it('tokens.json (generic W3C-style fallback)', () => {
    const t = parseTokensJson({
      color: { brand: { primary: { $value: '#ff0000', $type: 'color' } } },
      radius: { sm: { $value: '4px' } },
    });
    expect(t.colors).toEqual([{ name: 'brand-primary', value: '#ff0000', group: 'brand' }]);
    expect(t.radii).toEqual([{ name: 'sm', value: '4px' }]);
  });

  it('CSS :root with dark variants, skipping layout media queries', () => {
    const t = parseCssCustomProperties(APP_CSS);
    expect(t.colors).toEqual([
      { name: 'bg', value: '#f6f3ec', values: { light: '#f6f3ec', dark: '#121614' } },
      { name: 'accent', value: '#1f4a3a', values: { light: '#1f4a3a', dark: '#8cc5a4' } },
    ]);
    expect(t.radii.map((r) => r.name)).toEqual(['radius', 'radius-sm']);
    expect(t.typography).toEqual([{ name: 'font-body', family: '"Figtree", system-ui, sans-serif' }]);
  });

  it('XAML Color resources (ARGB → CSS, named colors, comment groups)', () => {
    expect(parseXamlColors(XAML)).toEqual([
      { name: 'PastelBackground', value: '#F5F0FF', group: 'Pastel palette for kids' },
      { name: 'PastelPink', value: '#FFD6C1', group: 'Pastel palette for kids' },
      { name: 'Primary', value: '#7B5EA7', group: 'Original colors kept for compatibility' },
      { name: 'White', value: 'white', group: 'Original colors kept for compatibility' },
    ]);
    expect(xamlColorToCss('#80112233')).toBe('#11223380');
  });

  it('unknown formats yield nothing instead of throwing', () => {
    expect(parseTokensJson('nope').colors).toEqual([]);
    expect(parseTokensJson({ foo: [1, 2] }).colors).toEqual([]);
    expect(parseCssCustomProperties('body { color: red }').colors).toEqual([]);
  });
});

describe('publish diff + snapshot', () => {
  const familyProject = () =>
    project({
      'CLAUDE.md': FAMILY_CLAUDE_MD,
      'design/system/project/tokens.json': TOKENS_JSON,
      'design/system/project/design-system.json': INDEX_JSON,
      'design/system/project/README.md': '# Brand',
      'design/system/project/components/Button/README.md': '# Button',
    });

  it('without a snapshot every file is new; index file sorts last', () => {
    const dir = familyProject();
    const plan = computePublishPlan(dir, detectDesignSystem(dir));
    expect(plan?.noBaseline).toBe(true);
    expect(plan?.publishRoot).toBe('design/system');
    expect(plan?.files.map((f) => f.path)).toEqual([
      'project/components/Button/README.md',
      'project/README.md',
      'project/tokens.json',
      'project/design-system.json',
    ]);
    expect(plan?.files.every((f) => f.change === 'added')).toBe(true);
  });

  it('lists only files whose hash differs from the snapshot, and resets after publish', () => {
    const dir = familyProject();
    const saved = path.join(dir, 'cli-scratch');
    for (const rel of ['project/tokens.json', 'project/design-system.json', 'project/README.md', 'project/components/Button/README.md']) {
      mkdirSync(path.dirname(path.join(saved, rel)), { recursive: true });
      writeFileSync(path.join(saved, rel), readFileSync(path.join(dir, 'design/system', rel)));
    }
    const written = writeSnapshotFromSaved(
      dir,
      [{ dir: saved, paths: ['project/tokens.json', 'project/design-system.json', 'project/README.md', 'project/components/Button/README.md'] }],
      { version: 'v1', now: new Date('2026-10-12T10:00:00Z') }
    );
    expect(written).toHaveLength(4);
    expect(readDesignConfig(dir)).toMatchObject({ syncedAt: '2026-10-12T10:00:00.000Z', syncedVersion: 'v1' });

    const detection = detectDesignSystem(dir);
    expect(computePublishPlan(dir, detection)?.files).toEqual([]);

    writeFileSync(path.join(dir, 'design/system/project/tokens.json'), '{"name":"Family 2"}');
    mkdirSync(path.join(dir, 'design/system/project/components/Card'));
    writeFileSync(path.join(dir, 'design/system/project/components/Card/README.md'), '# Card');
    const plan = computePublishPlan(dir, detection);
    expect(plan?.noBaseline).toBe(false);
    expect(plan?.files).toEqual([
      { path: 'project/components/Card/README.md', sourcePath: 'design/system/project/components/Card/README.md', change: 'added' },
      { path: 'project/tokens.json', sourcePath: 'design/system/project/tokens.json', change: 'modified' },
    ]);

    recordPublished(dir, plan?.files ?? [], new Date('2026-10-12T11:00:00Z'));
    expect(readDesignConfig(dir).publishedAt).toBe('2026-10-12T11:00:00.000Z');
    expect(computePublishPlan(dir, detection)?.files).toEqual([]);
  });

  it('snapshot is used for display when there is no source folder', () => {
    const dir = project({ 'CLAUDE.md': MEMORY_CLAUDE_MD });
    const saved = path.join(dir, 'scratch');
    mkdirSync(path.join(saved, 'project'), { recursive: true });
    writeFileSync(path.join(saved, 'project/tokens.json'), TOKENS_JSON);
    writeFileSync(path.join(saved, 'project/voice.md'), '# Voice\n\nShort sentences.');
    writeSnapshotFromSaved(dir, [{ dir: saved, paths: ['project/tokens.json', 'project/voice.md'] }]);
    const d = detectDesignSystem(dir);
    const data = loadDesignData(dir, d);
    expect(data.origin).toBe('snapshot');
    expect(data.colors).toHaveLength(2);
    expect(data.docs).toEqual([{ title: 'Voice', path: `${DESIGN_SNAPSHOT_DIR}/project/voice.md` }]);
    expect(readDesignFile(dir, d, `${DESIGN_SNAPSHOT_DIR}/project/voice.md`)).toContain('Short sentences');
    expect(() => readDesignFile(dir, d, 'CLAUDE.md')).toThrow();
    expect(() => readDesignFile(dir, d, '../etc/passwd')).toThrow();
  });

  it('rejects unsafe artifact paths from the CLI', () => {
    const dir = project({ 'CLAUDE.md': MEMORY_CLAUDE_MD });
    expect(() => writeSnapshotFromSaved(dir, [{ dir, paths: ['../escape.txt'] }])).toThrow(/Unsafe/);
  });
});
