import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { createPointer, deletePointer, updatePointer } from '../../stores/context-store';
import type { DocPointer } from '../../../shared/types';
import { PointerForm, PointerItem } from './docs/PointerControls';

interface PointersSectionProps {
  projectId: string;
  pointers: DocPointer[];
  /** Jump to the pointer's doc file + heading in the Docs tab */
  onOpenPointer: (pointer: DocPointer) => void;
}

/** Developer pointers on top of the Memories tab */
export function PointersSection({ projectId, pointers, onOpenPointer }: PointersSectionProps) {
  const { t } = useTranslation('context');
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {t('pointers.title')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('pointers.description')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('pointers.new')}
        </Button>
      </div>

      {creating && (
        <div className="rounded-md border border-border p-3">
          <PointerForm
            onCancel={() => setCreating(false)}
            onSave={async (content) => {
              const ok = await createPointer(projectId, { content });
              if (ok) setCreating(false);
              return ok;
            }}
          />
        </div>
      )}

      {pointers.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground">{t('pointers.empty')}</p>
      ) : (
        <div className="space-y-1.5">
          {pointers.map((pointer) => (
            <PointerItem
              key={pointer.id}
              pointer={pointer}
              showAnchor
              onOpen={pointer.docPath ? onOpenPointer : undefined}
              onUpdate={(id, content) => updatePointer(projectId, id, content)}
              onDelete={(id) => {
                void deletePointer(projectId, id);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
