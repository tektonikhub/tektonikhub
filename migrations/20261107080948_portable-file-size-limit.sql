ALTER TABLE public.app_versions DROP CONSTRAINT app_versions_generated_html_check;
ALTER TABLE public.app_versions ADD CONSTRAINT app_versions_generated_html_check
  CHECK (octet_length(generated_html) <= 2000000);

CREATE OR REPLACE FUNCTION public.tk_portable_reserve(p_files jsonb) RETURNS jsonb
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
      OR f->>'name' LIKE '%..%' OR coalesce((f->>'size')::integer,0) NOT BETWEEN 1 AND 2000000 THEN
      RAISE EXCEPTION 'Nombre o tamano de fichero no valido. Maximo 2 MB (2.000.000 bytes) por fichero.';
    END IF;
    IF lower(f->>'name') LIKE '%.html' THEN
      html_count := html_count + 1;
      IF f->>'type' IS DISTINCT FROM 'text/html' THEN RAISE EXCEPTION 'HTML no valido.'; END IF;
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
