import { Children, isValidElement, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import type { ClaudeDocFile, DocPointer } from '../../../../shared/types';
import { AddPointerButton, PointerItem } from './PointerControls';

interface DocViewerProps {
  doc: ClaudeDocFile;
  content: string;
  pointers: DocPointer[];
  /** Heading to scroll to once rendered */
  focusHeading?: string;
  onCreatePointer: (heading: string | undefined, content: string) => Promise<boolean>;
  onUpdatePointer: (id: string, content: string) => Promise<boolean>;
  onDeletePointer: (id: string) => void;
}

/** Plain text of rendered markdown children (used as the pointer's heading anchor) */
function nodeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children);
      return '';
    })
    .join('')
    .trim();
}

/** Heading texts in a markdown source, roughly as they render (inline markup stripped) */
function markdownHeadings(content: string): Set<string> {
  const headings = new Set<string>();
  for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    headings.add(
      match[1]
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .trim()
    );
  }
  return headings;
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-xl font-semibold mt-2 mb-3',
  2: 'text-lg font-semibold mt-6 mb-2',
  3: 'text-base font-semibold mt-5 mb-2',
  4: 'text-sm font-semibold mt-4 mb-1',
};

export function DocViewer({
  doc,
  content,
  pointers,
  focusHeading,
  onCreatePointer,
  onUpdatePointer,
  onDeletePointer,
}: DocViewerProps) {
  const { t } = useTranslation('context');
  const containerRef = useRef<HTMLDivElement>(null);

  const byHeading = useMemo(() => {
    const map = new Map<string, DocPointer[]>();
    for (const p of pointers) {
      const key = p.heading ?? '';
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [pointers]);

  // Pointers without a heading, or whose heading no longer exists in the file, show at the top
  const topPointers = useMemo(() => {
    const headings = markdownHeadings(content);
    return pointers.filter((p) => !p.heading || !headings.has(p.heading));
  }, [pointers, content]);

  const components = useMemo<Components>(() => {
    const heading = (level: 1 | 2 | 3 | 4) =>
      function Heading({ children }: { children?: ReactNode }) {
        const Tag = `h${level}` as const;
        const text = nodeText(children);
        const items = byHeading.get(text) ?? [];
        return (
          <>
            <Tag data-heading={text} className={`group scroll-mt-4 text-foreground ${HEADING_CLASSES[level]}`}>
              {children}
              <AddPointerButton onCreate={(value) => onCreatePointer(text, value)} />
            </Tag>
            {items.length > 0 && (
              <div className="not-prose my-2 space-y-1.5">
                {items.map((p) => (
                  <PointerItem key={p.id} pointer={p} onUpdate={onUpdatePointer} onDelete={onDeletePointer} />
                ))}
              </div>
            )}
          </>
        );
      };
    return {
      h1: heading(1),
      h2: heading(2),
      h3: heading(3),
      h4: heading(4),
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {children}
        </a>
      ),
    };
  }, [byHeading, onCreatePointer, onUpdatePointer, onDeletePointer]);

  // Re-run when content changes: the heading only exists once the new file has rendered
  // biome-ignore lint/correctness/useExhaustiveDependencies: content is an intentional trigger
  useEffect(() => {
    if (!focusHeading || !containerRef.current) return;
    const target = Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-heading]')).find(
      (el) => el.dataset.heading === focusHeading
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusHeading, content]);

  return (
    <div ref={containerRef} className="px-6 py-4 max-md:px-4">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground max-md:flex-wrap">
        {doc.layer === 'team' && <Lock className="h-3 w-3" aria-label={t('docs.readOnly')} />}
        <span className="font-mono max-md:min-w-0 max-md:break-all">{doc.relativePath}</span>
        <span>·</span>
        <span>{t('docs.lines', { count: doc.lines })}</span>
      </div>

      {topPointers.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {topPointers.map((p) => (
            <PointerItem
              key={p.id}
              pointer={p}
              onUpdate={onUpdatePointer}
              onDelete={onDeletePointer}
              showAnchor={Boolean(p.heading)}
            />
          ))}
        </div>
      )}

      <div className="prose prose-sm dark:prose-invert min-w-0 max-w-none [&_pre_code]:text-xs [&_table]:block [&_table]:overflow-x-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
