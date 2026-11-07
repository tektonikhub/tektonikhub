-- Run only on a disposable schema-only branch. Every synthetic row is rolled back.
BEGIN;
INSERT INTO public.categories(id,label) VALUES('it','Portable test IT') ON CONFLICT DO NOTHING;
INSERT INTO public.plans(id,name) VALUES('f0000000-0000-4000-8000-000000000001','Portable RLS test');
INSERT INTO public.organizations(id,name,plan_id,admin_id) VALUES
('f0000000-0000-4000-8000-000000000002','Portable RLS org','f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003'),
('f0000000-0000-4000-8000-000000000012','Portable RLS foreign','f0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000013');
INSERT INTO public.users(id,org_id,email,username,role,name) VALUES
('f0000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000002','portable-admin@example.invalid','portable-admin','admin','Portable admin'),
('f0000000-0000-4000-8000-000000000004','f0000000-0000-4000-8000-000000000002','portable-author@example.invalid','portable-author','developer','Portable author'),
('f0000000-0000-4000-8000-000000000005','f0000000-0000-4000-8000-000000000002','portable-catalog@example.invalid','portable-catalog','catalog','Portable catalog'),
('f0000000-0000-4000-8000-000000000013','f0000000-0000-4000-8000-000000000012','portable-foreign@example.invalid','portable-foreign','admin','Portable foreign');
INSERT INTO auth.users(id,email,email_verified) VALUES
('f0000000-0000-4000-8000-000000000103','portable-admin@example.invalid',true),
('f0000000-0000-4000-8000-000000000104','portable-author@example.invalid',true),
('f0000000-0000-4000-8000-000000000105','portable-catalog@example.invalid',true),
('f0000000-0000-4000-8000-000000000113','portable-foreign@example.invalid',true);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000104","role":"authenticated"}',true);
DO $$
DECLARE batch uuid; app uuid; count_rows integer;
BEGIN
  batch := (public.tk_portable_reserve('[{"name":"app.html","type":"text/html","size":18},{"name":"data.json","type":"application/json","size":2}]')->>'id')::uuid;
  PERFORM set_config('test.portable_batch',batch::text,true);
  IF NOT public.tk_portable_storage_file(batch||'/app.html',18,'text/html')
    OR NOT public.tk_portable_storage_file(batch||'/app.html',18,'application/octet-stream')
    OR public.tk_portable_storage_file(batch||'/app.html',0,'application/octet-stream')
    OR public.tk_portable_storage_file(batch||'/data.json',2,'application/octet-stream') THEN
    RAISE EXCEPTION 'TEST: invalid HTML storage MIME normalization';
  END IF;
  INSERT INTO storage.objects(bucket,key,size,mime_type,uploaded_by) VALUES
    ('portable-apps',batch||'/app.html',18,'application/octet-stream',auth.uid()::text);
  BEGIN
    PERFORM public.tk_portable_submit(batch,'{"title":"RLS portable","desc":"Synthetic description for portable RLS coverage.","area":"it","generatedHtml":"<html>hello</html>"}');
    RAISE EXCEPTION 'TEST: incomplete bundle accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'TEST:%' THEN RAISE; END IF;
  END;
  INSERT INTO storage.objects(bucket,key,size,mime_type,uploaded_by) VALUES
    ('portable-apps',batch||'/data.json',2,'application/json',auth.uid()::text);
  BEGIN
    INSERT INTO storage.objects(bucket,key,size,mime_type,uploaded_by) VALUES
      ('portable-apps',batch||'/other.json',2,'application/json',auth.uid()::text);
    RAISE EXCEPTION 'TEST: unreserved filename accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  app := (public.tk_portable_submit(batch,'{"title":"RLS portable","desc":"Synthetic description for portable RLS coverage.","area":"it","generatedHtml":"<html>hello</html>"}')->>'id')::uuid;
  PERFORM set_config('test.portable_app',app::text,true);
  UPDATE storage.objects SET size=1 WHERE bucket='portable-apps' AND key=batch||'/data.json';
  GET DIAGNOSTICS count_rows = ROW_COUNT;
  IF count_rows <> 0 THEN RAISE EXCEPTION 'TEST: submitted asset changed'; END IF;
  DELETE FROM storage.objects WHERE bucket='portable-apps' AND key=batch||'/data.json';
  GET DIAGNOSTICS count_rows = ROW_COUNT;
  IF count_rows <> 0 THEN RAISE EXCEPTION 'TEST: submitted asset deleted'; END IF;
  IF public.tk_portable_manifest(app,1) IS NULL THEN RAISE EXCEPTION 'TEST: author cannot read submitted bundle'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000105","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket='portable-apps' AND key LIKE current_setting('test.portable_batch')||'/%') THEN RAISE EXCEPTION 'TEST: catalog read pending bundle'; END IF;
  BEGIN
    PERFORM public.tk_portable_reserve('[{"name":"app.html","type":"text/html","size":18}]');
    RAISE EXCEPTION 'TEST: catalog can reserve';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000113","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket='portable-apps' AND key LIKE current_setting('test.portable_batch')||'/%') THEN RAISE EXCEPTION 'TEST: foreign admin read bundle'; END IF;
  BEGIN
    PERFORM public.tk_portable_manifest(current_setting('test.portable_app')::uuid,1);
    RAISE EXCEPTION 'TEST: foreign manifest available';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000103","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.tk_portable_manifest(current_setting('test.portable_app')::uuid,1) IS NULL THEN RAISE EXCEPTION 'TEST: admin cannot review'; END IF;
  PERFORM public.tk_command('reviewApp',current_setting('test.portable_app')::uuid,'{"action":"approved","checks":{"security":true,"data":true}}',1);
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000105","role":"authenticated"}',true);
DO $$ BEGIN
  IF NOT public.tk_can_use_flow_app(current_setting('test.portable_app')::uuid) THEN RAISE EXCEPTION 'TEST: approval unavailable'; END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket='portable-apps' AND key LIKE current_setting('test.portable_batch')||'/%') <> 2 THEN RAISE EXCEPTION 'TEST: catalog cannot read approved assets'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000103","role":"authenticated"}',true);
DO $$ BEGIN
  PERFORM public.tk_command('saveManagedApp',current_setting('test.portable_app')::uuid,'{"orgId":"f0000000-0000-4000-8000-000000000002","authorId":"f0000000-0000-4000-8000-000000000004","title":"RLS updated","desc":"Synthetic description for portable RLS coverage.","area":"it","hours":0,"users":0}',1);
  IF public.tk_portable_manifest(current_setting('test.portable_app')::uuid,2) IS NULL THEN RAISE EXCEPTION 'TEST: metadata edit lost JSON'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"f0000000-0000-4000-8000-000000000105","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket='portable-apps' AND key LIKE current_setting('test.portable_batch')||'/%') THEN RAISE EXCEPTION 'TEST: assets remain readable after return to review'; END IF;
END $$;
ROLLBACK;
