CREATE OR REPLACE FUNCTION public.tk_flow_command(p_action text, p_id uuid, p_fields jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  identity jsonb := public.tk_identity();
  actor public.users;
BEGIN
  IF identity IS NULL THEN
    RAISE EXCEPTION 'Cuenta sin acceso o pendiente de activacion.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor FROM public.users WHERE id::text = identity->>'userId' FOR SHARE;
  IF actor.id IS NULL OR actor.org_id::text IS DISTINCT FROM identity->>'orgId'
    OR NOT actor.enabled OR actor.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'La cuenta ha cambiado. Recarga el espacio.' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_action IS NULL OR p_action NOT IN ('addToFlow', 'removeFromFlow', 'setFlowFavorite')
    OR p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'Operacion de Mi Flow no valida.' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'removeFromFlow' THEN
    IF p_fields <> '{}'::jsonb THEN
      RAISE EXCEPTION 'Campos de Mi Flow no validos.' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.user_flow_apps
      WHERE user_id = actor.id AND org_id = actor.org_id AND app_id = p_id;
  ELSE
    PERFORM a.id FROM public.apps a JOIN public.organizations o ON o.id = a.org_id
      WHERE a.id = p_id AND a.org_id = actor.org_id AND a.review_status = 'approved'
        AND a.deleted_at IS NULL AND o.deleted_at IS NULL
        AND o.status IN ('active', 'active-amber')
      FOR SHARE OF a, o;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La app no esta disponible en el catalogo de tu organizacion.' USING ERRCODE = '42501';
    END IF;
    IF p_action = 'addToFlow' THEN
      IF p_fields <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Campos de Mi Flow no validos.' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.user_flow_apps(user_id, org_id, app_id)
        VALUES (actor.id, actor.org_id, p_id) ON CONFLICT (user_id, app_id) DO NOTHING;
    ELSE
      IF jsonb_typeof(p_fields->'favorite') IS DISTINCT FROM 'boolean'
        OR p_fields - 'favorite' <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Favorito no valido.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.user_flow_apps SET favorite = (p_fields->>'favorite')::boolean
        WHERE user_id = actor.id AND org_id = actor.org_id AND app_id = p_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Anade primero la app a Mi Flow.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  PERFORM nextval('public.workspace_change_seq');
  RETURN jsonb_build_object('id', p_id);
END;
$$;