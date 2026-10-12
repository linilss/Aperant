/**
 * Design token parsers for the Context → Design tab.
 *
 * Pure functions, tolerant by design: unknown shapes yield empty lists instead of
 * throwing. Supported inputs:
 * - Claude Design System `tokens.json` (`color.tokens`, `type.groups`, `spacing.tokens`, `radius.tokens`)
 *   plus generic nested/W3C-style token JSON (`$value`) as a fallback
 * - CSS custom properties in `:root` (dark values from `@media (prefers-color-scheme: dark)`)
 * - XAML `<Color x:Key="…">` resources (MAUI/WPF Colors.xaml)
 */

import type { DesignColorToken, DesignSizeToken, DesignTypeStyle } from '../shared/types';

export interface ParsedTokens {
  name?: string;
  colors: DesignColorToken[];
  typography: DesignTypeStyle[];
  radii: DesignSizeToken[];
  spacing: DesignSizeToken[];
}

export const emptyTokens = (): ParsedTokens => ({ colors: [], typography: [], radii: [], spacing: [] });

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined;

const CSS_NAMED_COLORS = new Set([
  'white', 'black', 'transparent', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink', 'gray', 'grey',
  'magenta', 'cyan', 'navy', 'teal', 'olive', 'maroon', 'silver', 'lime', 'aqua', 'fuchsia', 'midnightblue',
]);

/** True for values a browser can paint as a color */
export function looksLikeColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  return (
    /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(v) ||
    /^(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|hwb|color)\(/.test(v) ||
    CSS_NAMED_COLORS.has(v)
  );
}

/** XAML `#AARRGGBB` → CSS `#RRGGBBAA`; other values are returned as is */
export function xamlColorToCss(value: string): string {
  const v = value.trim();
  const argb = /^#([0-9a-f]{2})([0-9a-f]{6})$/i.exec(v);
  if (argb) return argb[1].toLowerCase() === 'ff' ? `#${argb[2]}` : `#${argb[2]}${argb[1]}`;
  const argbShort = /^#([0-9a-f])([0-9a-f]{3})$/i.exec(v);
  if (argbShort) return argbShort[1].toLowerCase() === 'f' ? `#${argbShort[2]}` : `#${argbShort[2]}${argbShort[1]}`;
  return /^[a-z]+$/i.test(v) ? v.toLowerCase() : v;
}

// =============================================================================
// tokens.json
// =============================================================================

function colorValue(raw: unknown): { value: string; values?: Record<string, string> } | null {
  const direct = str(raw);
  if (direct) return { value: direct };
  if (!isObj(raw)) return null;
  const values: Record<string, string> = {};
  for (const [key, v] of Object.entries(raw)) {
    const s = str(v);
    if (s) values[key] = s;
  }
  const keys = Object.keys(values);
  if (keys.length === 0) return null;
  return { value: values.light ?? values.default ?? values[keys[0]], values };
}

function sizeTokens(section: unknown): DesignSizeToken[] {
  const tokens = isObj(section) ? section.tokens : section;
  if (Array.isArray(tokens)) {
    return tokens.flatMap((t) => {
      if (!isObj(t)) return [];
      const name = str(t.name);
      const value = str(t.value);
      return name && value ? [{ name, value, ...(str(t.usage) ? { usage: str(t.usage) } : {}) }] : [];
    });
  }
  if (isObj(tokens)) {
    return Object.entries(tokens).flatMap(([name, v]) => {
      const value = str(isObj(v) ? (v.$value ?? v.value) : v);
      return value ? [{ name, value }] : [];
    });
  }
  return [];
}

function claudeColors(color: unknown): DesignColorToken[] {
  if (!isObj(color)) return [];
  const out: DesignColorToken[] = [];
  const push = (t: unknown, group?: string) => {
    if (!isObj(t)) return;
    const name = str(t.name);
    const cv = colorValue(t.value);
    if (!name || !cv) return;
    out.push({
      name,
      ...cv,
      ...(str(t.group) || group ? { group: str(t.group) ?? group } : {}),
      ...(str(t.usage) ? { usage: str(t.usage) } : {}),
    });
  };
  if (Array.isArray(color.tokens)) for (const t of color.tokens) push(t);
  if (Array.isArray(color.groups)) {
    for (const g of color.groups) {
      if (isObj(g) && Array.isArray(g.tokens)) for (const t of g.tokens) push(t, str(g.name));
    }
  }
  if (out.length === 0 && !Array.isArray(color.tokens)) {
    // Flat map: { "primary": "#…" } or { "primary": { "light": …, "dark": … } }
    for (const [name, v] of Object.entries(color)) {
      if (name === 'themes') continue;
      const cv = colorValue(isObj(v) && ('$value' in v || 'value' in v) ? (v.$value ?? v.value) : v);
      if (cv && looksLikeColor(cv.value)) out.push({ name, ...cv });
    }
  }
  return out;
}

function claudeTypography(type: unknown): DesignTypeStyle[] {
  if (!isObj(type)) return [];
  const families = isObj(type.families) ? type.families : {};
  const resolveFamily = (f: unknown) => {
    const key = str(f);
    if (!key) return undefined;
    return str(families[key]) ?? key;
  };
  const out: DesignTypeStyle[] = [];
  const pushStyle = (s: unknown, group?: string, groupFamily?: unknown) => {
    if (!isObj(s)) return;
    const name = str(s.name);
    if (!name) return;
    const style: DesignTypeStyle = { name };
    const family = resolveFamily(s.family ?? s.fontFamily ?? groupFamily);
    if (family) style.family = family;
    const size = str(s.fontSize ?? s.size);
    if (size) style.size = /^\d+(\.\d+)?$/.test(size) ? `${size}px` : size;
    const weight = str(s.fontWeight ?? s.weight);
    if (weight) style.weight = weight;
    const lineHeight = str(s.lineHeight);
    if (lineHeight) style.lineHeight = lineHeight;
    const letterSpacing = str(s.letterSpacing);
    if (letterSpacing) style.letterSpacing = letterSpacing;
    if (str(s.sample)) style.sample = str(s.sample);
    if (group) style.group = group;
    if (str(s.usage)) style.usage = str(s.usage);
    out.push(style);
  };
  if (Array.isArray(type.groups)) {
    for (const g of type.groups) {
      if (!isObj(g)) continue;
      if (Array.isArray(g.styles)) for (const s of g.styles) pushStyle(s, str(g.name), g.family);
    }
  }
  if (Array.isArray(type.styles)) for (const s of type.styles) pushStyle(s);
  if (out.length === 0) {
    // At least show the families
    for (const [name, family] of Object.entries(families)) {
      const f = str(family);
      if (f) out.push({ name, family: f });
    }
  }
  return out;
}

/** Generic fallback: walk any token JSON and classify leaves by their path */
function walkGeneric(root: unknown): ParsedTokens {
  const out = emptyTokens();
  const visit = (node: unknown, path: string[]) => {
    if (path.length > 6) return;
    if (isObj(node) && ('$value' in node || ('value' in node && !isObj(node.value)))) {
      const value = str(node.$value ?? node.value);
      if (value) classify(path, value, str(node.$type ?? node.type));
      return;
    }
    if (isObj(node)) {
      for (const [k, v] of Object.entries(node)) visit(v, [...path, k]);
      return;
    }
    const value = str(node);
    if (value) classify(path, value);
  };
  const classify = (path: string[], value: string, type?: string) => {
    const name = path.slice(1).join('-') || path.join('-');
    const joined = `${path.join('.')} ${type ?? ''}`.toLowerCase();
    if (type === 'color' || /colou?r/.test(joined) || (looksLikeColor(value) && !/font|shadow/.test(joined))) {
      if (looksLikeColor(value)) out.colors.push({ name, value, ...(path.length > 2 ? { group: path[1] } : {}) });
    } else if (/radius|radii|corner/.test(joined)) {
      out.radii.push({ name, value });
    } else if (/spac|gap|space/.test(joined)) {
      out.spacing.push({ name, value });
    } else if (/font.?family|typeface/.test(joined)) {
      out.typography.push({ name, family: value });
    }
  };
  if (isObj(root)) {
    for (const [k, v] of Object.entries(root)) {
      if (k === 'meta' || k === '$schema' || k === 'name' || k === 'version') continue;
      visit(v, [k]);
    }
  }
  return out;
}

/** Parse a tokens.json (Claude Design System format first, generic fallback) */
export function parseTokensJson(json: unknown): ParsedTokens {
  if (!isObj(json)) return emptyTokens();
  const colorSection = json.color ?? json.colors;
  const typeSection = json.type ?? json.typography;
  const result: ParsedTokens = {
    ...(str(json.name) ? { name: str(json.name) } : {}),
    colors: claudeColors(colorSection),
    typography: claudeTypography(typeSection),
    radii: sizeTokens(json.radius ?? json.radii),
    spacing: sizeTokens(json.spacing ?? json.space),
  };
  const empty = !result.colors.length && !result.typography.length && !result.radii.length && !result.spacing.length;
  if (!empty) return result;
  return { ...walkGeneric(json), ...(result.name ? { name: result.name } : {}) };
}

/** Name from a design-system.json index (`title`/`namespace`/`name`) */
export function parseDesignIndexJson(json: unknown): { name?: string; readme?: string } {
  if (!isObj(json)) return {};
  const name = str(json.title) ?? str(json.namespace) ?? str(json.name);
  const readme = isObj(json.docs) ? str(json.docs.readme) : undefined;
  return { ...(name ? { name } : {}), ...(readme ? { readme } : {}) };
}

// =============================================================================
// CSS custom properties
// =============================================================================

/** Body of every `selector { … }` block for `:root`, tagged with whether it sits in a dark media query */
function rootBlocks(css: string): Array<{ body: string; dark: boolean }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks: Array<{ body: string; dark: boolean }> = [];
  for (const m of clean.matchAll(/:root\b[^{]*\{/g)) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    while (i < clean.length && depth > 0) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') depth--;
      i++;
    }
    const body = clean.slice(start, i - 1);
    // Enclosing at-rule: the nearest unclosed `@media (…) {` before this block
    const before = clean.slice(0, m.index);
    let open = 0;
    let enclosing = '';
    for (let j = before.length - 1; j >= 0; j--) {
      if (before[j] === '}') open++;
      else if (before[j] === '{') {
        if (open === 0) {
          const header = before.slice(before.lastIndexOf('\n', j) + 1, j);
          enclosing = header;
          break;
        }
        open--;
      }
    }
    const selector = m[0];
    const dark =
      /prefers-color-scheme:\s*dark/.test(enclosing) || /\[data-theme=["']?dark/.test(selector) || /\.dark\b/.test(selector);
    // Other media queries (widths etc.) only tweak layout values; skip them
    if (enclosing.startsWith('@media') && !dark) continue;
    blocks.push({ body, dark });
  }
  return blocks;
}

function declarations(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out.push([m[1].slice(2), m[2].trim()]);
  return out;
}

/** CSS custom properties from `:root` → colors (with dark variants), radii, spacing, font families */
export function parseCssCustomProperties(css: string): ParsedTokens {
  const out = emptyTokens();
  const dark = new Map<string, string>();
  const light: Array<[string, string]> = [];
  for (const block of rootBlocks(css)) {
    for (const [name, value] of declarations(block.body)) {
      if (block.dark) dark.set(name, value);
      else light.push([name, value]);
    }
  }
  const seen = new Set<string>();
  for (const [name, value] of light) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (looksLikeColor(value)) {
      const darkValue = dark.get(name);
      out.colors.push(
        darkValue && looksLikeColor(darkValue)
          ? { name, value, values: { light: value, dark: darkValue } }
          : { name, value }
      );
    } else if (/radius|^r-/.test(name)) {
      out.radii.push({ name, value });
    } else if (/^(space|spacing|gap)/.test(name)) {
      out.spacing.push({ name, value });
    } else if (/^font/.test(name) && /[a-z"']/i.test(value) && !/^\d/.test(value)) {
      out.typography.push({ name, family: value });
    }
  }
  return out;
}

// =============================================================================
// XAML
// =============================================================================

/** `<Color x:Key="Primary">#7B5EA7</Color>` → colors; the preceding XML comment becomes the group */
export function parseXamlColors(xaml: string): DesignColorToken[] {
  const out: DesignColorToken[] = [];
  const re = /<!--([\s\S]*?)-->|<Color\s+[^>]*x:Key="([^"]+)"[^>]*>\s*([^<\s][^<]*?)\s*<\/Color>/g;
  let group: string | undefined;
  for (const m of xaml.matchAll(re)) {
    if (m[1] !== undefined) {
      const firstLine = m[1].trim().split('\n')[0]?.trim().replace(/[.:]$/, '') ?? '';
      group = firstLine ? (firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine) : group;
      continue;
    }
    const name = m[2];
    const value = xamlColorToCss(m[3]);
    if (looksLikeColor(value)) out.push({ name, value, ...(group ? { group } : {}) });
  }
  return out;
}
