import { useState } from 'react';
import { Check, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover';
import { cn } from '../../../lib/utils';
import type { DocPointer } from '../../../../shared/types';

interface PointerFormProps {
  initialValue?: string;
  onSave: (content: string) => Promise<boolean>;
  onCancel: () => void;
}

/** Textarea + Save/Cancel used for creating and editing pointers */
export function PointerForm({ initialValue = '', onSave, onCancel }: PointerFormProps) {
  const { t } = useTranslation('context');
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    setError(false);
    const ok = await onSave(value.trim());
    setSaving(false);
    if (!ok) setError(true);
  };

  return (
    <div className="space-y-2">
      <Textarea
        autoFocus
        value={value}
        placeholder={t('pointers.placeholder')}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSave();
          if (e.key === 'Escape') onCancel();
        }}
        className="min-h-[72px] text-sm"
      />
      {error && <p className="text-xs text-destructive">{t('pointers.saveError')}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('pointers.cancel')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving || !value.trim()}>
          {t('pointers.save')}
        </Button>
      </div>
    </div>
  );
}

interface AddPointerButtonProps {
  onCreate: (content: string) => Promise<boolean>;
  className?: string;
}

/** 👉 button next to a heading that opens a popover to add a pointer */
export function AddPointerButton({ onCreate, className }: AddPointerButtonProps) {
  const { t } = useTranslation('context');
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('pointers.add')}
          aria-label={t('pointers.add')}
          className={cn(
            'ml-2 inline-flex items-center rounded px-1 text-sm align-middle opacity-0 transition-opacity',
            'group-hover:opacity-100 focus:opacity-100 hover:bg-muted',
            open && 'opacity-100',
            className
          )}
        >
          <span aria-hidden>👉</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{t('pointers.add')}</p>
        <PointerForm
          onCancel={() => setOpen(false)}
          onSave={async (content) => {
            const ok = await onCreate(content);
            if (ok) setOpen(false);
            return ok;
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

interface PointerItemProps {
  pointer: DocPointer;
  onUpdate: (id: string, content: string) => Promise<boolean>;
  onDelete: (id: string) => void;
  /** Optional click handler on the text (e.g. jump to the anchored doc) */
  onOpen?: (pointer: DocPointer) => void;
  showAnchor?: boolean;
}

/** A single pointer with inline edit and delete */
export function PointerItem({ pointer, onUpdate, onDelete, onOpen, showAnchor }: PointerItemProps) {
  const { t } = useTranslation('context');
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-2">
        <PointerForm
          initialValue={pointer.content}
          onCancel={() => setEditing(false)}
          onSave={async (content) => {
            const ok = await onUpdate(pointer.id, content);
            if (ok) setEditing(false);
            return ok;
          }}
        />
      </div>
    );
  }

  return (
    <div className="group/pointer flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
      <span aria-hidden className="shrink-0">👉</span>
      <div className="min-w-0 flex-1">
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(pointer)}
            className="text-left text-foreground hover:underline"
            title={t('pointers.openInDocs')}
          >
            {pointer.content}
          </button>
        ) : (
          <p className="text-foreground whitespace-pre-wrap">{pointer.content}</p>
        )}
        {(showAnchor || pointer.appliedIn) && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {showAnchor && (
              <span className="font-mono">
                {pointer.docPath
                  ? `${pointer.docPath}${pointer.heading ? ` › ${pointer.heading}` : ''}`
                  : t('pointers.general')}
              </span>
            )}
            {pointer.appliedIn && (
              <span className="inline-flex items-center gap-1 text-success">
                <Check className="h-3 w-3" />
                {t('pointers.appliedIn', { file: pointer.appliedIn })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover/pointer:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setEditing(true)}
          aria-label={t('pointers.edit')}
          title={t('pointers.edit')}
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive"
          onClick={() => onDelete(pointer.id)}
          aria-label={t('pointers.delete')}
          title={t('pointers.delete')}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
