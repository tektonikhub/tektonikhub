'use client';

import '@/styles/business.css';
import { useState, type ReactNode, type FormEvent, type InputHTMLAttributes } from 'react';
import Link from 'next/link';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import type { App, Dataset, JSONValue, Policy, ReviewAction, Role, User } from '@/lib/domain/types';
import { studioRoles } from '@/lib/auth/policy';

export const roleLabels: Record<Role, string> = { developer: 'Developer', catalog: 'Empleado', admin: 'Administrador', superadmin: 'Super administrador' };
export const reviewStates = ['pending_review', 'changes_requested', 'rejected', 'approved'] as const;
export function contentText(data: Dataset, path: string, fallback: string): string {
  let value: JSONValue | undefined = data.content;
  for (const key of path.split('.')) value = value && typeof value === 'object' && !Array.isArray(value) ? value[key] : undefined;
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ') : fallback;
}
export function DemoNotice() {
  const { language } = useBLK();
  return <p className="business-notice">{language === 'en' ? 'Accounts and business data are managed in InsForge. Manual reviews do not run a security scanner or issue an external certification. Studio examples and browser drafts remain separate.' : 'Cuentas y datos de negocio gestionados en InsForge. Las revisiones manuales no ejecutan escáneres ni emiten certificaciones externas. Los ejemplos y borradores locales de Studio siguen siendo independientes.'}</p>;
}
export function Field({ label, multiline, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; multiline?: boolean }) {
  if (multiline) return <label className="field">{label}<textarea className="input" name={props.name} defaultValue={props.defaultValue} required={props.required} minLength={props.minLength} maxLength={props.maxLength} rows={4} /></label>;
  return <label className="field">{label}<input className="input" {...props} /></label>;
}
export function SelectField({ label, name, value, children, onChange }: { label: string; name?: string; value?: string; children: ReactNode; onChange?: (value: string) => void }) {
  return <label className="field">{label}<select className="input" name={name} required={Boolean(name)} {...(onChange ? { value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange(event.target.value) } : { defaultValue: value })}>{children}</select></label>;
}
export function Tabs({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return <nav className="business-tabs" aria-label="Secciones">{items.map(item => <Button key={item.id} variant={value === item.id ? 'primary' : 'ghost'} aria-current={value === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>{item.label}</Button>)}</nav>;
}
export function Empty({ children = 'No hay registros para estos filtros.' }: { children?: ReactNode }) { return <div className="empty-state">{children}</div>; }
export function MutationDialog({ title, onClose, children, onSubmit, saveLabel = 'Guardar', danger = false }: { title: string; onClose: () => void; children: ReactNode; onSubmit: (fields: FormData) => Promise<unknown>; saveLabel?: string; danger?: boolean }) {
  const { action } = useBLK();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    let failure = 'No se guardaron los cambios. Revisa la notificación y vuelve a abrir el formulario si la versión cambió.';
    const result = await action(async () => { try { return await onSubmit(fields); } catch (cause) { if (cause instanceof Error) failure = cause.message; throw cause; } }, 'Cambios guardados en InsForge.');
    setBusy(false);
    if (result.ok) onClose(); else setError(failure);
  }
  return <Dialog open title={title} onClose={() => { if (!busy) onClose(); }}><form onSubmit={submit} className="stack" aria-busy={busy}>{children}{error && <p role="alert" className="business-error">{error}</p>}<div className="business-actions"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy}>{busy ? 'Guardando…' : saveLabel}</Button></div></form></Dialog>;
}
export function ConfirmDelete({ title, description, onClose, operation, actionLabel = 'Eliminar' }: { title: string; description?: string; onClose: () => void; operation: () => Promise<unknown>; actionLabel?: string }) {
  return <MutationDialog title={title} onClose={onClose} onSubmit={operation} danger saveLabel={actionLabel}><p>{description || 'Esta acción no se puede deshacer. ¿Quieres eliminar este registro?'}</p></MutationDialog>;
}
export function StatusFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { data } = useBLK();
  return <SelectField label="Estado de revisión" value={value} onChange={onChange}><option value="">Todos los estados</option>{reviewStates.map(status => <option key={status} value={status}>{data.config.statusLabels[status]}</option>)}</SelectField>;
}
export function AppCard({ app, onDetails, children, catalog = false }: { app: App; onDetails: (app: App) => void; children?: ReactNode; catalog?: boolean }) {
  const { data, notify } = useBLK();
  const author = data.users.find(user => user.id === app.authorId);
  const category = data.categories.find(category => category.id === app.area)?.label || app.area;
  const description = catalog && app.version === 1 ? contentText(data, `catalog.appDescriptions.${app.id}`, app.desc) : app.desc;
  return <article className="business-app-card"><div className="business-card-top"><h3>{app.title}</h3><span className="business-chip">{category}</span></div><p>{description}</p><div className="business-author"><span className="business-avatar">{author?.initials || 'TH'}</span><span>{author ? <Link href={`/profile?user=${encodeURIComponent(author.id)}`}>{author.name}</Link> : 'Autor no disponible'}<small>{author?.dept}</small></span></div><div className="business-card-top"><Badge status={app.reviewStatus}>{data.config.statusLabels[app.reviewStatus]}</Badge>{!catalog && <span className="business-meta">{app.ticket} · v{app.version}</span>}</div><div className="business-actions"><Button variant="secondary" onClick={() => onDetails(app)}>{catalog ? 'Detalles' : 'Detalles e historial'}</Button>{catalog && <Button onClick={() => notify(`DEMO: no se ejecuta ni despliega código. ${app.title}`)}>Acceder</Button>}{children}</div></article>;
}
function safeUrl(value: string): string | undefined { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
export function AppDetails({ app: snapshot, onClose, catalog = false }: { app: App; onClose: () => void; catalog?: boolean }) {
  const { data, notify } = useBLK();
  const app = data.apps.find(row => row.id === snapshot.id);
  const organization = data.organizations.find(row => row.id === app?.orgId);
  if (!app || (catalog && (app.reviewStatus !== 'approved' || !organization || ['pending', 'suspended'].includes(organization.status)))) return <Dialog open title="Aplicación no disponible" onClose={onClose}><Empty>Esta aplicación ya no está disponible en el catálogo.</Empty></Dialog>;
  const reviews = data.reviews.filter(review => review.appId === app.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const url = safeUrl(app.repoUrl);
  return <Dialog open title={app.title} onClose={onClose}><div className="stack"><Badge status={app.reviewStatus}>{data.config.statusLabels[app.reviewStatus]}</Badge><p>{catalog && app.version === 1 ? contentText(data, `catalog.appDescriptions.${app.id}`, app.desc) : app.desc}</p>{app.longDesc && <p>{app.longDesc}</p>}<p className="business-meta">{app.ticket} · Versión {app.version} · Actualizada {new Date(app.updatedAt).toLocaleString('es-ES')}</p>{catalog ? <p>Valoración demo: {app.metrics.rating || '—'}</p> : <><dl className="business-detail-grid"><div><dt>Impacto estimado</dt><dd>{app.impact || 'Sin estimación'}</dd></div><div><dt>Tecnología</dt><dd>{app.tech.join(', ') || '—'}</dd></div><div><dt>Nota de datos y riesgos</dt><dd>{app.dataNote || 'Sin nota'}</dd></div><div><dt>Entorno demo</dt><dd>{app.environment || 'No asignado'}</dd></div></dl>{url && <a href={url} target="_blank" rel="noopener noreferrer">Repositorio: {url}</a>}<h3>Adjuntos · solo metadatos</h3>{app.attachments.length ? <ul>{app.attachments.map((file, index) => <li key={`${file.name}-${index}`}>{file.name} · {file.size.toLocaleString()} bytes · {file.type || 'Sin tipo'}</li>)}</ul> : <p>Sin adjuntos.</p>}<h3>Historial de revisión</h3>{reviews.length ? <ol className="business-history">{reviews.map(review => <li key={review.id}><b>{data.config.statusLabels[review.action]} · v{review.version}</b><p>{data.users.find(user => user.id === review.reviewerId)?.name || 'Revisor'} · {new Date(review.createdAt).toLocaleString('es-ES')}</p><p>{review.reason || 'Sin comentarios'}</p>{review.environment && <p>Entorno: {review.environment}</p>}{review.checks && <p>Comprobaciones manuales demo: seguridad {review.checks.security ? 'sí' : 'no'} · datos {review.checks.data ? 'sí' : 'no'}</p>}</li>)}</ol> : <Empty>Sin decisiones registradas.</Empty>}<h3>Actividad local</h3>{data.events.filter(event => event.appId === app.id).length ? <ul className="business-history">{data.events.filter(event => event.appId === app.id).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(event => <li key={event.id}>{event.action} · {data.users.find(user => user.id === event.actorId)?.name || 'Usuario'} · {new Date(event.createdAt).toLocaleString('es-ES')}</li>)}</ul> : <p>Sin eventos registrados.</p>}</>}<DemoNotice /><div className="business-actions"><Button variant="secondary" onClick={onClose}>Cerrar</Button>{catalog && <Button onClick={() => notify(`DEMO: no se ejecuta ni despliega código. ${app.title}`)}>Acceder · demo</Button>}</div></div></Dialog>;
}
export function AppEditor({ app, orgId, onClose }: { app: App | null; orgId: string; onClose: () => void }) {
  const { data, repository } = useBLK();
  const authors = data.users.filter(user => user.orgId === orgId && studioRoles.includes(user.role) && user.enabled !== false && !user.deletedAt);
  return <MutationDialog title={app ? 'Editar aplicación' : 'Nueva aplicación'} onClose={onClose} onSubmit={fields => repository.saveManagedApp(app?.id || null, { orgId, authorId: String(fields.get('authorId')), title: String(fields.get('title')), desc: String(fields.get('desc')), area: String(fields.get('area')), tagline: String(fields.get('tagline')), aiTool: String(fields.get('aiTool')), repoUrl: String(fields.get('repoUrl')), impact: String(fields.get('impact')), dataNote: String(fields.get('dataNote')), hours: Number(fields.get('hours')), users: Number(fields.get('users')) }, app?.version)}>
    <p className="business-notice">Al guardar, vuelve a revisión y deja de publicarse hasta una nueva aprobación. Se conservan ticket, adjuntos e historial.{app && ` Editando v${app.version}.`}</p>
    <div className="form-grid">
      <Field label="Título" name="title" defaultValue={app?.title} required maxLength={60} />
      <Field label="Subtítulo" name="tagline" defaultValue={app?.tagline} maxLength={100} />
      <SelectField label="Área" name="area" value={app?.area || data.categories[0]?.id}>{data.categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</SelectField>
      <SelectField label="Creador" name="authorId" value={app?.authorId || ''}><option value="">Selecciona un creador</option>{authors.map(author => <option key={author.id} value={author.id}>{author.name}</option>)}</SelectField>
      <Field label="Tecnología principal" name="aiTool" defaultValue={app?.tech[0]} maxLength={100} />
      <Field label="Repositorio HTTP/HTTPS" name="repoUrl" type="url" defaultValue={app?.repoUrl} maxLength={1000} />
      <Field label="Horas ahorradas · estimación" name="hours" type="number" min={0} max={2147483647} step={1} required defaultValue={app?.metrics.hours || 0} />
      <Field label="Usuarios · estimación" name="users" type="number" min={0} max={2147483647} step={1} required defaultValue={app?.metrics.users || 0} />
    </div>
    <Field label="Descripción (mínimo 30 caracteres)" name="desc" multiline defaultValue={app?.desc} required minLength={30} maxLength={800} />
    <Field label="Impacto estimado" name="impact" defaultValue={app?.impact} maxLength={500} />
    <Field label="Nota de datos y riesgos" name="dataNote" multiline defaultValue={app?.dataNote} maxLength={2000} />
    {!authors.length && <p role="alert">Añade primero un creador habilitado con acceso a Studio para asignar la aplicación.</p>}
  </MutationDialog>;
}
export function ReviewDialog({ app, decision, onClose }: { app: App; decision: ReviewAction; onClose: () => void }) {
  const { repository, data } = useBLK();
  const [security, setSecurity] = useState(false), [checkedData, setCheckedData] = useState(false);
  const approving = decision === 'approved';
  return <MutationDialog title={`${data.config.statusLabels[decision]} · ${app.title}`} onClose={onClose} saveLabel={approving ? 'Aprobar' : decision === 'rejected' ? 'Rechazar' : 'Solicitar cambios'} danger={decision === 'rejected'} onSubmit={fields => { if (approving && (!security || !checkedData)) throw new Error('Marca las dos comprobaciones manuales obligatorias.'); return repository.reviewApp(app.id, decision, String(fields.get('reason') || ''), String(fields.get('environment') || ''), app.version, { security, data: checkedData }); }}><p>{app.ticket} · Versión {app.version}. La revisión valida estado y versión al guardar.</p><DemoNotice />{approving && <><label className="business-check"><input type="checkbox" required checked={security} onChange={event => setSecurity(event.target.checked)} />He realizado la revisión manual de seguridad (demo, no certificación).</label><label className="business-check"><input type="checkbox" required checked={checkedData} onChange={event => setCheckedData(event.target.checked)} />He revisado manualmente el tratamiento de datos (demo).</label><Field label="Entorno de publicación demo" name="environment" defaultValue="Catálogo DEMO" maxLength={160} /></>}<Field label={approving ? 'Comentario de revisión' : 'Motivo obligatorio'} name="reason" multiline required={!approving} maxLength={2000} /></MutationDialog>;
}
export function ReviewActions({ app, onReview }: { app: App; onReview: (app: App, decision: ReviewAction) => void }) {
  if (app.reviewStatus !== 'pending_review') return null;
  return <><Button onClick={() => onReview(app, 'approved')}>Aprobar</Button><Button variant="danger" onClick={() => onReview(app, 'rejected')}>Rechazar</Button><Button variant="secondary" onClick={() => onReview(app, 'changes_requested')}>Solicitar cambios</Button></>;
}
export function UserEditor({ user, orgId, global = false, allowAllRoles = global, onClose }: { user: User | null; orgId: string; global?: boolean; allowAllRoles?: boolean; onClose: () => void }) {
  const { data, repository } = useBLK();
  const roles: Role[] = allowAllRoles ? ['developer', 'catalog', 'admin', 'superadmin'] : ['developer', 'catalog'];
  return <MutationDialog title={user ? 'Editar usuario' : 'Añadir e invitar usuario'} onClose={onClose} onSubmit={fields => repository.saveUser(user?.id || null, { name: String(fields.get('name')), email: String(fields.get('email')), username: String(fields.get('username')), dept: String(fields.get('dept')), role: String(fields.get('role')) as Role, orgId: global ? String(fields.get('orgId')) : orgId })}>
    <div className="form-grid"><Field label="Nombre" name="name" required maxLength={120} defaultValue={user?.name} /><Field label="Usuario de acceso" name="username" required minLength={3} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}" defaultValue={user?.username} /><Field label="Correo de acceso" name="email" type="email" required maxLength={254} readOnly={Boolean(user)} defaultValue={user?.email} /><Field label="Departamento" name="dept" maxLength={120} defaultValue={user?.dept} /><SelectField label="Permisos" name="role" value={user?.role || 'developer'}>{roles.map(role => <option value={role} key={role}>{roleLabels[role]}</option>)}</SelectField>{global && <SelectField label="Organización" name="orgId" value={user?.orgId || orgId}>{data.organizations.map(org => <option key={org.id} value={org.id}>{org.name}{org.system ? ' · Plataforma' : ''}</option>)}</SelectField>}</div>
    <p>{user ? 'El correo no se cambia desde el perfil: requiere una verificación específica. Los superadministradores pertenecen a la organización de plataforma.' : 'Se creará una cuenta autorizada y se enviará el enlace de verificación. El usuario elegirá su contraseña desde Activar cuenta; no se comparte ninguna contraseña provisional.'}</p>
  </MutationDialog>;
}
export function UsersManager({ orgId, global = false, allowAllRoles = global }: { orgId: string; global?: boolean; allowAllRoles?: boolean }) {
  const { data, repository, action, user: currentUser } = useBLK();
  const [query, setQuery] = useState(''), [role, setRole] = useState('');
  const [editor, setEditor] = useState<{ user: User | null } | null>(null), [deleting, setDeleting] = useState<User | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const users = data.users.filter(user => !user.deletedAt && (global || user.orgId === orgId) && (!role || user.role === role) && `${user.name} ${user.username || ''} ${user.email || ''} ${user.dept} ${data.organizations.find(org => org.id === user.orgId)?.name || ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  async function accountAction(user: User, invite: boolean) {
    if (busyId) return;
    setBusyId(user.id);
    await action(() => invite ? repository.inviteUser(user.id) : repository.setUserEnabled(user.id, user.enabled === false),
      invite ? 'Correo de activación solicitado.' : 'Permisos de acceso actualizados.');
    setBusyId(null);
  }
  return <section className="stack">
    <div className="toolbar"><Field label="Buscar usuarios" type="search" value={query} onChange={event => setQuery(event.target.value)} /><SelectField label="Rol" value={role} onChange={setRole}><option value="">Todos los roles</option>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</SelectField><Button onClick={() => setEditor({ user: null })}>Añadir usuario</Button></div>
    <div className="business-table-wrap"><table className="data-table"><thead><tr><th>Nombre / usuario</th><th>Correo</th><th>Departamento</th><th>Rol</th><th>Acceso</th>{global && <th>Organización</th>}<th>Acciones</th></tr></thead><tbody>{users.map(user => <tr key={user.id}>
      <td><Link href={`/profile?user=${encodeURIComponent(user.id)}`}>{user.name}</Link><small className="business-block">{user.username}</small></td><td>{user.email || '—'}</td><td>{user.dept}</td><td>{roleLabels[user.role]}</td>
      <td>{user.enabled === false ? 'Desactivado' : user.accountStatus === 'active' ? 'Correo verificado' : user.accountStatus === 'failed' ? 'Correo no confirmado' : 'Activación pendiente'}</td>
      {global && <td>{data.organizations.find(org => org.id === user.orgId)?.name}</td>}
      <td>{allowAllRoles || ['developer', 'catalog'].includes(user.role) ? <div className="business-actions">
        <Button variant="secondary" onClick={() => setEditor({ user })}>Editar</Button>
        <Button variant="secondary" disabled={Boolean(busyId) || user.enabled === false} onClick={() => void accountAction(user, true)}>Enviar activación</Button>
        <Button variant="secondary" disabled={Boolean(busyId) || user.id === currentUser?.id} onClick={() => void accountAction(user, false)}>{user.enabled === false ? 'Habilitar' : 'Desactivar acceso'}</Button>
        <Button variant="danger" disabled={user.id === currentUser?.id} onClick={() => setDeleting(user)}>Eliminar</Button>
      </div> : <span className="business-meta">Solo Super Admin puede administrar este rol</span>}</td>
    </tr>)}</tbody></table></div>
    {!users.length && <Empty />}{editor && <UserEditor user={editor.user} orgId={orgId} global={global} allowAllRoles={allowAllRoles} onClose={() => setEditor(null)} />}
    {deleting && <ConfirmDelete title={`Eliminar usuario · ${deleting.name}`} description="Se revoca el acceso y se archiva la cuenta; el historial se conserva. El administrador de una empresa necesita un sustituto antes de eliminarse." onClose={() => setDeleting(null)} operation={() => repository.deleteUser(deleting.id)} />}
  </section>;
}
export function PoliciesManager({ global = false }: { global?: boolean }) {
  const { data, org, repository } = useBLK();
  const [query, setQuery] = useState(''), [editor, setEditor] = useState<{ policy: Policy | null } | null>(null), [deleting, setDeleting] = useState<Policy | null>(null);
  const policies = data.policies.filter(policy => (global ? !policy.orgId : !policy.orgId || policy.orgId === org?.id) && `${policy.name} ${policy.description}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  return <section className="stack"><p className="business-notice">Políticas informativas locales: no ejecutan controles ni escaneos. {!global && 'Las políticas globales son de solo lectura.'}</p><div className="toolbar"><Field label="Buscar políticas" type="search" value={query} onChange={event => setQuery(event.target.value)} /><Button onClick={() => setEditor({ policy: null })}>Nueva política{global ? ' global' : ' de organización'}</Button></div><div className="app-grid">{policies.map(policy => <article className="business-app-card" key={policy.id}><h3>{policy.name}</h3><span className="business-chip">{policy.orgId ? `Organización · v${policy.version || 1}` : 'Global' + (!global ? ' · solo lectura' : '')}</span><p>{policy.description || 'Sin descripción'}</p><Badge status={policy.enabled ? 'approved' : 'pending_review'}>{policy.enabled ? 'Habilitada' : 'Deshabilitada'}</Badge>{(global || policy.orgId === org?.id) && <div className="business-actions"><Button variant="secondary" onClick={() => setEditor({ policy })}>Editar</Button><Button variant="danger" onClick={() => setDeleting(policy)}>Eliminar</Button></div>}</article>)}</div>{!policies.length && <Empty />}{editor && <MutationDialog title={editor.policy ? 'Editar política' : 'Nueva política'} onClose={() => setEditor(null)} onSubmit={fields => { const values = { name: String(fields.get('name')), description: String(fields.get('description')), enabled: fields.has('enabled') }; return global ? repository.savePolicy(editor.policy?.id || null, values) : repository.saveGovernancePolicy(editor.policy?.id || null, values, editor.policy?.version); }}><Field label="Nombre" name="name" required maxLength={120} defaultValue={editor.policy?.name} /><Field label="Descripción" multiline name="description" maxLength={3000} defaultValue={editor.policy?.description} /><label className="business-check"><input type="checkbox" name="enabled" defaultChecked={editor.policy?.enabled ?? true} />Habilitada (informativa)</label></MutationDialog>}{deleting && <ConfirmDelete title={`Eliminar política · ${deleting.name}`} onClose={() => setDeleting(null)} operation={() => global ? repository.deletePolicy(deleting.id) : repository.deleteGovernancePolicy(deleting.id, deleting.version || 1)} />}</section>;
}
export function AppsManager({ orgId, queue = false }: { orgId: string; queue?: boolean }) {
  const { data, repository } = useBLK();
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [area, setArea] = useState('');
  const [details, setDetails] = useState<App | null>(null), [editor, setEditor] = useState<{ app: App | null } | null>(null), [deleting, setDeleting] = useState<App | null>(null), [review, setReview] = useState<{ app: App; decision: ReviewAction } | null>(null);
  const apps = data.apps.filter(app => app.orgId === orgId && (queue ? app.reviewStatus === 'pending_review' : !status || app.reviewStatus === status) && (!area || app.area === area) && `${app.title} ${app.desc} ${app.ticket} ${data.users.find(user => user.id === app.authorId)?.name || ''}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')));
  return <section className="stack"><div className="toolbar"><Field label="Buscar aplicaciones" type="search" value={query} onChange={event => setQuery(event.target.value)} />{!queue && <StatusFilter value={status} onChange={setStatus} />}<SelectField label="Área" value={area} onChange={setArea}><option value="">Todas las áreas</option>{data.categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</SelectField>{!queue && <Button onClick={() => setEditor({ app: null })}>Nueva aplicación</Button>}</div><p className="business-meta" role="status">{apps.length} aplicaciones{queue ? ' pendientes de revisión' : ''}</p><div className="app-grid">{apps.map(app => <AppCard key={app.id} app={app} onDetails={setDetails}><Button variant="secondary" onClick={() => setEditor({ app })}>Editar</Button><Button variant="danger" onClick={() => setDeleting(app)}>Eliminar</Button><ReviewActions app={app} onReview={(app, decision) => setReview({ app, decision })} /></AppCard>)}</div>{!apps.length && <Empty>{queue ? 'La cola está al día. No hay aplicaciones pendientes.' : 'No hay aplicaciones para estos filtros.'}</Empty>}{details && <AppDetails app={details} onClose={() => setDetails(null)} />}{editor && <AppEditor app={editor.app} orgId={orgId} onClose={() => setEditor(null)} />}{deleting && <ConfirmDelete title={`Eliminar aplicación · ${deleting.title}`} description={`Se eliminarán la aplicación, revisiones y eventos vinculados. Desaparecerá del catálogo. Versión ${deleting.version}. Esta acción no se puede deshacer.`} operation={() => repository.deleteManagedApp(deleting.id, deleting.version)} onClose={() => setDeleting(null)} />}{review && <ReviewDialog {...review} onClose={() => setReview(null)} />}</section>;
}
