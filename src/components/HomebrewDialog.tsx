import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './homebrewEditor.css';

export function HomebrewDialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDivElement>(null), id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="hb-dialog-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="hb-dialog" ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} aria-busy={busy} tabIndex={-1} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); }
      if (e.key === 'Tab') {
        const nodes = [...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')].filter(el => el.getClientRects().length && !el.closest('fieldset:disabled'));
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) e.preventDefault();
        else if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }}><header><h2 id={id}>{title}</h2><button type="button" className="hb-icon" disabled={busy} onClick={onClose} aria-label="Close dialog" title="Close"><X size={18} /></button></header><div className="hb-dialog-content">{children}</div></div>
  </div>, document.body);
}
