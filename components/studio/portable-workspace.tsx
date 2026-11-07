'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Download, FileCode2, FileJson, RotateCcw, UploadCloud, X } from 'lucide-react';
import { z } from 'zod';
import { useBLK } from '@/hooks/use-blk';
import { Button } from '@/components/ui/button';
import { RemoteBLKRepository } from '@/lib/data/remote-repository';
import type { SubmissionFields } from '@/lib/domain/types';
import { validatePortableFiles, portableHTML, type PortableFile } from '@/lib/studio/portable';
import { loadPortableBundle, submitPortableBundle } from '@/lib/studio/portable-client';
import { isPortableApp } from '@/components/features/shared';

const MAX_FILES = 10, MAX_JSON_BYTES = 5 * 1024 * 1024, MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const errorText = (cause: unknown) => {
  if (cause instanceof z.ZodError) return 'El conjunto de ficheros no es válido: un HTML no vacío de hasta 300.000 caracteres, JSON válidos de hasta 5 MiB y un total de 25 MiB. Usa nombres únicos de hasta 120 caracteres, con letras sin acentos, números, espacios, puntos, guiones o guiones bajos, sin rutas.';
  return cause instanceof Error ? cause.message : 'No se pudo completar la operación.';
};
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function PortableWorkspace() {
  const params = useSearchParams();
  const edit = params.get('edit'), review = params.get('review');
  const invalid = Boolean((params.has('edit') && !edit) || (params.has('review') && !review) || (edit && review));
  return <PortableEditor key={`${edit || ''}:${review || ''}`} appId={edit || review || ''} review={Boolean(review)} invalid={invalid} />;
}

function PortableEditor({ appId, review, invalid }: { appId: string; review: boolean; invalid: boolean }) {
  const { data, user, repository, notify } = useBLK();
  const app = data.apps.find(row => row.id === appId);
  const reviewer = user?.role === 'admin' || user?.role === 'superadmin';
  const accessible = !invalid && Boolean(user) && (!appId || Boolean(app && isPortableApp(app) && (review ? reviewer : app.authorId === user?.id && app.reviewStatus === 'changes_requested')));
  const [files, setFiles] = useState<PortableFile[]>([]);
  const [fields, setFields] = useState<SubmissionFields>({ title: '', desc: '', area: '', dataNote: 'Aplicación HTML / JSON portable. Datos locales; importación y exportación JSON sin conexión. Sin acceso al hub ni a datos corporativos.' });
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(Boolean(appId)), [error, setError] = useState('');
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null), [savedId, setSavedId] = useState(''), [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<'preview' | 'code'>('preview'), [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [selected, setSelected] = useState(''), [revision, setRevision] = useState(0), [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null), inFlight = useRef(false), loaded = useRef('');
  const readOnly = review || Boolean(savedId);
  const versionChanged = Boolean(!savedId && appId && loadedVersion !== null && app?.version !== loadedVersion);
  const ready = !loading && accessible && (!appId || loadedVersion !== null) && !versionChanged;

  useEffect(() => {
    if (!appId || !app || !accessible || loaded.current === `${appId}:${retry}`) return;
    let active = true;
    const expectedVersion = app.version;
    const load = async () => {
      setLoading(true); setError('');
      try {
        const validated = await loadPortableBundle(app.id, expectedVersion);
        if (!active) return;
        setFiles(validated); setSelected(validated.find(file => file.type === 'text/html')?.name || '');
        setFields({ title: app.title, desc: app.desc, area: app.area, tagline: app.tagline, impact: app.impact, dataNote: app.dataNote, repoUrl: app.repoUrl });
        setLoadedVersion(expectedVersion); loaded.current = `${appId}:${retry}`; setRevision(value => value + 1);
      } catch (cause) { if (active) setError(errorText(cause)); }
      finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [appId, app, accessible, retry]);

  const source = useMemo(() => {
    if (!files.some(file => file.type === 'text/html')) return '';
    try { return portableHTML(files); } catch { return ''; }
  }, [files]);
  const codeFile = files.find(file => file.name === selected) || files.find(file => file.type === 'text/html') || files[0];
  const totalBytes = files.reduce((sum, file) => sum + new Blob([file.content]).size, 0);

  async function addFiles(incoming: FileList | File[]) {
    if (readOnly || !ready || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const additions = Array.from(incoming);
      if (!additions.length) return;
      if (files.length + additions.length > MAX_FILES) throw new Error('Máximo 10 ficheros: un HTML y hasta nueve JSON.');
      if (totalBytes + additions.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('El conjunto no puede superar 25 MiB.');
      const names = new Set(files.map(file => file.name.toLocaleLowerCase()));
      for (const file of additions) {
        if (!/\.(html|json)$/i.test(file.name)) throw new Error('Solo se admiten ficheros .html y .json.');
        if (file.name.length > 120 || !/^[a-z0-9][a-z0-9._ -]*\.(html|json)$/i.test(file.name) || file.name.includes('..')) throw new Error('Usa un nombre de hasta 120 caracteres que empiece por una letra sin acentos o un número, sin rutas ni dobles puntos.');
        if (names.has(file.name.toLocaleLowerCase())) throw new Error(`El fichero ${file.name} ya existe. Quítalo antes de reemplazarlo.`);
        names.add(file.name.toLocaleLowerCase());
        if (/\.json$/i.test(file.name) && file.size > MAX_JSON_BYTES) throw new Error(`El JSON ${file.name} supera 5 MiB.`);
        if (/\.html$/i.test(file.name) && file.size > 1200000) throw new Error('El HTML supera el límite de 300.000 caracteres.');
      }
      const read = await Promise.all(additions.map(async (file): Promise<PortableFile> => {
        const content = await file.text(), type = /\.html$/i.test(file.name) ? 'text/html' : 'application/json';
        if (type === 'application/json') { try { JSON.parse(content); } catch { throw new Error(`El fichero ${file.name} no contiene JSON válido.`); } }
        return { name: file.name, content, type };
      }));
      const candidate = [...files, ...read];
      if (candidate.filter(file => file.type === 'text/html').length > 1) throw new Error('Solo se admite un fichero .html. Quítalo antes de reemplazarlo.');
      const validated = candidate.some(file => file.type === 'text/html') ? validatePortableFiles(candidate) : candidate;
      setFiles(validated); setSelected(validated.find(file => file.type === 'text/html')?.name || validated[0]?.name || ''); setRevision(value => value + 1);
    } catch (cause) { setError(errorText(cause)); }
    finally { inFlight.current = false; setBusy(false); if (input.current) input.current.value = ''; }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || !ready || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const validated = validatePortableFiles(files);
      const editing = appId && app && loadedVersion !== null ? { id: app.id, version: loadedVersion } : undefined;
      const result = await submitPortableBundle(validated, { ...fields, area: fields.area || data.categories[0]?.id || '' }, editing);
      setSavedId(result.id); notify('Aplicación enviada a revisión IT. No está publicada.');
      try { if (repository instanceof RemoteBLKRepository) await repository.refresh(); }
      catch { notify('El envío está guardado. Recarga el perfil para actualizar su estado.', 'info'); }
    } catch (cause) { setError(errorText(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function download(file: PortableFile) {
    const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!accessible && !savedId) return <section className="portable-next empty-state" role="alert"><h1>Aplicación no disponible</h1><p>{review ? 'Solo los administradores autorizados pueden revisar estos ficheros.' : 'Solo puedes corregir tus propios envíos portables con cambios solicitados.'}</p><Link href="/profile">Volver a mi perfil</Link></section>;
  return <div className="portable-next" data-testid="portable-workspace">
    <header className="portable-heading"><div><Link href="/studio">← Volver a Studio</Link><h1>{review ? 'Revisar aplicación portable' : appId ? 'Corregir aplicación portable' : 'Añadir ficheros'}</h1><p>Un HTML, JSON opcionales y una vista previa aislada antes de enviar a IT.</p></div><Link className="btn" href={review ? user?.role === 'superadmin' ? '/super-admin' : '/admin' : '/profile'}>{review ? 'Volver a revisión IT' : 'Mis envíos'}</Link></header>
    <aside className="portable-notice"><strong>HTML / JSON portable · sin conexión</strong><p>El HTML se ejecuta aislado, sin red ni acceso al hub. Los JSON adjuntos son datos iniciales locales; no se envían a la nube al usar la aplicación. Para guardar cambios del runtime, exporta un JSON y vuelve a importarlo. Reiniciar la vista previa restaura los ficheros originales; no guarda cambios.</p><p>Compatibilidad: el HTML debe ser autocontenido (sin CDN, scripts, estilos o imágenes remotos). La importación/exportación JSON debe usar la API portable documentada en la ayuda inferior; no se modifica automáticamente cualquier aplicación externa.</p></aside>
    {error && <div className="portable-error" role="alert">{error}{appId && !loadedVersion && <Button onClick={() => setRetry(value => value + 1)} disabled={loading}>Reintentar carga</Button>}</div>}
    {loading && <p role="status">Cargando versión autorizada…</p>}
    {review && app && <section className="portable-notice" aria-label="Datos del ticket"><h2>{app.title} · {app.ticket} · v{app.version}</h2><p>{app.desc}</p><p><strong>Categoría:</strong> {data.categories.find(category => category.id === app.area)?.label || app.area}</p><p><strong>Datos y riesgos:</strong> {app.dataNote || 'Sin nota de datos'}</p><p><strong>Impacto:</strong> {app.impact || 'Sin estimación'}</p>    <p>Solo lectura. Registra la decisión desde la sección de revisión IT.</p></section>}
    {versionChanged && <p className="portable-error" role="alert">La versión del ticket ha cambiado. Revisa la versión actual antes de enviar.<Button onClick={() => setRetry(value => value + 1)}>Cargar versión actual (descarta cambios locales)</Button></p>}
    {savedId && <div className="portable-success" role="status"><strong>Enviado a revisión IT</strong><p>Se han guardado los ficheros y el ticket. La aplicación no se publica hasta su aprobación.</p><Link className="btn btn-primary" href="/profile">Ver estado en mi perfil</Link></div>}
    <div className="portable-grid">
      <section className="portable-files panel" aria-labelledby="portable-files-title"><h2 id="portable-files-title">Ficheros de la aplicación</h2>
        {!readOnly && <div className={`portable-dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy && ready) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) void addFiles(event.dataTransfer.files); }}>
          <UploadCloud size={36} aria-hidden="true" /><strong>Arrastra tu HTML y los JSON aquí</strong><p>Un .html obligatorio + hasta nueve .json opcionales.</p><Button onClick={() => input.current?.click()} disabled={busy || !ready}>Seleccionar ficheros</Button><input ref={input} type="file" accept=".html,.json,text/html,application/json" multiple hidden aria-label="Seleccionar HTML y JSON" onChange={event => { if (event.target.files) void addFiles(event.target.files); }} /><small>HTML: 300.000 caracteres · JSON: 5 MiB por fichero · total: 25 MiB</small>
        </div>}
        <ul className="portable-file-list" aria-label="Ficheros cargados">{files.map(file => <li key={file.name}>{file.type === 'text/html' ? <FileCode2 aria-hidden="true" size={22} /> : <FileJson aria-hidden="true" size={22} />}<button type="button" className="portable-file-name" onClick={() => { setSelected(file.name); setTab('code'); }}><strong>{file.name}</strong><small>{file.type === 'text/html' ? 'HTML principal' : 'Datos JSON'} · {sizeLabel(new Blob([file.content]).size)}</small></button><Button variant="ghost" aria-label={`Descargar ${file.name}`} onClick={() => download(file)}><Download size={16} aria-hidden="true" /></Button>{!readOnly && <Button variant="ghost" aria-label={`Quitar ${file.name}`} disabled={busy || !ready} onClick={() => { setFiles(current => current.filter(item => item.name !== file.name)); setError(''); setRevision(value => value + 1); }}><X size={16} aria-hidden="true" /></Button>}</li>)}</ul>
        {!files.length && <p className="portable-muted">Todavía no hay ficheros.</p>}<p className="portable-muted">{files.length} / 10 ficheros · {sizeLabel(totalBytes)}. Se lee su contenido en este navegador; solo se sube al enviar a IT.</p>
        <details className="portable-help"><summary>Compatibilidad e importación/exportación JSON</summary><p>El HTML puede listar los JSON con <code>window.TektonikFiles.list()</code>, leerlos con <code>window.TektonikFiles.read(nombre)</code> o <code>{"fetch('./datos.json')"}</code>, y descargarlos con <code>window.TektonikFiles.exportJSON(nombre, datos)</code>. Para importar nuevos datos durante la ejecución, utiliza un selector de fichero HTML y <code>FileReader</code> o <code>File.text()</code>, seguido de <code>JSON.parse</code>. El HTML debe implementar cómo aplicar esos datos a su interfaz.</p><p>Los cambios ejecutados en la vista previa son locales y efímeros. Importar JSON no modifica el ticket ni el hub. Para corregir un envío, reemplaza aquí sus ficheros y vuelve a enviar a IT.</p></details>
      </section>
      <section className="portable-preview panel" aria-label="Vista previa de la aplicación"><header className="portable-preview-toolbar"><div className="portable-view-tabs" aria-label="Vista de aplicación"><Button aria-pressed={tab === 'preview'} onClick={() => setTab('preview')}>Vista previa</Button><Button aria-pressed={tab === 'code'} onClick={() => setTab('code')}>Código</Button></div><div className="portable-preview-actions"><Button aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}>Escritorio</Button><Button aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}>Móvil</Button><Button aria-label="Reiniciar vista previa" title="Descartar cambios de ejecución y reiniciar" disabled={!source} onClick={() => setRevision(value => value + 1)}><RotateCcw size={16} aria-hidden="true" /></Button></div></header>
        {tab === 'preview' ? <div className={`portable-preview-stage ${viewport === 'mobile' ? 'portable-phone' : ''}`}>{source ? <iframe key={revision} title="Vista previa HTML / JSON aislada" sandbox="allow-scripts allow-downloads" srcDoc={source} referrerPolicy="no-referrer" /> : <div className="portable-empty">Añade un HTML válido para ver tu aplicación. Los JSON por sí solos no se ejecutan.</div>}</div> : <div className="portable-code"><label className="field">Fichero<select className="input" value={codeFile?.name || ''} onChange={event => setSelected(event.target.value)}>{!files.length && <option value="">Sin ficheros</option>}{files.map(file => <option key={file.name} value={file.name}>{file.name}</option>)}</select></label><pre tabIndex={0} aria-label="Código del fichero"><code>{codeFile?.content || 'El contenido aparecerá al añadir ficheros.'}</code></pre></div>}
        <footer className="portable-preview-footer">Sandbox sin acceso al origen del hub · cambios locales no guardados</footer>
      </section>
    </div>
    {!review && <section className="portable-submission panel" aria-labelledby="portable-submit-title"><h2 id="portable-submit-title">{appId ? `Reenviar ticket ${app?.ticket || ''} · v${loadedVersion || ''}` : 'Enviar aplicación a revisión IT'}</h2><p>La revisión usa tu identidad verificada: {user?.name}. IT revisará seguridad y datos antes de publicar.</p><form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy || readOnly || !ready}><div className="portable-form-grid">
      <label className="field">Título<input className="input" required maxLength={60} value={fields.title} onChange={event => setFields({ ...fields, title: event.target.value })} /></label>
      <label className="field">Categoría<select className="input" required value={fields.area || data.categories[0]?.id || ''} onChange={event => setFields({ ...fields, area: event.target.value })}>{!data.categories.length && <option value="">Sin categorías disponibles</option>}{data.categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
      <label className="field portable-form-wide">Descripción (mínimo 30 caracteres)<textarea className="input" required minLength={30} maxLength={800} rows={4} value={fields.desc} onChange={event => setFields({ ...fields, desc: event.target.value })} /></label>
      <label className="field">Resumen (opcional)<input className="input" maxLength={100} value={fields.tagline || ''} onChange={event => setFields({ ...fields, tagline: event.target.value })} /></label>
      <label className="field">Impacto estimado (opcional)<input className="input" maxLength={500} value={fields.impact || ''} onChange={event => setFields({ ...fields, impact: event.target.value })} /></label>
      <label className="field portable-form-wide">Datos utilizados y riesgos<textarea className="input" required maxLength={2000} rows={3} value={fields.dataNote || ''} onChange={event => setFields({ ...fields, dataNote: event.target.value })} /></label>
      <label className="field portable-form-wide">Repositorio HTTP/HTTPS (opcional)<input className="input" type="url" maxLength={1000} value={fields.repoUrl || ''} onChange={event => setFields({ ...fields, repoUrl: event.target.value })} /></label>
    </div><p>No incluyas credenciales ni información confidencial sin autorización. El envío guarda el HTML y todos los JSON adjuntos como una versión del ticket.</p><Button type="submit" variant="primary" disabled={!source || !data.categories.length}>{busy ? 'Enviando…' : appId ? 'Enviar cambios a IT' : 'Enviar a IT'}</Button></fieldset></form></section>}
  </div>;
}
