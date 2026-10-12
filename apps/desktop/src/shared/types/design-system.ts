/**
 * Design system (Context → Design): a Claude Design System artifact on claude.ai
 * plus its source files in the repo, detected from the project's docs.
 */

/** User overrides + Malvy state, stored in `<project>/.malvy/design-system.json` */
export interface DesignSystemConfig {
  /** Overrides the detected artifact URL */
  artifactUrl?: string;
  /** Overrides the detected source folder (relative to the project root) */
  sourceDir?: string;
  /** Last successful "Sync from artifact" (ISO) */
  syncedAt?: string;
  /** Artifact version the snapshot was synced from */
  syncedVersion?: string;
  /** Last successful "Publish design system" (ISO) */
  publishedAt?: string;
}

/** A claude.ai link found in a doc */
export interface DesignSystemLinkCandidate {
  url: string;
  /** Doc it was found in, relative to the project root */
  file: string;
  line: number;
  /** True when "design" wording is on or near the line */
  nearDesignWording: boolean;
}

/** Where the design system was found (all paths relative to the project root) */
export interface DesignSystemDetection {
  name: string | null;
  artifactUrl: string | null;
  /** Local source folder that mirrors the artifact's `project/` (e.g. design/system/project) */
  sourceDir: string | null;
  /** Publish root (artifact paths are relative to it), e.g. design/system */
  publishRoot: string | null;
  /** Token files mentioned next to the link (app.css, Colors.xaml, tokens.json) */
  tokenFiles: string[];
  /** Doc the link came from */
  docFile: string | null;
  candidates: DesignSystemLinkCandidate[];
  /** Which values come from `.malvy/design-system.json` */
  overridden: { artifactUrl: boolean; sourceDir: boolean };
}

export interface DesignColorToken {
  name: string;
  /** Default (light) value, CSS-ready */
  value: string;
  /** Theme variants, e.g. { light, dark } */
  values?: Record<string, string>;
  group?: string;
  usage?: string;
}

export interface DesignTypeStyle {
  name: string;
  family?: string;
  size?: string;
  weight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  sample?: string;
  group?: string;
  usage?: string;
}

export interface DesignSizeToken {
  name: string;
  value: string;
  usage?: string;
}

export interface DesignComponentInfo {
  name: string;
  description?: string;
  /** README path relative to the project root */
  path?: string;
  /** preview.html path relative to the project root */
  previewPath?: string;
}

export interface DesignDocInfo {
  title: string;
  /** Relative to the project root */
  path: string;
}

export type DesignDataOrigin = 'source' | 'snapshot' | 'tokenFiles' | 'none';

/** Normalized tokens/components/docs for display */
export interface DesignSystemData {
  origin: DesignDataOrigin;
  /** Name from tokens.json / design-system.json */
  name?: string;
  colors: DesignColorToken[];
  typography: DesignTypeStyle[];
  radii: DesignSizeToken[];
  spacing: DesignSizeToken[];
  components: DesignComponentInfo[];
  docs: DesignDocInfo[];
  /** Files that were read (relative to the project root) */
  parsedFiles: string[];
  /** Everything in the source/snapshot folder, shown when nothing could be parsed */
  rawFiles: string[];
}

export type DesignSystemOperation = 'sync' | 'publish';

export interface DesignSystemState {
  detection: DesignSystemDetection;
  config: DesignSystemConfig;
  data: DesignSystemData;
  /** `.malvy/design-system/` exists */
  hasSnapshot: boolean;
  /** Operation currently running for this project */
  running: DesignSystemOperation | null;
}

export type DesignFileChange = 'added' | 'modified';

export interface DesignChangedFile {
  /** Artifact path (relative to the publish root), e.g. project/tokens.json */
  path: string;
  /** Path relative to the project root */
  sourcePath: string;
  change: DesignFileChange;
}

export interface DesignPublishPlan {
  artifactUrl: string;
  /** Relative to the project root */
  publishRoot: string;
  sourceDir: string;
  /** Changed files; the index file (design-system.json) is sorted last */
  files: DesignChangedFile[];
  /** No snapshot yet: every source file counts as changed */
  noBaseline: boolean;
}

export interface DesignSystemRunResult {
  operation: DesignSystemOperation;
  /** Files written to the snapshot (sync) or published (publish) */
  files: string[];
  at: string;
}
