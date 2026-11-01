'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/page-heading';
import type { App } from '@/lib/domain/types';
import { AppCard, AppDetails, contentText, DemoNotice, Empty, Field, SelectField } from './shared';

export function CatalogScreen() {
  const params = useSearchParams();
  const query = params.get('q') || '';
  return <CatalogContent key={query} initialQuery={query} />;
}
function CatalogContent({ initialQuery }: { initialQuery: string }) {
  const { data, org } = useBLK();
  const params = useSearchParams();
  const [query, setQuery] = useState(initialQuery), [area, setArea] = useState(''), [maturity, setMaturity] = useState(''), [tag, setTag] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = useState<App | null>(null), [dismissedId, setDismissedId] = useState<string | null>(null);
  const approved = data.apps.filter(app => app.orgId === org?.id && app.reviewStatus === 'approved' && org && !['pending', 'suspended'].includes(org.status));
  const tags = Array.from(new Set(approved.flatMap(app => app.tags)));
  const requested = approved.find(app => app.id === params.get('app'));
  const detail = selected || (requested && requested.id !== dismissedId ? requested : null);
  const apps = approved.filter(app => (!area || app.area === area) && (!maturity || app.maturity === maturity) && (!tag || app.tags.includes(tag)) && [app.title, app.version === 1 ? contentText(data, `catalog.appDescriptions.${app.id}`, app.desc) : app.desc, data.categories.find(category => category.id === app.area)?.label || app.area, ...app.tags, ...app.tech, data.users.find(user => user.id === app.authorId)?.name || ''].join(' ').toLocaleLowerCase('es').includes(query.trim().toLocaleLowerCase('es')));
  function clear() { setQuery(''); setArea(''); setMaturity(''); setTag(''); }
  return <div className="stack"><PageHeading title="Catálogo de aplicaciones" eyebrow="Tektonik hub · CATÁLOGO" description="Herramientas creadas por tu equipo y aprobadas para el catálogo de demostración." /><DemoNotice /><div className="business-stat"><strong>{approved.length}</strong><span>Apps disponibles en {org?.name}</span></div><div className="business-catalog-layout"><aside className="panel stack business-filters" aria-label="Filtros del catálogo"><Field label="Buscar aplicaciones" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nombre, área, autor o tecnología" /><div><h2 className="business-label">Áreas funcionales</h2><Button variant={!area ? 'primary' : 'ghost'} onClick={() => setArea('')}>Todas las áreas · {approved.length}</Button>{data.categories.map(category => <Button className="business-filter-button" key={category.id} variant={area === category.id ? 'primary' : 'ghost'} onClick={() => setArea(category.id)}>{category.label}<span>{approved.filter(app => app.area === category.id).length}</span></Button>)}</div><SelectField label="Madurez del catálogo" value={maturity} onChange={setMaturity}><option value="">Todas las etiquetas</option><option value="approved">Consolidada</option><option value="beta">Beta</option><option value="new">Nueva</option></SelectField><Button variant="secondary" onClick={clear}>Limpiar filtros</Button></aside><section className="stack"><div className="toolbar"><SelectField label="Tipo de herramienta" value={tag} onChange={setTag}><option value="">Todos los tipos</option>{tags.map(tag => <option key={tag} value={tag}>{({ ai: 'IA', automation: 'Automatización', analytics: 'Analítica', integration: 'Integraciones', document: 'Documentos' } as Record<string, string>)[tag] || tag}</option>)}</SelectField><span className="business-meta" role="status">{apps.length} resultados</span><div className="business-actions" aria-label="Vista de aplicaciones"><Button variant={view === 'grid' ? 'primary' : 'secondary'} aria-pressed={view === 'grid'} onClick={() => setView('grid')}>Cuadrícula</Button><Button variant={view === 'list' ? 'primary' : 'secondary'} aria-pressed={view === 'list'} onClick={() => setView('list')}>Lista</Button></div></div><div className={view === 'grid' ? 'app-grid' : 'business-app-list'}>{apps.map(app => <AppCard key={app.id} app={app} catalog onDetails={setSelected} />)}</div>{!apps.length && <Empty><h3>No se encontraron aplicaciones</h3><p>Prueba con otros filtros o términos de búsqueda.</p><Button variant="secondary" onClick={clear}>Restablecer filtros</Button></Empty>}{params.has('app') && !requested && <p role="status">La aplicación del enlace no existe o no está aprobada en esta organización.</p>}</section></div>{detail && <AppDetails app={detail} catalog onClose={() => { setSelected(null); setDismissedId(detail.id); }} />}</div>;
}
