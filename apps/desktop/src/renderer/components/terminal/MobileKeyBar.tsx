import { useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft } from 'lucide-react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { cn } from '../../lib/utils';

/*
 * Sticky Ctrl modifier shared by the on-screen key bar and xterm's onData handler
 * (useXterm), so a letter typed on the soft keyboard right after tapping Ctrl is
 * sent as a control character. Only the mobile key bar ever arms it.
 */
let stickyCtrl = false;
const ctrlListeners = new Set<() => void>();

function setStickyCtrl(value: boolean) {
  if (stickyCtrl === value) return;
  stickyCtrl = value;
  for (const listener of ctrlListeners) listener();
}

function subscribeCtrl(listener: () => void) {
  ctrlListeners.add(listener);
  return () => {
    ctrlListeners.delete(listener);
  };
}

const getCtrlSnapshot = () => stickyCtrl;

/** Convert a single typed character into its control-character equivalent (Ctrl+C -> \x03). */
export function toControlChar(data: string): string {
  if (data.length !== 1) return data;
  if (data === ' ') return '\x00';
  const code = data.toUpperCase().charCodeAt(0);
  // @ A-Z [ \ ] ^ _ map to 0x00-0x1f
  if (code >= 64 && code <= 95) return String.fromCharCode(code & 0x1f);
  return data;
}

/**
 * Apply (and consume) the sticky Ctrl modifier to terminal input.
 * Returns the data unchanged when Ctrl is not armed.
 */
export function applyStickyCtrl(data: string): string {
  if (!stickyCtrl) return data;
  setStickyCtrl(false);
  return toControlChar(data);
}

interface MobileKeyBarProps {
  terminalId: string;
  xtermRef: React.MutableRefObject<XTerm | null>;
}

/** Compact on-screen key bar for phones (rendered below md only). */
export function MobileKeyBar({ terminalId, xtermRef }: MobileKeyBarProps) {
  const { t } = useTranslation('terminal');
  const ctrlActive = useSyncExternalStore(subscribeCtrl, getCtrlSnapshot, getCtrlSnapshot);

  const send = (data: string) => {
    setStickyCtrl(false);
    window.electronAPI.sendTerminalInput(terminalId, data);
  };

  const arrow = (final: 'A' | 'B' | 'C' | 'D') => {
    const appCursor = xtermRef.current?.modes.applicationCursorKeysMode ?? false;
    send(`${appCursor ? '\x1bO' : '\x1b['}${final}`);
  };

  // Keep focus in xterm's hidden textarea so the soft keyboard stays open
  const keepFocus = (e: ReactPointerEvent) => e.preventDefault();

  const keyClass =
    'flex h-10 min-w-10 shrink-0 items-center justify-center rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground active:bg-muted select-none touch-manipulation';

  return (
    <div
      role="toolbar"
      aria-label={t('mobile.keyBarLabel')}
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border/50 bg-card/60 px-1.5 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]"
    >
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => send('\x1b')} aria-label={t('mobile.escAria')}>
        {t('mobile.keys.esc')}
      </button>
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => send('\t')} aria-label={t('mobile.tabAria')}>
        {t('mobile.keys.tab')}
      </button>
      <button
        type="button"
        className={cn(keyClass, ctrlActive && 'border-primary bg-primary text-primary-foreground active:bg-primary')}
        onPointerDown={keepFocus}
        onClick={() => setStickyCtrl(!ctrlActive)}
        aria-label={t('mobile.ctrlAria')}
        aria-pressed={ctrlActive}
      >
        {t('mobile.keys.ctrl')}
      </button>
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => arrow('A')} aria-label={t('mobile.keys.up')}>
        <ArrowUp className="h-4 w-4" />
      </button>
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => arrow('B')} aria-label={t('mobile.keys.down')}>
        <ArrowDown className="h-4 w-4" />
      </button>
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => arrow('D')} aria-label={t('mobile.keys.left')}>
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => arrow('C')} aria-label={t('mobile.keys.right')}>
        <ArrowRight className="h-4 w-4" />
      </button>
      <button type="button" className={keyClass} onPointerDown={keepFocus} onClick={() => send('\r')} aria-label={t('mobile.enterAria')}>
        <CornerDownLeft className="h-4 w-4" />
      </button>
    </div>
  );
}
