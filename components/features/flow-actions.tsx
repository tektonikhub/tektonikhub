'use client';

import { useState } from 'react';
import { Check, Plus, Star } from 'lucide-react';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';

export function AddToFlowButton({ appId }: { appId: string }) {
  const { data, repository, action } = useBLK();
  const [busy, setBusy] = useState(false);
  const added = data.myFlow.some(entry => entry.appId === appId);
  async function add() {
    if (busy || added) return;
    setBusy(true);
    await action(() => repository.addToFlow(appId), 'Mini app añadida a Mi Flow.');
    setBusy(false);
  }
  return <Button variant="secondary" disabled={busy || added} aria-label={added ? 'Añadida a Mi Flow' : 'Añadir a Mi Flow'} onClick={() => void add()}>
    {added ? <Check size={14} /> : <Plus size={14} />}{busy ? 'Añadiendo…' : added ? 'Añadida' : 'Añadir'}
  </Button>;
}

export function FlowFavoriteButton({ appId }: { appId: string }) {
  const { data, repository, action } = useBLK();
  const [busy, setBusy] = useState(false);
  const entry = data.myFlow.find(row => row.appId === appId);
  async function toggle() {
    if (busy || !entry) return;
    setBusy(true);
    await action(() => repository.setFlowFavorite(appId, !entry.favorite),
      entry.favorite ? 'Mini app retirada de favoritos.' : 'Mini app marcada como favorita.');
    setBusy(false);
  }
  return <button className="flow-favorite" aria-label={entry?.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
    aria-pressed={entry?.favorite ?? false} disabled={busy || !entry} onClick={() => void toggle()}>
    <Star size={15} fill={entry?.favorite ? 'currentColor' : 'none'} />
  </button>;
}
