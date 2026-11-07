-- InsForge serves active HTML uploads as octet-stream; the manifest keeps their portable type.
CREATE OR REPLACE FUNCTION public.tk_portable_storage_file(p_key text, p_size integer, p_type text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT public.tk_portable_storage_access(p_key, true) AND EXISTS (
    SELECT 1 FROM public.portable_uploads u, jsonb_array_elements(u.files) f
    WHERE p_key = u.id::text || '/' || (f->>'name')
      AND p_size = (f->>'size')::integer
      AND (p_type = f->>'type' OR (f->>'type' = 'text/html' AND p_type = 'application/octet-stream'))
  )
$$;
CREATE OR REPLACE FUNCTION public.tk_portable_submit(p_upload uuid, p_fields jsonb, p_id uuid DEFAULT NULL, p_version integer DEFAULT NULL) RETURNS jsonb
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
      AND size = (f->>'size')::integer AND public.tk_portable_storage_file(key, size, mime_type)
      AND uploaded_by = auth.uid()::text;
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
