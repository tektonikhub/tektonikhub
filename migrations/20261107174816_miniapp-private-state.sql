CREATE TABLE public.miniapp_user_state (
  user_id uuid NOT NULL REFERENCES public.users(id),
  org_id uuid NOT NULL,
  app_id uuid NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object' AND octet_length(state::text) <= 200000),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, app_id),
  FOREIGN KEY (app_id, org_id) REFERENCES public.apps(id, org_id)
);
CREATE INDEX miniapp_user_state_app_idx ON public.miniapp_user_state(app_id, org_id);
ALTER TABLE public.miniapp_user_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.miniapp_user_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.miniapp_user_state TO authenticated;
CREATE POLICY miniapp_user_state_owner_read ON public.miniapp_user_state
  FOR SELECT TO authenticated USING (
    user_id::text = (SELECT public.tk_identity()->>'userId')
    AND org_id::text = (SELECT public.tk_identity()->>'orgId')
    AND public.tk_can_use_flow_app(app_id)
  );

CREATE FUNCTION public.tk_app_state_read(p_id uuid, p_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  identity jsonb := public.tk_identity();
  current_state public.miniapp_user_state;
BEGIN
  IF identity IS NULL OR NOT public.tk_can_use_flow_app(p_id) THEN
    RAISE EXCEPTION 'La aplicación no está disponible en tu organización.' USING ERRCODE = '42501';
  END IF;
  IF p_version IS NULL OR NOT EXISTS (SELECT 1 FROM public.apps WHERE id = p_id AND version = p_version) THEN
    RAISE EXCEPTION 'La aplicación cambió de versión. Recarga antes de continuar.' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO current_state FROM public.miniapp_user_state
    WHERE user_id::text = identity->>'userId' AND org_id::text = identity->>'orgId' AND app_id = p_id;
  RETURN jsonb_build_object('state', coalesce(current_state.state, '{}'::jsonb), 'revision', coalesce(current_state.revision, 0));
END;
$$;

CREATE FUNCTION public.tk_app_state_save(p_id uuid, p_version integer, p_state jsonb, p_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  identity jsonb := public.tk_identity();
  actor public.users;
  current_state public.miniapp_user_state;
BEGIN
  IF identity IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión con una cuenta activa.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO actor FROM public.users WHERE id::text = identity->>'userId' FOR SHARE;
  IF actor.id IS NULL OR NOT actor.enabled OR actor.deleted_at IS NOT NULL
    OR actor.org_id::text IS DISTINCT FROM identity->>'orgId' THEN
    RAISE EXCEPTION 'La cuenta ha cambiado. Recarga el espacio.' USING ERRCODE = '42501';
  END IF;
  PERFORM a.id FROM public.apps a JOIN public.organizations o ON o.id = a.org_id
    WHERE a.id = p_id AND a.org_id = actor.org_id AND a.review_status = 'approved' AND a.deleted_at IS NULL
      AND o.deleted_at IS NULL AND o.status IN ('active', 'active-amber') FOR SHARE OF a, o;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La aplicación no está disponible en tu organización.' USING ERRCODE = '42501';
  END IF;
  IF p_version IS NULL OR NOT EXISTS (SELECT 1 FROM public.apps WHERE id = p_id AND version = p_version) THEN
    RAISE EXCEPTION 'La aplicación cambió de versión. Recarga antes de guardar.' USING ERRCODE = '40001';
  END IF;
  IF p_state IS NULL OR jsonb_typeof(p_state) <> 'object' OR octet_length(p_state::text) > 200000
    OR p_revision IS NULL OR p_revision < 0 OR p_revision >= 2147483647 THEN
    RAISE EXCEPTION 'Estado de aplicación no válido o demasiado grande.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_each(p_state)) > 100 OR EXISTS (
    SELECT 1 FROM jsonb_each(p_state) WHERE length(key) > 120 OR jsonb_typeof(value) <> 'string'
  ) THEN
    RAISE EXCEPTION 'El estado admite hasta 100 claves de texto de 120 caracteres.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.miniapp_user_state(user_id, org_id, app_id) VALUES (actor.id, actor.org_id, p_id)
    ON CONFLICT (user_id, app_id) DO NOTHING;
  SELECT * INTO current_state FROM public.miniapp_user_state WHERE user_id = actor.id AND app_id = p_id FOR UPDATE;
  IF current_state.org_id <> actor.org_id OR current_state.revision <> p_revision THEN
    RAISE EXCEPTION 'Hay cambios en otra pestaña. Exporta tu trabajo y recarga; no se sobrescribió el estado guardado.' USING ERRCODE = '40001';
  END IF;
  UPDATE public.miniapp_user_state SET state = p_state, revision = revision + 1, updated_at = now()
    WHERE user_id = actor.id AND app_id = p_id RETURNING * INTO current_state;
  RETURN jsonb_build_object('state', current_state.state, 'revision', current_state.revision);
END;
$$;
REVOKE ALL ON FUNCTION public.tk_app_state_read(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tk_app_state_save(uuid, integer, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tk_app_state_read(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tk_app_state_save(uuid, integer, jsonb, integer) TO authenticated;
