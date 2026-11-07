CREATE FUNCTION public.tk_portable_pending(p_upload uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE result jsonb; identity jsonb := public.tk_identity();
BEGIN
  SELECT jsonb_build_object('uploadId',id,'files',files) INTO result FROM public.portable_uploads
  WHERE id = p_upload AND NOT consumed AND expires_at > now() AND auth_user_id = auth.uid()
    AND author_id::text = identity->>'userId' AND org_id::text = identity->>'orgId';
  IF result IS NULL THEN RAISE EXCEPTION 'Carga no disponible.' USING ERRCODE = '42501'; END IF;
  RETURN result;
END
$$;
REVOKE ALL ON FUNCTION public.tk_portable_pending(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tk_portable_pending(uuid) TO authenticated;
