import { FileText, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import type { ClaudeDocFile, ClaudeDocLayer, DocPointer } from '../../../../shared/types';

/** Line budget: root docs load on every task (100), directory docs on demand (60) */
const ROOT_DOC_LINE_LIMIT = 100;
const NESTED_DOC_LINE_LIMIT = 60;

export function docLineLimit(doc: ClaudeDocFile): number {
  return doc.layerPath.includes('/') ? NESTED_DOC_LINE_LIMIT : ROOT_DOC_LINE_LIMIT;
}

interface DocTreeProps {
  docs: ClaudeDocFile[];
  pointers: DocPointer[];
  selectedPath: string | null;
  onSelect: (relativePath: string) => void;
}

export function DocTree({ docs, pointers, selectedPath, onSelect }: DocTreeProps) {
  const { t } = useTranslation('context');

  const layers: Array<{ layer: ClaudeDocLayer; label: string }> = [
    { layer: 'team', label: t('docs.teamLayer') },
    { layer: 'malvy', label: t('docs.malvyLayer') },
  ];

  return (
    <nav className="space-y-4 p-3">
      {layers.map(({ layer, label }) => {
        const items = docs.filter((d) => d.layer === layer);
        if (items.length === 0) return null;
        return (
          <div key={layer}>
            <h4 className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {label}
            </h4>
            <ul className="space-y-0.5">
              {items.map((doc) => {
                const limit = docLineLimit(doc);
                const over = doc.lines > limit;
                const depth = doc.layerPath.split('/').length - 1;
                const pointerCount = pointers.filter((p) => p.docPath === doc.relativePath).length;
                return (
                  <li key={doc.relativePath}>
                    <button
                      type="button"
                      onClick={() => onSelect(doc.relativePath)}
                      title={doc.firstLine || doc.relativePath}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-xs transition-colors',
                        selectedPath === doc.relativePath
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-muted'
                      )}
                      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
                    >
                      {layer === 'team' ? (
                        <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label={t('docs.readOnly')} />
                      ) : (
                        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">{doc.layerPath}</span>
                      {pointerCount > 0 && (
                        <span className="shrink-0" aria-hidden>
                          👉{pointerCount}
                        </span>
                      )}
                      <span
                        className={cn(
                          'shrink-0 tabular-nums',
                          over ? 'font-medium text-yellow-500' : 'text-muted-foreground'
                        )}
                        title={over ? t('docs.overBudget', { limit }) : undefined}
                      >
                        {doc.lines}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
