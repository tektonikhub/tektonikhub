'use client';

import { useState } from 'react';
import { useBLK } from '@/hooks/use-blk';
import { PageHeading } from '@/components/ui/page-heading';
import { LLMSettings } from '@/components/studio/llm-settings';
import { BrandEditor } from './brand';
import { AppsManager, Empty, PoliciesManager, Tabs } from './shared';

export function AdminScreen() {
  const { data, org } = useBLK();
  const [tab, setTab] = useState('office');
  if (!org) return <Empty>No hay organización seleccionada.</Empty>;
  const apps = data.apps.filter(app => app.orgId === org.id);
  const pending = apps.filter(app => app.reviewStatus === 'pending_review').length;
  return <div className="stack"><PageHeading title="Oficina de IA" eyebrow={`${org.name} · ORG ADMIN`} description="Gobernanza y revisión de las herramientas creadas por tu equipo." /><div className="business-stats"><div className="business-stat"><strong>{apps.length}</strong><span>Aplicaciones · todos los estados</span></div><div className="business-stat"><strong>{pending}</strong><span>Pendientes de revisión</span></div><div className="business-stat"><strong>{apps.filter(app => app.reviewStatus === 'approved').length}</strong><span>Aprobadas · demo</span></div></div><Tabs value={tab} onChange={setTab} items={[{ id: 'office', label: 'Aplicaciones' }, { id: 'queue', label: `Cola de revisión (${pending})` }, { id: 'policies', label: 'Políticas de gobernanza' }, { id: 'brand', label: 'Marca y apariencia' }, { id: 'configuration', label: 'Configuración org · LLM Settings' }]} />{tab === 'office' && <AppsManager orgId={org.id} />}{tab === 'queue' && <AppsManager key="queue" orgId={org.id} queue />}{tab === 'policies' && <PoliciesManager />}{tab === 'brand' && <BrandEditor key={org.id} />}{tab === 'configuration' && <LLMSettings />}</div>;
}
