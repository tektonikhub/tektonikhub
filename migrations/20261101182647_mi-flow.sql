CREATE TABLE public.user_flow_apps (
  user_id uuid NOT NULL,
  org_id uuid NOT NULL,
  app_id uuid NOT NULL,
  favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id),
  FOREIGN KEY (user_id) REFERENCES public.users(id),
  FOREIGN KEY (app_id, org_id) REFERENCES public.apps(id, org_id)
);
CREATE INDEX user_flow_apps_org_idx ON public.user_flow_apps(org_id);
CREATE INDEX user_flow_apps_app_idx ON public.user_flow_apps(app_id);

CREATE FUNCTION public.tk_can_use_flow_app(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.apps a
    JOIN public.organizations o ON o.id = a.org_id
    WHERE a.id = p_id AND a.org_id::text = public.tk_identity()->>'orgId'
      AND a.review_status = 'approved' AND a.deleted_at IS NULL
      AND o.deleted_at IS NULL AND o.status IN ('active', 'active-amber')
  )
$$;

ALTER TABLE public.user_flow_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_flow_apps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_flow_apps TO authenticated;
CREATE POLICY user_flow_apps_owner_read ON public.user_flow_apps
  FOR SELECT TO authenticated USING (
    user_id::text = (SELECT public.tk_identity()->>'userId')
    AND org_id::text = (SELECT public.tk_identity()->>'orgId')
    AND public.tk_can_use_flow_app(app_id)
  );

CREATE FUNCTION public.tk_flow_entries() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  identity jsonb := public.tk_identity();
BEGIN
  IF identity IS NULL THEN
    RAISE EXCEPTION 'Cuenta sin acceso o pendiente de activacion.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'appId', f.app_id, 'favorite', f.favorite, 'createdAt', f.created_at
    ) ORDER BY f.created_at, f.app_id)
    FROM public.user_flow_apps f
    WHERE f.user_id::text = identity->>'userId'
      AND f.org_id::text = identity->>'orgId'
      AND public.tk_can_use_flow_app(f.app_id)
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION public.tk_flow_command(p_action text, p_id uuid, p_fields jsonb DEFAULT '{}'::jsonb)
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
  IF p_id IS NULL OR p_action NOT IN ('addToFlow', 'removeFromFlow', 'setFlowFavorite')
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

REVOKE ALL ON FUNCTION public.tk_can_use_flow_app(uuid), public.tk_flow_entries(),
  public.tk_flow_command(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tk_can_use_flow_app(uuid), public.tk_flow_entries(),
  public.tk_flow_command(text, uuid, jsonb) TO authenticated;