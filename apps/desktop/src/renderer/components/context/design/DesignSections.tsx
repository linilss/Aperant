import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  DesignColorToken,
  DesignComponentInfo,
  DesignDocInfo,
  DesignSizeToken,
  DesignTypeStyle,
} from '../../../../shared/types';

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
        {title}
        {count !== undefined && <span className="text-xs font-normal text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, [...(groups.get(k) ?? []), item]);
  }
  return [...groups.entries()];
}

function Swatch({ color }: { color: DesignColorToken }) {
  const { t } = useTranslation('context');
  const light = color.values?.light;
  const dark = color.values?.dark;
  const themed = light && dark;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card" title={color.usage}>
      {themed ? (
        <div className="flex h-14">
          <div className="flex-1" style={{ background: light }} title={`${t('design.light')}: ${light}`} />
          <div className="flex-1" style={{ background: dark }} title={`${t('design.dark')}: ${dark}`} />
        </div>
      ) : (
        <div className="h-14" style={{ background: color.value }} />
      )}
      <div className="space-y-0.5 border-t border-border px-2 py-1.5">
        <p className="truncate font-mono text-xs font-medium text-foreground">{color.name}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {themed ? `${light} / ${dark}` : color.value}
        </p>
      </div>
    </div>
  );
}

export function ColorsSection({ colors }: { colors: DesignColorToken[] }) {
  const { t } = useTranslation('context');
  const groups = groupBy(colors, (c) => c.group ?? '');
  return (
    <Section title={t('design.sections.colors')} count={colors.length}>
      <div className="space-y-4">
        {groups.map(([group, items]) => (
          <div key={group || 'ungrouped'} className="space-y-2">
            {groups.length > 1 && (
              <p className="text-xs font-medium text-muted-foreground">{group || t('design.ungrouped')}</p>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              {items.map((color) => (
                <Swatch key={color.name} color={color} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** First family in a CSS font stack, for the label */
const firstFamily = (family?: string) => family?.split(',')[0]?.replace(/["']/g, '').trim();

export function TypographySection({ styles }: { styles: DesignTypeStyle[] }) {
  const { t } = useTranslation('context');
  return (
    <Section title={t('design.sections.typography')} count={styles.length}>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {styles.map((style) => {
          const meta = [firstFamily(style.family), style.size, style.weight, style.lineHeight && `/ ${style.lineHeight}`]
            .filter(Boolean)
            .join(' ');
          return (
            <div key={`${style.group ?? ''}-${style.name}`} className="space-y-1 px-4 py-3 max-md:px-3" title={style.usage}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-mono text-xs font-medium text-foreground">{style.name}</span>
                {meta && <span className="font-mono text-[11px] text-muted-foreground">{meta}</span>}
              </div>
              <p
                className="break-words text-foreground"
                style={{
                  fontFamily: style.family,
                  fontSize: style.size ? `min(${style.size}, 2.5rem)` : undefined,
                  fontWeight: style.weight as CSSProperties['fontWeight'],
                  lineHeight: style.lineHeight,
                  letterSpacing: style.letterSpacing,
                }}
              >
                {style.sample || t('design.sample')}
              </p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function RadiiSpacingSection({ radii, spacing }: { radii: DesignSizeToken[]; spacing: DesignSizeToken[] }) {
  const { t } = useTranslation('context');
  return (
    <Section title={t('design.sections.radiiSpacing')}>
      <div className="grid gap-4 md:grid-cols-2">
        {radii.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t('design.sections.radii')}</p>
            <div className="flex flex-wrap gap-2">
              {radii.map((r) => (
                <div
                  key={r.name}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5"
                  title={r.usage}
                >
                  <div
                    className="h-9 w-9 shrink-0 border-2 border-primary/70 bg-primary/10"
                    style={{ borderRadius: r.value }}
                  />
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-medium text-foreground">{r.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{r.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {spacing.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t('design.sections.spacing')}</p>
            <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
              {spacing.map((s) => (
                <div key={s.name} className="flex items-center gap-3" title={s.usage}>
                  <span className="w-28 shrink-0 truncate font-mono text-xs text-foreground">{s.name}</span>
                  <div className="h-2 rounded-sm bg-primary/60" style={{ width: `min(${s.value}, 50%)` }} />
                  <span className="font-mono text-[11px] text-muted-foreground">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

export function ComponentsSection({
  components,
  onOpen,
}: {
  components: DesignComponentInfo[];
  onOpen: (component: DesignComponentInfo) => void;
}) {
  const { t } = useTranslation('context');
  return (
    <Section title={t('design.sections.components')} count={components.length}>
      <div className="grid gap-2 md:grid-cols-2">
        {components.map((c) => {
          const clickable = Boolean(c.path || c.previewPath);
          return (
            <button
              key={c.name}
              type="button"
              disabled={!clickable}
              onClick={() => onOpen(c)}
              className="flex min-h-12 w-full items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50 disabled:cursor-default disabled:hover:border-border"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{c.description || t('design.noDescription')}</p>
              </div>
              {clickable && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

export function DocsSection({ docs, onOpen }: { docs: DesignDocInfo[]; onOpen: (doc: DesignDocInfo) => void }) {
  const { t } = useTranslation('context');
  return (
    <Section title={t('design.sections.docs')} count={docs.length}>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
        {docs.map((doc) => (
          <button
            key={doc.path}
            type="button"
            onClick={() => onOpen(doc)}
            className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50"
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-foreground">{doc.title}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{doc.path}</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </Section>
  );
}
