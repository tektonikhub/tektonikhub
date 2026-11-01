'use strict';
// PostgreSQL embebido; no conecta ni modifica una base de datos externa.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleRoot = process.argv[2];
if (!moduleRoot) throw new Error('Uso: node database\\validate-schema.cjs <directorio con node_modules de @electric-sql/pglite>');
const { PGlite } = require(require.resolve('@electric-sql/pglite', { paths: [path.resolve(moduleRoot)] }));
const ids = {
  plan: '10000000-0000-4000-8000-000000000001',
  org: '20000000-0000-4000-8000-000000000001',
  org2: '20000000-0000-4000-8000-000000000002',
  admin: '30000000-0000-4000-8000-000000000001',
  dev: '30000000-0000-4000-8000-000000000002',
  admin2: '30000000-0000-4000-8000-000000000003',
  super: '30000000-0000-4000-8000-000000000004',
  app: '40000000-0000-4000-8000-000000000001',
  file: '50000000-0000-4000-8000-000000000001',
  project: '60000000-0000-4000-8000-000000000001'
};
(async () => {
  const db = new PGlite();
  let passed = 0;
  const test = async (name, fn) => { await fn(); passed++; console.log(`OK ${name}`); };
  const rejects = async (sql, pattern) => {
    await db.exec('BEGIN');
    try {
      await assert.rejects(async () => { await db.exec(sql); await db.exec('SET CONSTRAINTS ALL IMMEDIATE'); }, pattern);
    } finally { await db.exec('ROLLBACK'); }
  };
  const value = async sql => (await db.query(sql)).rows[0];
  try {
    await test('DDL completo se ejecuta en PostgreSQL', () => db.exec(fs.readFileSync(path.join(__dirname, '001_initial_schema.sql'), 'utf8')));
    await test('25 tablas con RLS activado', async () => {
      const r = await value("SELECT count(*)::int AS n, count(*) FILTER (WHERE relrowsecurity)::int AS secured FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'");
      assert.equal(r.n,25); assert.equal(r.secured,25);
    });
    await test('alta transaccional de organización y administrador circular', () => db.exec(`
      BEGIN;
      INSERT INTO public.plans(id,name,price) VALUES ('${ids.plan}','Starter de prueba',0);
      INSERT INTO public.organizations(id,name,plan_id,admin_id) VALUES
        ('${ids.org}','Empresa de prueba','${ids.plan}','${ids.admin}'),
        ('${ids.org2}','Otra empresa','${ids.plan}','${ids.admin2}');
      INSERT INTO public.users(id,org_id,name,email,role) VALUES
        ('${ids.admin}','${ids.org}','Admin','admin@example.test','admin'),
        ('${ids.dev}','${ids.org}','Developer','dev@example.test','developer'),
        ('${ids.admin2}','${ids.org2}','Otro admin','admin2@example.test','admin'),
        ('${ids.super}','${ids.org2}','Superadmin','super@example.test','superadmin');
      INSERT INTO public.categories(id,label) VALUES ('finanzas','Finanzas');
      COMMIT;`));
    await test('email único sin distinguir mayúsculas', () => rejects(`INSERT INTO public.users(org_id,name,email,role) VALUES ('${ids.org}','Duplicado','ADMIN@example.test','catalog')`, /duplicate key/i));
    await test('no degradar al administrador principal', () => rejects(`UPDATE public.users SET role='developer' WHERE id='${ids.admin}'`, /administrador activo/i));
    await test('no eliminar plan asignado', () => rejects(`DELETE FROM public.plans WHERE id='${ids.plan}'`, /foreign key/i));
    await test('app y versión se crean juntas', () => db.exec(`BEGIN;
      INSERT INTO public.apps(id,org_id,author_id,ticket) VALUES ('${ids.app}','${ids.org}','${ids.dev}','TEST-001');
      INSERT INTO public.app_versions(app_id,version,org_id,category_id,title,description,created_by)
        VALUES ('${ids.app}',1,'${ids.org}','finanzas','App de prueba','Descripción sintética suficientemente larga para esta prueba.','${ids.dev}');
      INSERT INTO public.files(id,org_id,uploaded_by,name,byte_size) VALUES ('${ids.file}','${ids.org}','${ids.dev}','index.html',100);
      INSERT INTO public.app_version_files(app_id,version,org_id,file_id) VALUES ('${ids.app}',1,'${ids.org}','${ids.file}');
      COMMIT;`));
    await test('autor de otra organización rechazado', () => rejects(`UPDATE public.apps SET author_id='${ids.admin2}' WHERE id='${ids.app}'`, /foreign key/i));
    await test('tenant de app no modificable', () => rejects(`UPDATE public.apps SET org_id='${ids.org2}' WHERE id='${ids.app}'`, /no puede cambiar/i));
    await test('versión actual debe existir', () => rejects(`UPDATE public.apps SET current_version=99 WHERE id='${ids.app}'`, /foreign key/i));
    await test('versiones inmutables', () => rejects(`UPDATE public.app_versions SET title='Alterada' WHERE app_id='${ids.app}'`, /inmutable/i));
    await test('metadatos de archivo inmutables', () => rejects(`UPDATE public.files SET byte_size=900 WHERE id='${ids.file}'`, /inmutable/i));
    await test('límite total de adjuntos', async () => {
      await db.exec(`INSERT INTO public.organization_settings(org_id,max_upload_files,max_upload_bytes) VALUES ('${ids.org}',1,100)`);
      await rejects(`INSERT INTO public.files(id,org_id,uploaded_by,name,byte_size) VALUES ('50000000-0000-4000-8000-000000000002','${ids.org}','${ids.dev}','otro.html',1);
        INSERT INTO public.app_version_files(app_id,version,org_id,file_id) VALUES ('${ids.app}',1,'${ids.org}','50000000-0000-4000-8000-000000000002')`, /Límite de adjuntos/i);
    });
    const review = (actor, version, action, reason='', checked=false) => `SELECT public.blk_review_app('${ids.app}','${actor}',${version},'${action}','${reason}','Sandbox',${checked},${checked})`;
    await test('admin de otro tenant no revisa', () => rejects(review(ids.admin2,1,'approved','',true), /no autorizado/i));
    await test('revisión obsoleta rechazada', () => rejects(review(ids.admin,2,'approved','',true), /Conflicto/i));
    await test('versión esperada nula no evita concurrencia', () => rejects(review(ids.admin,'NULL','approved','',true), /Conflicto/i));
    await test('aprobación requiere dos checks manuales', () => rejects(review(ids.admin,1,'approved'), /check constraint/i));
    await test('rechazo exige motivo', () => rejects(review(ids.admin,1,'rejected'), /check constraint/i));
    await test('solicitud de cambios atómica e historial', async () => {
      await db.exec(review(ids.admin,1,'changes_requested','Corregir datos sintéticos'));
      assert.equal((await value(`SELECT review_status FROM public.apps WHERE id='${ids.app}'`)).review_status,'changes_requested');
      assert.equal((await value('SELECT count(*)::int AS n FROM public.app_reviews')).n,1);
      assert.equal((await value('SELECT count(*)::int AS n FROM public.audit_events')).n,1);
      assert.equal((await value('SELECT count(*)::int AS n FROM public.catalog_apps')).n,0);
    });
    await test('adjuntos no se añaden tras revisión', () => rejects(`INSERT INTO public.app_version_files(app_id,version,org_id,file_id) VALUES ('${ids.app}',1,'${ids.org}','${ids.file}')`, /ya revisada/i));
    await test('etiquetas no se añaden tras revisión', () => rejects(`INSERT INTO public.app_version_labels(app_id,version,kind,label) VALUES ('${ids.app}',1,'tag','tardía')`, /ya revisada/i));
    await test('corrección conserva ticket y añade versión', () => db.exec(`BEGIN;
      INSERT INTO public.app_versions(app_id,version,org_id,category_id,title,description,created_by)
        VALUES ('${ids.app}',2,'${ids.org}','finanzas','App corregida','Descripción sintética corregida para la segunda revisión.','${ids.dev}');
      UPDATE public.apps SET current_version=2,review_status='pending_review' WHERE id='${ids.app}' AND current_version=1;
      COMMIT;`));
    await test('superadmin puede revisar otro tenant y catálogo muestra versión 2', async () => {
      await db.exec(review(ids.super,2,'approved','',true));
      const r=await value('SELECT current_version,title FROM public.catalog_apps');
      assert.equal(r.current_version,2); assert.equal(r.title,'App corregida');
    });
    await test('doble revisión rechazada', () => rejects(review(ids.admin,2,'approved','',true), /Conflicto/i));
    await test('suspensión oculta catálogo', async () => {
      await db.exec(`UPDATE public.organizations SET status='suspended' WHERE id='${ids.org}'`);
      assert.equal((await value('SELECT count(*)::int AS n FROM public.catalog_apps')).n,0);
      await db.exec(`UPDATE public.organizations SET status='active' WHERE id='${ids.org}'`);
    });
    await test('historial no se puede borrar', () => rejects('DELETE FROM public.app_reviews', /inmutable/i));
    await test('revisiones conservan contexto de ambas versiones', async () => assert.equal((await value('SELECT count(*)::int AS n FROM public.app_reviews')).n,2));
    await test('métricas organizativas derivadas', async () => {
      const r=await value(`SELECT * FROM public.organization_metrics WHERE org_id='${ids.org}'`);
      assert.equal(Number(r.registered_members),2); assert.equal(Number(r.approved_apps),1); assert.equal(Number(r.pending_apps),0);
    });
    await test('proyecto Studio, mensaje y versión persistentes', () => db.exec(`BEGIN;
      INSERT INTO public.studio_projects(id,org_id,owner_id,title,current_version,submitted_app_id,submitted_version)
        VALUES ('${ids.project}','${ids.org}','${ids.dev}','Proyecto',1,'${ids.app}',2);
      INSERT INTO public.studio_versions(project_id,version,prompt,generated_html,engine,spec)
        VALUES ('${ids.project}',1,'Crear panel','<!doctype html><title>Demo</title>','demo','{"kind":"dashboard"}');
      INSERT INTO public.studio_messages(project_id,position,role,body,version) VALUES ('${ids.project}',0,'user','Crear panel',1);
      COMMIT;`));
    await test('política global y local distinguibles', () => db.exec(`INSERT INTO public.policies(name,org_id) VALUES ('Global',NULL),('Local','${ids.org}')`));
    await test('evidencia no puede referir revisión de otra versión', () => rejects(`INSERT INTO public.app_security_evidence(app_id,version,review_id,label,source)
      SELECT '${ids.app}',2,id,'Certificado incorrecto','manual' FROM public.app_reviews WHERE version=1`, /foreign key/i));
    await test('sin ejecución pública de función de revisión', async () => {
      const r=await value("SELECT coalesce(bool_or(a.grantee=0 AND a.privilege_type='EXECUTE'),false) AS exposed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='public' AND p.proname='blk_review_app'");
      assert.equal(r.exposed,false);
    });
    await test('rol sin políticas no lee filas ni llama revisión', async () => {
      await db.exec('CREATE ROLE blk_validation_runtime; GRANT USAGE ON SCHEMA public TO blk_validation_runtime; GRANT SELECT ON public.apps,public.app_versions,public.organizations,public.catalog_apps TO blk_validation_runtime; SET ROLE blk_validation_runtime');
      try {
        assert.equal((await value('SELECT count(*)::int AS n FROM public.apps')).n,0);
        assert.equal((await value('SELECT count(*)::int AS n FROM public.catalog_apps')).n,0);
        await assert.rejects(() => db.exec(review(ids.admin,2,'approved','',true)), /permission denied/i);
      } finally { await db.exec('RESET ROLE'); }
    });
    console.log(`\n${passed} comprobaciones correctas. Motor: ${(await value('SELECT version() AS v')).v}`);
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
