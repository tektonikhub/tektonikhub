'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} className="dialog" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = ref.current?.getBoundingClientRect(); if (rect && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) onClose(); } }}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label="Cerrar diálogo" onClick={onClose}><X size={18} /></Button></div>
    <div className="dialog-content">{open && children}</div>{footer && <div className="dialog-footer">{footer}</div>}
  </dialog>;
}
