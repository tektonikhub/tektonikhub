'use client';

import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { contentText, Empty } from './shared';

export function ProfileResources() {
  const { data, language, notify } = useBLK();
  const en = language === 'en';
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); notify(en ? 'Example copied.' : 'Ejemplo copiado.'); } catch { notify(en ? 'Could not copy. Select the example manually.' : 'No se pudo copiar. Selecciona el ejemplo manualmente.', 'error'); } }
  return <section className="stack"><h2>{en ? 'Corporate prompts & rulesets · examples' : 'Prompts corporativos & Rulesets · ejemplos'}</h2><p className="business-notice">{en ? 'Informative fixtures, not certified prompts or installed controls. Copying does not run a command or install a scanner. Do not paste sensitive information into external services.' : 'Fixtures informativos, no prompts certificados ni controles instalados. Copiar no ejecuta comandos ni instala escáneres. No pegues información sensible en servicios externos.'}</p><div className="app-grid">{[1, 2, 3, 4].map(index => { const text = contentText(data, `profile.commands.command${index}`, ''); return <article className="business-app-card" key={index}><h3>{contentText(data, `profile.blocks.panel-assets.b${index}`, `Ejemplo ${index}`)}</h3><span className="business-chip">DEMO · {contentText(data, `profile.blocks.panel-assets.tt-pill${index}`, 'Ejemplo')}</span><p>{contentText(data, `profile.I18N.${language}.a${index}Desc`, 'Ejemplo informativo.')}</p><label className="field">{en ? 'Example text' : 'Texto de ejemplo'}<textarea className="input business-code" readOnly rows={5} value={text} /></label><Button variant="secondary" onClick={() => copy(text)} disabled={!text}>{en ? 'Copy example' : 'Copiar ejemplo'}</Button></article>; })}</div></section>;
}
export function ProfileAudit({ authorId }: { authorId: string }) {
  const { data, org, language } = useBLK();
  const en = language === 'en';
  const authored = new Set(data.apps.filter(app => app.orgId === org?.id && app.authorId === authorId).map(app => app.id));
  const reviews = data.reviews.filter(review => authored.has(review.appId)).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <section className="stack"><h2>{en ? 'IT review history' : 'Historial de revisiones IT'}</h2><p className="business-notice">{en ? 'Local demo records, not an immutable audit or a real CISO certificate.' : 'Registros locales de demostración, no auditoría inmutable ni certificado CISO real.'}</p><div className="business-table-wrap"><table className="data-table"><thead><tr><th>Aplicación</th><th>Versión</th><th>Revisor</th><th>Fecha</th><th>Motivo</th><th>Decisión demo</th></tr></thead><tbody>{reviews.map(review => <tr key={review.id}><td>{data.apps.find(app => app.id === review.appId)?.title}</td><td>v{review.version}</td><td>{data.users.find(user => user.id === review.reviewerId)?.name || 'Revisor'}</td><td>{new Date(review.createdAt).toLocaleString(en ? 'en-US' : 'es-ES')}</td><td>{review.reason || '—'}</td><td><Badge status={review.action}>{data.config.statusLabels[review.action]}</Badge></td></tr>)}</tbody></table></div>{!reviews.length && <Empty>{en ? 'No review decisions recorded.' : 'Sin decisiones de revisión registradas.'}</Empty>}</section>;
}
