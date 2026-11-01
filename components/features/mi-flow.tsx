'use client';

import { useRef, useState, type PointerEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ChartNoAxesCombined, ChevronLeft, ChevronRight, FileText, Grid2X2, Hand,
  Layers3, Orbit, Plus, Search, ShieldCheck, Sparkles, Trash2, Users } from 'lucide-react';
import { useBLK } from '@/hooks/use-blk';
import { approvedCatalogApps, flowOrbitPage, searchFlowApps } from '@/lib/data/mi-flow';
import type { App } from '@/lib/domain/types';
import { Button } from '@/components/ui/button';
import { AppAccessButton, AppDetails } from './shared';
import { AddToFlowButton, FlowFavoriteButton } from './flow-actions';
import { ApplicationView } from './application-view';

const palettes = [
  { color: '#644581', tint: '#ece3f7' }, { color: '#436b93', tint: '#e0ebf8' },
  { color: '#a15b73', tint: '#f6e1e9' }, { color: '#8d7828', tint: '#f5edcc' },
  { color: '#357358', tint: '#e0efe5' }, { color: '#976649', tint: '#f3e4d9' },
];
function appTheme(app: App) {
  const hash = [...app.area].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const icon = app.tags.includes('ai') ? Sparkles : app.tags.includes('analytics') ? ChartNoAxesCombined
    : app.tags.includes('document') ? FileText : app.area === 'rrhh' ? Users : Layers3;
  return { ...palettes[hash % palettes.length], icon };
}
function MiniAppIcon({ app }: { app: App }) {
  const { color, tint, icon: Icon } = appTheme(app);
  return <span className="flow-app-icon" style={{ color, backgroundColor: tint }}><Icon size={20} aria-hidden="true" /></span>;
}
const pad = (value: number) => String(value).padStart(2, '0');

export function MiFlowScreen() {
  const params = useSearchParams();
  if (params.has('open')) return <ApplicationView appId={params.get('open') || ''} />;
  return <MiFlowContent key={params.toString()} initialQuery={params.get('q') || ''}
    initialArea={params.get('area') || ''} initialView={params.get('view') === 'cards' ? 'cards' : 'orbit'} />;
}
function MiFlowContent({ initialQuery, initialArea, initialView }: {
  initialQuery: string; initialArea: string; initialView: 'orbit' | 'cards';
}) {
  const { data, org } = useBLK();
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [area, setArea] = useState(initialArea);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<App | null>(null);
  const [intent, setIntent] = useState('');
  const [dragOffset, setDragOffset] = useState(0);
  const drag = useRef<{ pointerId: number; x: number } | null>(null);
  const catalog = approvedCatalogApps(data, org);
  const byId = new Map(catalog.map(app => [app.id, app]));
  const miniApps = data.myFlow.flatMap(entry => {
    const app = byId.get(entry.appId);
    return app ? [app] : [];
  });
  const apps = searchFlowApps(miniApps, data, query, area, favoritesOnly);
  const selected = apps.find(app => app.id === selectedId) || apps[0] || null;
  const orbit = flowOrbitPage(apps, selected?.id || null);
  const favorites = miniApps.filter(app => data.myFlow.find(entry => entry.appId === app.id)?.favorite).length;
  const categories = data.categories.filter(category => miniApps.some(app => app.area === category.id));
  const suggestions = catalog.filter(app => !data.myFlow.some(entry => entry.appId === app.id)).slice(0, 3);
  function step(direction: number) {
    if (!apps.length) return;
    setSelectedId(apps[(orbit.index + direction + apps.length) % apps.length].id);
  }
  function clear() { setQuery(''); setArea(''); setFavoritesOnly(false); }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.current.x;
    if (Math.abs(delta) > 30) step(delta > 0 ? -1 : 1);
    drag.current = null;
    setDragOffset(0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <div className="mi-flow" data-testid="mi-flow">
    <header className="flow-header">
      <div><p className="eyebrow"><span className="flow-dot" />TU TRABAJO, EN ÓRBITA</p>
        <h1>Encuentra tu próximo flow.</h1>
        <p>Tus mini apps favoritas de {org?.name}. Todo a mano, a tu ritmo.</p></div>
      <Link className="btn flow-btn-dark" href="/catalog"><Plus size={17} />Añadir mini apps</Link>
    </header>
    <div className="flow-stats" aria-label="Resumen de Mi Flow">
      <div><strong>{pad(miniApps.length)}</strong><span><b>mini apps</b><br />en tu espacio</span></div>
      <div><strong>{pad(favorites)}</strong><span><b>favoritas</b><br />siempre a mano</span></div>
      <div><strong>{pad(catalog.length)}</strong><span><b>apps disponibles</b><br />en tu organización</span></div>
      <p><ShieldCheck size={15} />Tu espacio. Tu selección.</p>
    </div>
    <div className="flow-controls">
      <div className="flow-tabs" role="group" aria-label="Filtrar mini apps">
        <button aria-pressed={!favoritesOnly} onClick={() => setFavoritesOnly(false)}>Todas <span>{miniApps.length}</span></button>
        <button aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(true)}>Favoritas <span>{favorites}</span></button>
      </div>
      <div className="flow-view-toggle" role="group" aria-label="Vista de mini apps">
        <button aria-pressed={view === 'orbit'} onClick={() => setView('orbit')}><Orbit size={14} />Órbita</button>
        <button aria-pressed={view === 'cards'} onClick={() => setView('cards')}><Grid2X2 size={14} />Tarjetas</button>
      </div>
    </div>
    <div className="flow-filters">
      <label className="flow-search"><Search size={15} /><input aria-label="Buscar en Mi Flow" type="search" value={query}
        onChange={event => setQuery(event.target.value)} placeholder="Busca una mini app…" maxLength={100} /></label>
      <select className="input" aria-label="Colección de mini apps" value={area} onChange={event => setArea(event.target.value)}>
        <option value="">Todas las colecciones</option>
        {categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
      </select>
    </div>
    <section className={`flow-workspace ${selected ? '' : 'flow-no-results'}`} aria-label="Tu Flowverse">
      <div className="flow-orbit-panel">
        <div className="flow-panel-top"><span><i className="flow-dot" />TU FLOWVERSE <b>/ {apps.length} MINI APPS</b></span>
          {view === 'orbit' && selected && <small><Hand size={13} />Arrastra para explorar</small>}</div>
        {!selected ? <div className="flow-empty">
          <Orbit size={40} /><h2>{miniApps.length ? 'No hay mini apps en esta órbita.' : 'Tu Flowverse empieza contigo.'}</h2>
          <p>{miniApps.length ? 'Prueba otro nombre, cambia de colección o vuelve a ver todas tus mini apps.'
            : 'Añade las apps del catálogo de tu organización y crea tu propia órbita de herramientas.'}</p>
          {miniApps.length ? <Button className="flow-btn-dark" onClick={clear}>Ver todas mis mini apps</Button>
            : <Link className="btn flow-btn-dark" href="/catalog">Explorar el catálogo<ArrowRight size={15} /></Link>}
        </div> : view === 'orbit' ? <>
          <div className={`flow-orbit-stage ${dragOffset ? 'flow-dragging' : ''}`} tabIndex={0} role="region"
            aria-roledescription="carrusel" aria-label="Órbita de mini apps. Usa las flechas izquierda y derecha."
            onKeyDown={event => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowRight' ? 1 : -1); }
            }} onPointerDown={startDrag} onPointerMove={event => {
              if (drag.current?.pointerId === event.pointerId) setDragOffset((event.clientX - drag.current.x) * .35);
            }} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; setDragOffset(0); }}>
            <div className="flow-orbit-ring flow-ring-outer" /><div className="flow-orbit-ring" /><div className="flow-orbit-ring flow-ring-inner" />
            <div className="flow-orbit-center"><Orbit size={34} /><h2>Mi Flow</h2><p>Elige. Organiza. Despega.</p>
              <div aria-hidden="true"><i /><i /><i /></div></div>
            {orbit.apps.map((app, index) => {
              const angle = (-35 + (index - (orbit.index - orbit.start)) * 360 / orbit.apps.length + dragOffset) * Math.PI / 180;
              return <button key={app.id} className="flow-orbit-app" aria-pressed={selected.id === app.id}
                aria-label={`${app.title} · ${data.categories.find(category => category.id === app.area)?.label || app.area}`}
                style={{ left: `calc(50% + var(--flow-radius) * ${Math.cos(angle).toFixed(5)})`,
                  top: `calc(50% + var(--flow-radius) * ${Math.sin(angle).toFixed(5)})` }}
                onClick={() => setSelectedId(app.id)}><MiniAppIcon app={app} /><strong>{app.title}</strong>
                <small>{data.categories.find(category => category.id === app.area)?.label || app.area}</small></button>;
            })}
          </div>
          <div className="flow-orbit-caption">
            <button className="icon-button" disabled={apps.length < 2} aria-label="Mini app anterior" onClick={() => step(-1)}><ChevronLeft size={17} /></button>
            <div aria-live="polite" aria-atomic="true"><strong>{selected.title}</strong><span>{pad(orbit.index + 1)} / {pad(apps.length)}</span></div>
            <button className="icon-button" disabled={apps.length < 2} aria-label="Siguiente mini app" onClick={() => step(1)}><ChevronRight size={17} /></button>
          </div>
        </> : <div className="flow-apps-grid">
          {apps.map(app => <article key={app.id} className={`flow-review-card ${selected.id === app.id ? 'flow-selected' : ''}`}>
            <FlowFavoriteButton appId={app.id} />
            <button className="flow-card-select" aria-pressed={selected.id === app.id} onClick={() => setSelectedId(app.id)}>
              <MiniAppIcon app={app} /><h3>{app.title}</h3><p>{app.tagline || app.desc}</p>
              <span className="flow-card-meta">{data.categories.find(category => category.id === app.area)?.label || app.area} · v{app.version}</span>
            </button>
          </article>)}
        </div>}
        <footer className="flow-orbit-footer"><span><i className="flow-dot" />Mini apps del catálogo</span><small>Tu selección. Muchas posibilidades.</small></footer>
      </div>
      {selected && <FlowDetails key={selected.id} app={selected} onDetails={() => setDetail(selected)} />}
    </section>
    {suggestions.length > 0 && <section className="flow-inspiration" aria-labelledby="flow-inspiration-title">
      <div className="flow-section-heading"><h2 id="flow-inspiration-title">Pequeñas apps. Grandes cambios.</h2><p>Descubre más en tu catálogo</p></div>
      <div className="flow-inspiration-grid">{suggestions.map(app => <article key={app.id}>
        <div><MiniAppIcon app={app} /><small>{data.categories.find(category => category.id === app.area)?.label || app.area}</small></div>
        <h3>{app.title}</h3><p>{app.tagline || app.desc}</p><AddToFlowButton appId={app.id} />
      </article>)}</div>
    </section>}
    <section className="flow-intent">
      <div><p className="eyebrow">EMPIEZA POR LO QUE QUIERES CONSEGUIR</p><h2>No busques una app.<br /><span>Encuentra tu siguiente paso.</span></h2></div>
      <div><form onSubmit={event => { event.preventDefault(); router.push(`/catalog?q=${encodeURIComponent(intent.trim())}`); }}>
        <input aria-label="Buscar una necesidad en el catálogo" value={intent} onChange={event => setIntent(event.target.value)}
          placeholder="¿Qué necesitas resolver?" required maxLength={100} />
        <Button type="submit" variant="primary">Buscar mini apps<ArrowRight size={14} /></Button>
      </form><p>Búsqueda en las apps autorizadas de tu organización.</p></div>
    </section>
    <footer className="flow-footer"><span>Tu criterio siempre está en el centro.</span><span>TEKTONIK HUB / MI FLOW</span></footer>
    {detail && <AppDetails app={detail} catalog onClose={() => setDetail(null)} />}
  </div>;
}

function FlowDetails({ app, onDetails }: { app: App; onDetails: () => void }) {
  const { data, repository, action } = useBLK();
  const [busy, setBusy] = useState(false);
  const author = data.users.find(user => user.id === app.authorId);
  const { color, tint } = appTheme(app);
  async function remove() {
    if (busy) return;
    setBusy(true);
    await action(() => repository.removeFromFlow(app.id), 'Mini app retirada de Mi Flow. Sigue disponible en el catálogo.');
    setBusy(false);
  }
  return <article className="flow-details" aria-label="Detalle de la mini app seleccionada">
    <div className="flow-detail-cover" style={{ backgroundColor: tint }}>
      <div className="flow-detail-top"><span style={{ color }}>TU MINI APP / CATÁLOGO</span><FlowFavoriteButton appId={app.id} /></div>
      <div className="flow-detail-title"><MiniAppIcon app={app} /><div><h2>{app.title}</h2>
        <p style={{ color }}>{data.categories.find(category => category.id === app.area)?.label || app.area} · v{app.version}</p></div></div>
      <p>{app.tagline || app.desc}</p>
    </div>
    <div className="flow-detail-body">
      <section><h3>01 / TU HERRAMIENTA</h3><div className="flow-tool-row"><MiniAppIcon app={app} /><div><strong>{app.title}</strong><p>{app.tech.join(' · ') || 'Mini app de tu organización'}</p></div></div><p>{app.desc}</p></section>
      <section><h3>02 / CREADA POR TU EQUIPO</h3><div className="flow-author"><span className="avatar">{author?.initials || 'TH'}</span>
        <div>{author ? <Link href={`/profile?user=${encodeURIComponent(author.id)}`}>{author.name}</Link> : <strong>Autor no disponible</strong>}<p>{author?.dept}</p></div></div></section>
      <section><h3>03 / DISPONIBLE EN TU CATÁLOGO</h3><p className="flow-approved"><ShieldCheck size={14} />Aprobada para tu organización</p>
        <p className="flow-review-note">Revisión manual interna; no es una certificación externa.</p>{app.impact && <p>{app.impact}</p>}</section>
      <div className="flow-detail-actions"><AppAccessButton app={app} /><Button onClick={onDetails}>Detalles de la app</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void remove()}><Trash2 size={14} />{busy ? 'Retirando…' : 'Quitar de Mi Flow'}</Button>
        <p>Tu selección se guarda en tu cuenta. No modifica la app del catálogo.</p></div>
    </div>
  </article>;
}
