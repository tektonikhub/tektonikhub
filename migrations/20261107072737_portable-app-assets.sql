CREATE TABLE public.portable_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.users(id),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  files jsonb NOT NULL CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) BETWEEN 1 AND 10),
  consumed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE INDEX portable_uploads_author_date ON public.portable_uploads(author_id, created_at);
CREATE TABLE public.app_portable_versions (
  app_id uuid NOT NULL,
  org_id uuid NOT NULL,
  version integer NOT NULL,
  upload_id uuid NOT NULL REFERENCES public.portable_uploads(id),
  PRIMARY KEY(app_id, version),
  FOREIGN KEY(app_id, org_id, version) REFERENCES public.app_versions(app_id, org_id, version)
);
CREATE INDEX app_portable_upload_idx ON public.app_portable_versions(upload_id);
ALTER TABLE public.portable_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_portable_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portable_uploads, public.app_portable_versions FROM anon, authenticated;

CREATE FUNCTION public.tk_portable_readable(p_app uuid, p_version integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.tk_can_read_app(p_app) AND EXISTS (
    SELECT 1 FROM public.app_versions v JOIN public.apps a ON a.id = v.app_id
    WHERE v.app_id = p_app AND v.version = p_version AND (
      public.tk_can_access(v.org_id, true)
      OR v.author_id::text = public.tk_identity()->>'userId'
      OR (public.tk_can_use_flow_app(p_app) AND a.version = p_version)
    )
  )
$$;
CREATE FUNCTION public.tk_portable_storage_access(p_key text, p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portable_uploads u, jsonb_array_elements(u.files) f
    WHERE p_key = u.id::text || '/' || (f->>'name') AND (
      (NOT u.consumed AND u.expires_at > now() AND u.auth_user_id = auth.uid()
        AND u.author_id::text = public.tk_identity()->>'userId'
        AND u.org_id::text = public.tk_identity()->>'orgId')
      OR (NOT p_write AND u.consumed AND EXISTS (
        SELECT 1 FROM public.app_portable_versions v WHERE v.upload_id = u.id
          AND public.tk_portable_readable(v.app_id, v.version)
      ))
    )
  )
$$;
CREATE FUNCTION public.tk_portable_storage_file(p_key text, p_size integer, p_type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.tk_portable_storage_access(p_key, true) AND EXISTS (
    SELECT 1 FROM public.portable_uploads u, jsonb_array_elements(u.files) f
    WHERE p_key = u.id::text || '/' || (f->>'name')
      AND p_size = (f->>'size')::integer AND p_type = f->>'type'
  )
$$;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY portable_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket = 'portable-apps' AND public.tk_portable_storage_access(key));
CREATE POLICY portable_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket = 'portable-apps' AND uploaded_by = auth.uid()::text AND public.tk_portable_storage_file(key, size, mime_type));
CREATE POLICY portable_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket = 'portable-apps' AND public.tk_portable_storage_access(key, true))
  WITH CHECK (bucket = 'portable-apps' AND uploaded_by = auth.uid()::text AND public.tk_portable_storage_file(key, size, mime_type));
CREATE POLICY portable_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket = 'portable-apps' AND public.tk_portable_storage_access(key, true));
-- Restrictive guards prevent existing permissive policies from exposing or changing bundles.
CREATE POLICY portable_guard ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket <> 'portable-apps' OR public.tk_portable_storage_access(key))
  WITH CHECK (bucket <> 'portable-apps' OR (uploaded_by = auth.uid()::text AND public.tk_portable_storage_file(key, size, mime_type)));
CREATE POLICY portable_update_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
  USING (bucket <> 'portable-apps' OR public.tk_portable_storage_access(key, true));
CREATE POLICY portable_delete_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO anon, authenticated
  USING (bucket <> 'portable-apps' OR public.tk_portable_storage_access(key, true));
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

CREATE FUNCTION public.tk_portable_reserve(p_files jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE identity jsonb := public.tk_identity(); result_id uuid; f jsonb; html_count integer := 0; total bigint := 0;
BEGIN
  IF identity IS NULL OR identity->>'role' NOT IN ('developer','admin','superadmin') THEN
    RAISE EXCEPTION 'No tienes acceso a Studio.' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(identity->>'userId', 713));
  IF (SELECT count(*) FROM public.portable_uploads WHERE author_id::text = identity->>'userId' AND created_at > now() - interval '1 day') >= 30 THEN
    RAISE EXCEPTION 'Has alcanzado el limite de 30 cargas al dia.';
  END IF;
  IF jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Selecciona entre 1 y 10 ficheros.'; END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
    IF f->>'name' IS NULL OR length(f->>'name') NOT BETWEEN 1 AND 120
      OR f->>'name' !~* '^[a-z0-9][a-z0-9._ -]*\.(html|json)$'
      OR f->>'name' LIKE '%..%' OR coalesce((f->>'size')::integer,0) NOT BETWEEN 1 AND 5242880 THEN
      RAISE EXCEPTION 'Nombre o tamano de fichero no valido.';
    END IF;
    IF lower(f->>'name') LIKE '%.html' THEN
      html_count := html_count + 1;
      IF f->>'type' IS DISTINCT FROM 'text/html' OR (f->>'size')::integer > 1200000 THEN RAISE EXCEPTION 'HTML no valido.'; END IF;
    ELSE
      IF f->>'type' IS DISTINCT FROM 'application/json' THEN RAISE EXCEPTION 'Solo se admiten HTML y JSON.'; END IF;
    END IF;
    total := total + (f->>'size')::integer;
  END LOOP;
  IF html_count <> 1 OR total > 26214400 OR (
    SELECT count(DISTINCT lower(x->>'name')) FROM jsonb_array_elements(p_files) x
  ) <> jsonb_array_length(p_files) THEN RAISE EXCEPTION 'Se requiere un HTML, nombres unicos y un maximo de 25 MB.'; END IF;
  INSERT INTO public.portable_uploads(author_id, auth_user_id, org_id, files)
    VALUES ((identity->>'userId')::uuid, auth.uid(), (identity->>'orgId')::uuid, p_files) RETURNING id INTO result_id;
  RETURN jsonb_build_object('id', result_id);
END
$$;
CREATE FUNCTION public.tk_portable_submit(p_upload uuid, p_fields jsonb, p_id uuid DEFAULT NULL, p_version integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE identity jsonb := public.tk_identity(); u public.portable_uploads; result jsonb; app_version integer; f jsonb;
BEGIN
  SELECT * INTO u FROM public.portable_uploads WHERE id = p_upload FOR UPDATE;
  IF identity IS NULL OR u.id IS NULL OR u.consumed OR u.expires_at <= now()
    OR u.author_id::text <> identity->>'userId' OR u.org_id::text <> identity->>'orgId' OR u.auth_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Carga no disponible para esta cuenta.' USING ERRCODE = '42501';
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(u.files) LOOP
    PERFORM 1 FROM storage.objects WHERE bucket = 'portable-apps' AND key = u.id::text || '/' || (f->>'name')
      AND size = (f->>'size')::integer AND mime_type = f->>'type' AND uploaded_by = auth.uid()::text FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se han guardado todos los assets. Vuelve a enviar la aplicacion.'; END IF;
  END LOOP;
  IF nullif(btrim(p_fields->>'generatedHtml'), '') IS NULL THEN RAISE EXCEPTION 'Se requiere HTML.'; END IF;
  result := public.tk_command(CASE WHEN p_id IS NULL THEN 'createSubmission' ELSE 'updateSubmission' END,
    p_id, p_fields || jsonb_build_object('aiTool', 'HTML / JSON portable', 'attachments', u.files), p_version);
  SELECT version INTO app_version FROM public.apps WHERE id = (result->>'id')::uuid;
  DELETE FROM public.app_portable_versions WHERE app_id = (result->>'id')::uuid AND version = app_version;
  INSERT INTO public.app_portable_versions VALUES ((result->>'id')::uuid, u.org_id, app_version, u.id);
  UPDATE public.portable_uploads SET consumed = true WHERE id = u.id;
  RETURN result;
END
$$;
CREATE FUNCTION public.tk_portable_manifest(p_app uuid, p_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.tk_portable_readable(p_app, p_version) THEN RAISE EXCEPTION 'Aplicacion no disponible.' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object('uploadId',u.id,'files',u.files) INTO result
    FROM public.app_portable_versions v JOIN public.portable_uploads u ON u.id = v.upload_id
    WHERE v.app_id = p_app AND v.version = p_version;
  RETURN result;
END
$$;
CREATE FUNCTION public.tk_portable_copy_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_versions v WHERE v.app_id = NEW.app_id AND v.version = NEW.version - 1
    AND v.generated_html IS NOT DISTINCT FROM NEW.generated_html) THEN
    INSERT INTO public.app_portable_versions(app_id, org_id, version, upload_id)
      SELECT app_id, org_id, NEW.version, upload_id FROM public.app_portable_versions
      WHERE app_id = NEW.app_id AND version = NEW.version - 1;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER portable_copy_version AFTER INSERT ON public.app_versions FOR EACH ROW EXECUTE FUNCTION public.tk_portable_copy_version();
REVOKE ALL ON FUNCTION public.tk_portable_readable(uuid,integer), public.tk_portable_storage_access(text,boolean),
  public.tk_portable_storage_file(text,integer,text), public.tk_portable_reserve(jsonb), public.tk_portable_submit(uuid,jsonb,uuid,integer),
  public.tk_portable_manifest(uuid,integer), public.tk_portable_copy_version() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tk_portable_readable(uuid,integer), public.tk_portable_storage_access(text,boolean),
  public.tk_portable_storage_file(text,integer,text), public.tk_portable_reserve(jsonb), public.tk_portable_submit(uuid,jsonb,uuid,integer),
  public.tk_portable_manifest(uuid,integer) TO authenticated;
