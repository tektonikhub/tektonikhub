'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/page-heading';
import type { App } from '@/lib/domain/types';
import { studioRoles } from '@/lib/auth/policy';
import { AppCard, AppDetails, contentText, Empty, roleLabels, StatusFilter, submissionEditHref, Tabs } from './shared';
import { ProfileAudit, ProfileResources } from './profile-resources';

export function ProfileScreen() {
  const { data, user, org, language, notify } = useBLK();
  const params = useSearchParams();
  const [tab, setTab] = useState('tools'), [status, setStatus] = useState(''), [detail, setDetail] = useState<App | null>(null);
  const author = params.has('user') ? data.users.find(row => row.id === params.get('user') && row.orgId === org?.id) : user;
  const en = language === 'en';
  if (!author) return <Empty>{en ? 'This profile does not exist in your organization.' : 'Este perfil no existe en tu organización.'}<Link href="/profile">Mi perfil</Link></Empty>;
  const own = author.id === user?.id;
  const canCreate = Boolean(user && studioRoles.includes(user.role));
  const authored = data.apps.filter(app => app.orgId === org?.id && app.authorId === author.id);
  const published = authored.filter(app => app.reviewStatus === 'approved' && org && !['pending', 'suspended'].includes(org.status));
  async function copyProfile() { try { await navigator.clipboard.writeText(new URL(`/profile?user=${encodeURIComponent(author!.id)}`, location.origin).href); notify(en ? 'Profile link copied.' : 'Enlace del perfil copiado.'); } catch { notify(en ? 'Could not copy. Use the link in your address bar.' : 'No se pudo copiar. Usa el enlace de la barra de direcciones.', 'error'); } }
  return <div className="stack"><section className="business-cover"><span className="business-label">{org?.name} · {en ? 'Creator profile' : 'Perfil del creador'}</span><div className="business-profile-heading"><div className="business-avatar business-avatar-large">{author.initials}</div><div><h1>{author.name}</h1><p>{author.dept} · {roleLabels[author.role]}</p><p>{author.email}</p></div></div><p>{author.name} · {author.dept}</p><div className="business-actions"><Button variant="secondary" onClick={copyProfile}>{en ? 'Copy profile link' : 'Copiar enlace del perfil'}</Button><Link className="btn" href="/company">{en ? 'Company profile' : 'Perfil de empresa'}</Link>{own && canCreate && <Link className="btn btn-primary" href="/studio">{en ? 'Create an app' : 'Crear aplicación'}</Link>}</div></section><div className="business-stats"><div className="business-stat"><strong>{published.length}</strong><span>{en ? 'Published tools' : 'Herramientas publicadas'}</span></div>{own && <div className="business-stat"><strong>{authored.length}</strong><span>{en ? 'Submissions · all statuses' : 'Envíos · todos los estados'}</span></div>}</div><Tabs value={tab} onChange={setTab} items={[{ id: 'tools', label: en ? 'My tools' : 'Mis herramientas' }, ...(own ? [{ id: 'submissions', label: en ? 'My submissions' : 'Mis envíos' }] : []), { id: 'resources', label: en ? 'Prompts & Rulesets' : 'Prompts & Rulesets' }, { id: 'audit', label: en ? 'IT reviews' : 'Revisiones IT' }]} />{tab === 'submissions' && own ? <section className="stack"><PageHeading title={en ? 'My submissions' : 'Mis envíos'} description={en ? 'Follow every ticket, version, review decision and correction.' : 'Sigue cada ticket, versión, decisión de revisión y corrección.'} /><StatusFilter value={status} onChange={setStatus} /><div className="app-grid">{authored.filter(app => !status || app.reviewStatus === status).map(app => { const latest = data.reviews.filter(review => review.appId === app.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; return <AppCard app={app} key={app.id} onDetails={setDetail}>{latest?.reason && <p className="business-review-reason"><b>{en ? 'Latest reason: ' : 'Último motivo: '}</b>{latest.reason}</p>}{app.reviewStatus === 'changes_requested' && canCreate && <Link className="btn" href={submissionEditHref(app)}>{en ? 'Correct and resubmit' : 'Corregir y reenviar'}</Link>}</AppCard>; })}</div>{!authored.some(app => !status || app.reviewStatus === status) && <Empty>{en ? 'No submissions for these filters.' : 'No hay envíos para estos filtros.'}</Empty>}</section> : tab === 'resources' ? <ProfileResources /> : tab === 'audit' ? <ProfileAudit authorId={author.id} /> : <section className="stack"><PageHeading title={en ? 'Published tools' : 'Herramientas publicadas'} description={contentText(data, `profile.I18N.${language}.toolsSubtitle`, en ? 'Approved apps by this creator.' : 'Aplicaciones aprobadas de este creador.')} /><div className="app-grid">{published.map(app => <AppCard app={app} key={app.id} catalog onDetails={setDetail} />)}</div>{!published.length && <Empty>{en ? 'No published tools yet.' : 'Todavía no hay herramientas publicadas.'}</Empty>}</section>}{detail && <AppDetails app={detail} catalog={tab === 'tools'} onClose={() => setDetail(null)} />}</div>;
}
