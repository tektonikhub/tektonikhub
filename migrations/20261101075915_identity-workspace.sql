CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  price numeric(12, 2) CHECK (price >= 0)
);
CREATE UNIQUE INDEX plans_name_key ON public.plans (lower(btrim(name)));

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  domain text NOT NULL DEFAULT '' CHECK (
    domain = '' OR (length(domain) <= 253 AND domain ~* '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
  ),
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  admin_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'active-amber', 'pending', 'suspended')),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX organizations_name_key ON public.organizations (lower(btrim(name)));
CREATE UNIQUE INDEX organizations_domain_key ON public.organizations (lower(domain)) WHERE domain <> '';
CREATE UNIQUE INDEX organizations_system_key ON public.organizations (is_system) WHERE is_system;
CREATE INDEX organizations_plan_idx ON public.organizations(plan_id);

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) DEFERRABLE INITIALLY DEFERRED,
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL CHECK (length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  email_key text GENERATED ALWAYS AS (lower(btrim(email))) STORED UNIQUE,
  username text NOT NULL CHECK (username ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$'),
  username_key text GENERATED ALWAYS AS (lower(username)) STORED UNIQUE,
  role text NOT NULL CHECK (role IN ('developer', 'catalog', 'admin', 'superadmin')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  dept text NOT NULL DEFAULT '' CHECK (length(dept) <= 120),
  enabled boolean NOT NULL DEFAULT true,
  invitation_state text NOT NULL DEFAULT 'reserved' CHECK (invitation_state IN ('reserved', 'sent', 'failed')),
  last_access timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(id, org_id)
);
CREATE INDEX users_org_idx ON public.users(org_id, role);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_admin_fk
  FOREIGN KEY(admin_id, id) REFERENCES public.users(id, org_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.company_profiles (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  bio text NOT NULL DEFAULT '' CHECK (length(bio) <= 2000),
  banner_title text NOT NULL DEFAULT '' CHECK (length(banner_title) <= 160),
  banner_desc text NOT NULL DEFAULT '' CHECK (length(banner_desc) <= 2000)
);
CREATE TABLE public.organization_branding (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  tokens jsonb NOT NULL CHECK (jsonb_typeof(tokens) = 'object')
);
CREATE TABLE public.categories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]+$'),
  label text NOT NULL
);
INSERT INTO public.categories(id, label) VALUES
  ('finanzas', 'Finanzas & ERP'), ('rrhh', 'Recursos Humanos'),
  ('legal', 'Legal & Compliance'), ('ventas', 'Ventas & CRM'),
  ('marketing', 'Marketing & Growth'), ('it', 'IT & Infraestructura'),
  ('compras', 'Compras & Supply'), ('estrategia', 'Estrategia & BI'),
  ('proyectos', 'Proyectos'), ('innovacion', 'Innovacion');

CREATE TABLE public.apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  author_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  review_status text NOT NULL DEFAULT 'pending_review' CHECK (
    review_status IN ('pending_review', 'changes_requested', 'rejected', 'approved')
  ),
  estimated_hours integer NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0),
  estimated_users integer NOT NULL DEFAULT 0 CHECK (estimated_users >= 0),
  environment text NOT NULL DEFAULT '' CHECK (length(environment) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE(id, org_id),
  FOREIGN KEY(author_id, org_id) REFERENCES public.users(id, org_id)
);
CREATE INDEX apps_org_status_idx ON public.apps(org_id, review_status) WHERE deleted_at IS NULL;
CREATE INDEX apps_author_idx ON public.apps(author_id) WHERE deleted_at IS NULL;
CREATE TABLE public.app_versions (
  app_id uuid NOT NULL,
  org_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  author_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 60),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 30 AND 800),
  category_id text NOT NULL REFERENCES public.categories(id),
  tagline text NOT NULL DEFAULT '' CHECK (length(tagline) <= 100),
  impact text NOT NULL DEFAULT '' CHECK (length(impact) <= 500),
  data_note text NOT NULL DEFAULT '' CHECK (length(data_note) <= 2000),
  repo_url text NOT NULL DEFAULT '' CHECK (repo_url = '' OR (length(repo_url) <= 1000 AND repo_url ~* '^https?://[^[:space:]]+$')),
  generated_html text CHECK (length(generated_html) <= 300000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(app_id, version),
  UNIQUE(app_id, org_id, version),
  FOREIGN KEY(app_id, org_id) REFERENCES public.apps(id, org_id),
  FOREIGN KEY(author_id, org_id) REFERENCES public.users(id, org_id)
);
ALTER TABLE public.apps ADD CONSTRAINT apps_current_version_fk
  FOREIGN KEY(id, org_id, version) REFERENCES public.app_versions(app_id, org_id, version)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX app_versions_org_idx ON public.app_versions(org_id);
CREATE INDEX app_versions_author_idx ON public.app_versions(author_id);
CREATE INDEX app_versions_category_idx ON public.app_versions(category_id);
CREATE TABLE public.app_labels (
  app_id uuid NOT NULL,
  org_id uuid NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tech', 'tag')),
  position integer NOT NULL CHECK (position >= 0),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  PRIMARY KEY(app_id, version, kind, position),
  FOREIGN KEY(app_id, org_id, version) REFERENCES public.app_versions(app_id, org_id, version)
);
CREATE INDEX app_labels_org_idx ON public.app_labels(org_id);
CREATE TABLE public.app_attachments (
  app_id uuid NOT NULL,
  org_id uuid NOT NULL,
  version integer NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 9),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
  size bigint NOT NULL CHECK (size BETWEEN 0 AND 26214400),
  mime_type text NOT NULL DEFAULT '' CHECK (length(mime_type) <= 128),
  PRIMARY KEY(app_id, version, position),
  FOREIGN KEY(app_id, org_id, version) REFERENCES public.app_versions(app_id, org_id, version)
);
CREATE INDEX app_attachments_org_idx ON public.app_attachments(org_id);

CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  org_id uuid NOT NULL,
  version integer NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES public.users(id),
  reviewer_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('approved', 'rejected', 'changes_requested')),
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 3000 AND (action = 'approved' OR length(btrim(reason)) > 0)),
  environment text NOT NULL DEFAULT '' CHECK (length(environment) <= 200),
  security_checked boolean NOT NULL DEFAULT false,
  data_checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (action <> 'approved' OR (security_checked AND data_checked)),
  UNIQUE(app_id, version),
  FOREIGN KEY(app_id, org_id, version) REFERENCES public.app_versions(app_id, org_id, version)
);
CREATE INDEX reviews_org_idx ON public.reviews(org_id);
CREATE INDEX reviews_reviewer_idx ON public.reviews(reviewer_id);
CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  app_id uuid,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  actor_name text NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(app_id, org_id) REFERENCES public.apps(id, org_id)
);
CREATE INDEX audit_events_org_date_idx ON public.audit_events(org_id, created_at DESC);
CREATE INDEX audit_events_app_idx ON public.audit_events(app_id);
CREATE INDEX audit_events_actor_idx ON public.audit_events(actor_id);
CREATE TABLE public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 3000),
  enabled boolean NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX policies_org_idx ON public.policies(org_id);
CREATE TABLE public.policy_versions (
  policy_id uuid NOT NULL REFERENCES public.policies(id),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(policy_id, version)
);
CREATE INDEX policy_versions_actor_idx ON public.policy_versions(actor_id);
CREATE TABLE public.auth_attempts (
  key text PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_attempts_expiry_idx ON public.auth_attempts(expires_at);
CREATE SEQUENCE public.workspace_change_seq AS bigint;

CREATE FUNCTION public.tk_identity() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object('userId', u.id, 'orgId', u.org_id, 'role', u.role)
  FROM public.users u
  JOIN auth.users a ON a.id = u.auth_user_id AND lower(a.email) = u.email_key
  JOIN public.organizations o ON o.id = u.org_id
  WHERE a.id = auth.uid() AND a.email_verified AND NOT a.is_anonymous
    AND u.enabled AND u.deleted_at IS NULL AND o.deleted_at IS NULL
    AND (o.status IN ('active', 'active-amber') OR u.role = 'superadmin')
$$;
CREATE FUNCTION public.tk_can_access(p_org uuid, p_admin boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT coalesce(
    (public.tk_identity()->>'role' = 'superadmin' OR public.tk_identity()->>'orgId' = p_org::text)
    AND (NOT p_admin OR public.tk_identity()->>'role' IN ('admin', 'superadmin')),
    false
  )
$$;
CREATE FUNCTION public.tk_can_read_app(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.apps a
    WHERE a.id = p_id AND a.deleted_at IS NULL AND public.tk_can_access(a.org_id)
      AND (public.tk_identity()->>'role' IN ('admin', 'superadmin')
        OR a.review_status = 'approved'
        OR (public.tk_identity()->>'role' = 'developer' AND a.author_id::text = public.tk_identity()->>'userId'))
  )
$$;

CREATE FUNCTION public.tk_attach_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  UPDATE public.users SET auth_user_id = NEW.id
    WHERE email_key = lower(btrim(NEW.email)) AND enabled AND deleted_at IS NULL AND auth_user_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alta no autorizada. Solicita una invitacion al administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tektonik_invited_auth_user AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.tk_attach_auth_user();

CREATE FUNCTION public.tk_check_org_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.organizations o
    LEFT JOIN public.users u ON u.id = o.admin_id AND u.org_id = o.id
    WHERE o.id = NEW.id AND o.deleted_at IS NULL
      AND (u.id IS NULL OR u.role NOT IN ('admin', 'superadmin') OR NOT u.enabled OR u.deleted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'La organizacion necesita un administrador habilitado de la misma empresa.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER organizations_admin_integrity AFTER INSERT OR UPDATE ON public.organizations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tk_check_org_admin();
CREATE FUNCTION public.tk_check_user_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users u JOIN public.organizations o ON o.id = u.org_id
    WHERE u.id = NEW.id AND u.role = 'superadmin' AND NOT o.is_system
  ) THEN
    RAISE EXCEPTION 'Los superadministradores pertenecen a la organizacion de plataforma.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organizations o LEFT JOIN public.users u ON u.id = o.admin_id AND u.org_id = o.id
    WHERE o.admin_id = NEW.id AND o.deleted_at IS NULL
      AND (u.id IS NULL OR u.role NOT IN ('admin', 'superadmin') OR NOT u.enabled OR u.deleted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Asigna otro administrador antes de modificar esta cuenta.';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER users_role_integrity AFTER INSERT OR UPDATE ON public.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.tk_check_user_integrity();
CREATE FUNCTION public.tk_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'El historial es inmutable.' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER app_versions_immutable BEFORE UPDATE OR DELETE ON public.app_versions FOR EACH ROW EXECUTE FUNCTION public.tk_append_only();
CREATE TRIGGER app_labels_immutable BEFORE UPDATE OR DELETE ON public.app_labels FOR EACH ROW EXECUTE FUNCTION public.tk_append_only();
CREATE TRIGGER app_attachments_immutable BEFORE UPDATE OR DELETE ON public.app_attachments FOR EACH ROW EXECUTE FUNCTION public.tk_append_only();
CREATE TRIGGER reviews_immutable BEFORE UPDATE OR DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.tk_append_only();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.tk_append_only();
CREATE TRIGGER policy_versions_immutable BEFORE UPDATE OR DELETE ON public.policy_versions FOR EACH ROW EXECUTE FUNCTION public.tk_append_only();

CREATE FUNCTION public.tk_workspace() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  identity jsonb := public.tk_identity();
  result jsonb;
BEGIN
  IF identity IS NULL THEN RAISE EXCEPTION 'Cuenta sin acceso o pendiente de activacion.' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.organizations o WHERE o.deleted_at IS NULL AND public.tk_can_access(o.id)) > 1000
    OR (SELECT count(*) FROM public.users u WHERE public.tk_can_access(u.org_id)) > 5000
    OR (SELECT count(*) FROM public.apps a WHERE public.tk_can_read_app(a.id)) > 1000 THEN
    RAISE EXCEPTION 'El espacio supera el limite inicial. Se necesita paginacion antes de cargar mas registros.' USING ERRCODE = '54000';
  END IF;
  SELECT jsonb_build_object(
    'session', identity,
    'revision', (SELECT last_value FROM public.workspace_change_seq),
    'organizations', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', o.id, 'name', o.name, 'initials', upper(left(o.name, 2)), 'plan', o.plan_id,
        'members', (SELECT count(*) FROM public.users u WHERE u.org_id = o.id AND u.deleted_at IS NULL),
        'compliance', NULL, 'status', o.status, 'adminId', o.admin_id, 'createdAt', o.created_at,
        'date', to_char(o.created_at, 'DD/MM/YYYY'), 'domain', o.domain, 'lastAccess', '',
        'system', o.is_system, 'brand', b.tokens,
        'profile', CASE WHEN p.org_id IS NOT NULL THEN jsonb_build_object('bio', p.bio, 'bannerTitle', p.banner_title, 'bannerDesc', p.banner_desc) END
      )) || '{"compliance": null}'::jsonb ORDER BY o.created_at)
      FROM public.organizations o
      LEFT JOIN public.company_profiles p ON p.org_id = o.id LEFT JOIN public.organization_branding b ON b.org_id = o.id
      WHERE o.deleted_at IS NULL AND public.tk_can_access(o.id)
    ), '[]'::jsonb),
    'users', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id, 'orgId', u.org_id, 'role', u.role, 'name', u.name, 'initials', upper(left(u.name, 2)),
        'dept', u.dept, 'email', u.email, 'username', u.username, 'enabled', u.enabled,
        'deletedAt', u.deleted_at,
        'accountStatus', CASE WHEN a.email_verified THEN 'active' ELSE u.invitation_state END
      ) ORDER BY u.created_at)
      FROM public.users u JOIN public.organizations o ON o.id = u.org_id
      LEFT JOIN auth.users a ON a.id = u.auth_user_id
      WHERE o.deleted_at IS NULL AND public.tk_can_access(u.org_id)
    ), '[]'::jsonb),
    'apps', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'orgId', a.org_id, 'authorId', a.author_id, 'title', v.title,
        'area', v.category_id, 'desc', v.description, 'longDesc', v.description, 'tagline', v.tagline,
        'impact', v.impact, 'dataNote', v.data_note, 'repoUrl', v.repo_url,
        'tech', coalesce((SELECT jsonb_agg(l.label ORDER BY l.position) FROM public.app_labels l WHERE l.app_id = a.id AND l.version = a.version AND l.kind = 'tech'), '[]'::jsonb),
        'tags', coalesce((SELECT jsonb_agg(l.label ORDER BY l.position) FROM public.app_labels l WHERE l.app_id = a.id AND l.version = a.version AND l.kind = 'tag'), '[]'::jsonb),
        'attachments', coalesce((SELECT jsonb_agg(jsonb_build_object('name', f.name, 'size', f.size, 'type', f.mime_type) ORDER BY f.position) FROM public.app_attachments f WHERE f.app_id = a.id AND f.version = a.version), '[]'::jsonb),
        'security', CASE WHEN a.review_status = 'approved' THEN '["Revision manual interna"]'::jsonb ELSE '[]'::jsonb END,
        'metrics', jsonb_build_object('hours', a.estimated_hours, 'users', a.estimated_users, 'rating', '-'),
        'reviewStatus', a.review_status, 'maturity', 'new', 'version', a.version,
        'ticket', 'APP-' || left(a.id::text, 8), 'createdAt', a.created_at, 'updatedAt', a.updated_at, 'environment', a.environment
      ) ORDER BY a.created_at DESC)
      FROM public.apps a JOIN public.app_versions v ON v.app_id = a.id AND v.version = a.version
      WHERE public.tk_can_read_app(a.id)
    ), '[]'::jsonb),
    'reviews', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'appId', r.app_id, 'reviewerId', r.reviewer_id, 'reviewerName', r.reviewer_name,
        'action', r.action, 'reason', r.reason, 'environment', r.environment, 'version', r.version,
        'createdAt', r.created_at, 'checks', jsonb_build_object('security', r.security_checked, 'data', r.data_checked)
      ) ORDER BY r.created_at DESC)
      FROM (SELECT * FROM public.reviews WHERE public.tk_can_read_app(app_id)
        AND identity->>'role' <> 'catalog' ORDER BY created_at DESC LIMIT 2000) r
    ), '[]'::jsonb),
    'events', coalesce((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', e.id, 'orgId', e.org_id, 'appId', e.app_id, 'actorId', e.actor_id, 'actorName', e.actor_name,
        'action', e.action, 'createdAt', e.created_at
      )) ORDER BY e.created_at DESC)
      FROM (SELECT e.* FROM public.audit_events e
        JOIN public.organizations o ON o.id = e.org_id AND o.deleted_at IS NULL
        WHERE public.tk_can_access(e.org_id) AND identity->>'role' <> 'catalog'
          AND (e.app_id IS NULL OR public.tk_can_read_app(e.app_id))
          AND (identity->>'role' IN ('admin', 'superadmin') OR e.actor_id::text = identity->>'userId' OR e.app_id IS NOT NULL)
        ORDER BY e.created_at DESC LIMIT 200) e
    ), '[]'::jsonb),
    'plans', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price) ORDER BY name) FROM public.plans), '[]'::jsonb),
    'policies', coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', p.id, 'orgId', p.org_id, 'name', p.name, 'description', p.description, 'enabled', p.enabled,
      'version', p.version, 'createdAt', p.created_at, 'updatedAt', p.updated_at
    )) ORDER BY p.created_at) FROM public.policies p
      WHERE p.deleted_at IS NULL AND (p.org_id IS NULL OR public.tk_can_access(p.org_id))), '[]'::jsonb),
    'categories', (SELECT jsonb_agg(jsonb_build_object('id', id, 'label', label) ORDER BY label) FROM public.categories)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.tk_command(p_action text, p_id uuid DEFAULT NULL, p_fields jsonb DEFAULT '{}'::jsonb, p_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
<<cmd>>
DECLARE
  identity jsonb := public.tk_identity();
  actor public.users;
  target public.users;
  org public.organizations;
  app public.apps;
  policy public.policies;
  result_id uuid := coalesce(p_id, gen_random_uuid());
  org_id uuid;
  author_id uuid;
  invite_id uuid;
  decision text;
  f jsonb;
  position integer;
  attachment_count integer;
  attachment_bytes bigint;
BEGIN
  IF identity IS NULL THEN RAISE EXCEPTION 'La sesion no tiene acceso.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO actor FROM public.users WHERE id = (identity->>'userId')::uuid FOR SHARE;
  IF jsonb_typeof(p_fields) <> 'object' THEN RAISE EXCEPTION 'Datos no validos.' USING ERRCODE = '22023'; END IF;

  IF p_action IN ('createSubmission', 'updateSubmission', 'saveManagedApp', 'reviewApp', 'deleteManagedApp') THEN
    IF p_id IS NOT NULL THEN
      SELECT * INTO app FROM public.apps WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Aplicacion no disponible.'; END IF;
      org_id := app.org_id;
      IF p_version IS DISTINCT FROM app.version THEN RAISE EXCEPTION 'La aplicacion cambio de version. Recarga el formulario.' USING ERRCODE = '40001'; END IF;
    ELSE
      org_id := CASE WHEN p_action = 'createSubmission' THEN actor.org_id ELSE (p_fields->>'orgId')::uuid END;
    END IF;
    IF p_action IN ('createSubmission', 'updateSubmission') THEN
      IF actor.role <> 'developer' OR cmd.org_id <> actor.org_id
        OR (p_id IS NOT NULL AND (app.author_id <> actor.id OR app.review_status <> 'changes_requested')) THEN
        RAISE EXCEPTION 'Solo puedes enviar o corregir tus propias aplicaciones.' USING ERRCODE = '42501';
      END IF;
      IF (p_action = 'createSubmission' AND p_id IS NOT NULL) OR (p_action = 'updateSubmission' AND p_id IS NULL) THEN
        RAISE EXCEPTION 'Operacion de envio no valida.' USING ERRCODE = '22023';
      END IF;
      author_id := actor.id;
    ELSE
      IF NOT public.tk_can_access(cmd.org_id, true) THEN RAISE EXCEPTION 'No puedes administrar esta empresa.' USING ERRCODE = '42501'; END IF;
      IF p_action = 'saveManagedApp' THEN
        author_id := (p_fields->>'authorId')::uuid;
        IF p_id IS NOT NULL AND (p_fields->>'orgId')::uuid <> app.org_id THEN RAISE EXCEPTION 'No puedes trasladar la aplicacion a otra empresa.'; END IF;
      END IF;
    END IF;
    SELECT * INTO org FROM public.organizations WHERE id = cmd.org_id AND deleted_at IS NULL;
    IF NOT FOUND OR org.status NOT IN ('active', 'active-amber') THEN RAISE EXCEPTION 'La organizacion no esta activa.' USING ERRCODE = '42501'; END IF;

    IF p_action = 'reviewApp' THEN
      decision := p_fields->>'action';
      IF p_id IS NULL OR app.review_status <> 'pending_review' THEN RAISE EXCEPTION 'Este envio ya fue revisado.' USING ERRCODE = '40001'; END IF;
      IF decision NOT IN ('approved', 'rejected', 'changes_requested') OR decision IS NULL THEN RAISE EXCEPTION 'Decision no valida.'; END IF;
      IF decision = 'approved' AND NOT coalesce(p_fields->'checks' @> '{"security": true, "data": true}'::jsonb, false) THEN
        RAISE EXCEPTION 'Confirma las dos comprobaciones manuales obligatorias.';
      END IF;
      INSERT INTO public.reviews(app_id, org_id, version, reviewer_id, reviewer_name, action, reason, environment, security_checked, data_checked)
      VALUES(app.id, cmd.org_id, app.version, actor.id, actor.name, decision, btrim(coalesce(p_fields->>'reason', '')),
        btrim(coalesce(p_fields->>'environment', '')), coalesce((p_fields->'checks'->>'security')::boolean, false),
        coalesce((p_fields->'checks'->>'data')::boolean, false));
      UPDATE public.apps SET review_status = decision, updated_at = now(),
        environment = CASE WHEN decision = 'approved' THEN btrim(coalesce(p_fields->>'environment', '')) ELSE '' END WHERE id = app.id;
    ELSIF p_action = 'deleteManagedApp' THEN
      IF p_id IS NULL THEN RAISE EXCEPTION 'Aplicacion no disponible.'; END IF;
      UPDATE public.apps SET deleted_at = now(), updated_at = now() WHERE id = app.id;
    ELSE
      IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = cmd.author_id AND u.org_id = cmd.org_id AND u.role = 'developer' AND u.enabled AND u.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'Selecciona un creador habilitado de esta empresa.';
      END IF;
      IF p_id IS NULL THEN
        INSERT INTO public.apps(id, org_id, author_id) VALUES(result_id, cmd.org_id, cmd.author_id);
        app.version := 1;
      ELSE
        app.version := app.version + 1;
        UPDATE public.apps SET version = app.version, author_id = cmd.author_id, review_status = 'pending_review',
          environment = '', updated_at = now() WHERE id = p_id;
      END IF;
      IF p_action = 'saveManagedApp' THEN
        UPDATE public.apps SET estimated_hours = (p_fields->>'hours')::integer, estimated_users = (p_fields->>'users')::integer WHERE id = result_id;
      END IF;
      INSERT INTO public.app_versions(app_id, org_id, version, author_id, title, description, category_id, tagline, impact, data_note, repo_url, generated_html)
      VALUES(result_id, cmd.org_id, app.version, cmd.author_id, btrim(p_fields->>'title'), btrim(p_fields->>'desc'), p_fields->>'area',
        btrim(coalesce(p_fields->>'tagline', '')), btrim(coalesce(p_fields->>'impact', '')), btrim(coalesce(p_fields->>'dataNote', '')),
        btrim(coalesce(p_fields->>'repoUrl', '')),
        CASE WHEN p_fields ? 'generatedHtml' THEN p_fields->>'generatedHtml'
          WHEN p_id IS NOT NULL THEN (SELECT v.generated_html FROM public.app_versions v WHERE v.app_id = p_id AND v.version = app.version - 1) END);
      IF p_fields ? 'aiTool' THEN
        IF btrim(coalesce(p_fields->>'aiTool', '')) <> '' THEN
          INSERT INTO public.app_labels VALUES(result_id, cmd.org_id, app.version, 'tech', 0, btrim(p_fields->>'aiTool'));
        END IF;
      ELSIF p_id IS NOT NULL THEN
        INSERT INTO public.app_labels SELECT l.app_id, l.org_id, app.version, l.kind, l.position, l.label
          FROM public.app_labels l WHERE l.app_id = p_id AND l.version = app.version - 1;
      END IF;
      IF p_fields ? 'attachments' THEN
        IF jsonb_typeof(p_fields->'attachments') <> 'array' THEN RAISE EXCEPTION 'Adjuntos no validos.'; END IF;
        SELECT count(*), coalesce(sum((x->>'size')::bigint), 0) INTO attachment_count, attachment_bytes
          FROM jsonb_array_elements(p_fields->'attachments') x;
        IF attachment_count > 10 OR attachment_bytes > 26214400 THEN RAISE EXCEPTION 'Los adjuntos superan el limite permitido.'; END IF;
        position := 0;
        FOR f IN SELECT value FROM jsonb_array_elements(p_fields->'attachments') LOOP
          INSERT INTO public.app_attachments VALUES(result_id, cmd.org_id, app.version, cmd.position, btrim(f->>'name'), (f->>'size')::bigint, coalesce(f->>'type', ''));
          position := position + 1;
        END LOOP;
      ELSIF p_id IS NOT NULL THEN
        INSERT INTO public.app_attachments SELECT f.app_id, f.org_id, app.version, f.position, f.name, f.size, f.mime_type
          FROM public.app_attachments f WHERE f.app_id = p_id AND f.version = app.version - 1;
      END IF;
    END IF;
    INSERT INTO public.audit_events(org_id, app_id, actor_id, actor_name, action) VALUES(cmd.org_id, result_id, actor.id, actor.name, p_action);

  ELSIF p_action IN ('createOrganization', 'updateOrganization', 'deleteOrganization', 'setOrganizationStatus') THEN
    IF actor.role <> 'superadmin' THEN RAISE EXCEPTION 'Solo el superadministrador puede gestionar empresas.' USING ERRCODE = '42501'; END IF;
    IF p_action = 'createOrganization' THEN
      IF p_id IS NOT NULL THEN RAISE EXCEPTION 'Operacion no valida.'; END IF;
      invite_id := gen_random_uuid();
      INSERT INTO public.organizations(id, name, domain, plan_id, admin_id) VALUES(result_id, btrim(p_fields->>'name'),
        lower(btrim(coalesce(p_fields->>'domain', ''))), (p_fields->>'plan')::uuid, invite_id);
      INSERT INTO public.users(id, org_id, name, email, username, role, dept) VALUES(invite_id, result_id, btrim(p_fields->>'email'),
        lower(btrim(p_fields->>'email')), 'admin-' || left(replace(invite_id::text, '-', ''), 12), 'admin', 'Administracion');
    ELSE
      SELECT * INTO org FROM public.organizations WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Organizacion no disponible.'; END IF;
      IF p_action IN ('deleteOrganization', 'setOrganizationStatus') AND org.is_system THEN RAISE EXCEPTION 'No puedes suspender o archivar la plataforma.'; END IF;
      IF p_action = 'deleteOrganization' THEN
        IF p_id = actor.org_id THEN RAISE EXCEPTION 'No puedes archivar tu propia empresa.'; END IF;
        UPDATE public.organizations SET deleted_at = now(), status = 'suspended' WHERE id = p_id;
        UPDATE public.users u SET enabled = false WHERE u.org_id = p_id;
      ELSIF p_action = 'setOrganizationStatus' THEN
        IF p_fields->>'status' NOT IN ('active', 'suspended') OR p_fields->>'status' IS NULL THEN RAISE EXCEPTION 'Estado no valido.'; END IF;
        UPDATE public.organizations SET status = p_fields->>'status' WHERE id = p_id;
      ELSE
        IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = (p_fields->>'adminId')::uuid AND u.org_id = p_id AND u.role IN ('admin', 'superadmin') AND u.enabled AND u.deleted_at IS NULL) THEN
          RAISE EXCEPTION 'Selecciona un administrador habilitado de esta empresa.';
        END IF;
        IF org.is_system AND p_fields->>'status' NOT IN ('active', 'active-amber') THEN RAISE EXCEPTION 'La plataforma debe permanecer activa.'; END IF;
        IF (p_fields->>'members')::integer < (SELECT count(*) FROM public.users u WHERE u.org_id = p_id AND u.deleted_at IS NULL) THEN
          RAISE EXCEPTION 'El numero de miembros no puede ser inferior a los usuarios registrados.';
        END IF;
        IF lower(btrim(p_fields->>'email')) IS DISTINCT FROM (SELECT email_key FROM public.users WHERE id = (p_fields->>'adminId')::uuid) THEN
          RAISE EXCEPTION 'El correo de acceso no se cambia desde la organizacion.';
        END IF;
        UPDATE public.organizations SET name = btrim(p_fields->>'name'), domain = lower(btrim(coalesce(p_fields->>'domain', ''))),
          plan_id = (p_fields->>'plan')::uuid, admin_id = (p_fields->>'adminId')::uuid, status = p_fields->>'status' WHERE id = p_id;
      END IF;
    END IF;
    INSERT INTO public.audit_events(org_id, actor_id, actor_name, action) VALUES(result_id, actor.id, actor.name, p_action);

  ELSIF p_action IN ('saveUser', 'deleteUser', 'setUserEnabled', 'inviteUser') THEN
    IF actor.role NOT IN ('admin', 'superadmin') THEN RAISE EXCEPTION 'No puedes administrar cuentas.' USING ERRCODE = '42501'; END IF;
    IF p_id IS NOT NULL THEN
      SELECT * INTO target FROM public.users WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no disponible.'; END IF;
      IF NOT public.tk_can_access(target.org_id, true) OR (actor.role = 'admin' AND target.role NOT IN ('developer', 'catalog')) THEN
        RAISE EXCEPTION 'No puedes administrar esta cuenta.' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF p_action = 'saveUser' THEN
      org_id := (p_fields->>'orgId')::uuid;
      IF NOT public.tk_can_access(cmd.org_id, true) OR (actor.role = 'admin' AND p_fields->>'role' NOT IN ('developer', 'catalog')) THEN
        RAISE EXCEPTION 'No puedes asignar ese rol o empresa.' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id = cmd.org_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Organizacion no disponible.'; END IF;
      IF p_id IS NOT NULL THEN
        IF target.id = actor.id AND (target.role IS DISTINCT FROM p_fields->>'role' OR target.org_id IS DISTINCT FROM cmd.org_id) THEN RAISE EXCEPTION 'No puedes cambiar tu propio rol o empresa.'; END IF;
        IF target.org_id <> cmd.org_id AND (EXISTS(SELECT 1 FROM public.apps a WHERE a.author_id = target.id)
          OR EXISTS(SELECT 1 FROM public.app_versions v WHERE v.author_id = target.id)
          OR EXISTS(SELECT 1 FROM public.audit_events WHERE actor_id = target.id)) THEN
          RAISE EXCEPTION 'La cuenta tiene historial en su empresa. No puede trasladarse.';
        END IF;
        IF target.email_key IS DISTINCT FROM lower(btrim(p_fields->>'email')) THEN RAISE EXCEPTION 'El correo de acceso requiere un cambio verificado, no una edicion de perfil.'; END IF;
        IF target.role = 'superadmin' AND p_fields->>'role' <> 'superadmin' THEN
          PERFORM pg_advisory_xact_lock(71526410);
          IF NOT EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id = u.auth_user_id AND a.email_verified
            WHERE u.id <> target.id AND u.role = 'superadmin' AND u.enabled AND u.deleted_at IS NULL) THEN
            RAISE EXCEPTION 'Debe permanecer otro superadministrador activado.';
          END IF;
        END IF;
        UPDATE public.users SET name = btrim(p_fields->>'name'), dept = btrim(coalesce(p_fields->>'dept', '')),
          role = p_fields->>'role', org_id = cmd.org_id, username = btrim(p_fields->>'username') WHERE id = p_id;
      ELSE
        INSERT INTO public.users(id, org_id, role, name, email, username, dept) VALUES(result_id, cmd.org_id, p_fields->>'role',
          btrim(p_fields->>'name'), lower(btrim(p_fields->>'email')), btrim(p_fields->>'username'), btrim(coalesce(p_fields->>'dept', '')));
        invite_id := result_id;
      END IF;
    ELSE
      IF p_id IS NULL THEN RAISE EXCEPTION 'Usuario no disponible.'; END IF;
      org_id := target.org_id;
      IF p_action = 'inviteUser' THEN
        IF NOT target.enabled THEN RAISE EXCEPTION 'Habilita la cuenta antes de enviar la activacion.'; END IF;
        invite_id := target.id;
      ELSE
        IF target.id = actor.id THEN RAISE EXCEPTION 'No puedes desactivar tu propio acceso.'; END IF;
        IF target.role = 'superadmin' AND (p_action = 'deleteUser' OR (p_fields->>'enabled')::boolean IS DISTINCT FROM true) THEN
          PERFORM pg_advisory_xact_lock(71526410);
          IF NOT EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id = u.auth_user_id AND a.email_verified
            WHERE u.id <> target.id AND u.role = 'superadmin' AND u.enabled AND u.deleted_at IS NULL) THEN
            RAISE EXCEPTION 'Debe permanecer otro superadministrador activado.';
          END IF;
        END IF;
        IF p_action = 'deleteUser' THEN
          IF EXISTS(SELECT 1 FROM public.apps a WHERE a.author_id = target.id) OR EXISTS(SELECT 1 FROM public.reviews WHERE reviewer_id = target.id) THEN
            RAISE EXCEPTION 'La cuenta tiene aplicaciones o revisiones. Desactiva su acceso sin eliminar el historial.';
          END IF;
          UPDATE public.users SET enabled = false, deleted_at = now() WHERE id = p_id;
        ELSE
          IF jsonb_typeof(p_fields->'enabled') <> 'boolean' THEN RAISE EXCEPTION 'Estado de cuenta no valido.'; END IF;
          UPDATE public.users SET enabled = (p_fields->>'enabled')::boolean WHERE id = p_id;
        END IF;
      END IF;
    END IF;
    INSERT INTO public.audit_events(org_id, actor_id, actor_name, action) VALUES(cmd.org_id, actor.id, actor.name, p_action);

  ELSIF p_action IN ('saveCompanyProfile', 'deleteCompanyProfile', 'saveBrand') THEN
    org_id := CASE WHEN p_action = 'saveBrand' THEN actor.org_id ELSE p_id END;
    IF NOT public.tk_can_access(cmd.org_id, true) THEN RAISE EXCEPTION 'No puedes administrar esta empresa.' USING ERRCODE = '42501'; END IF;
    SELECT * INTO org FROM public.organizations WHERE id = cmd.org_id AND deleted_at IS NULL AND status IN ('active', 'active-amber') FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'La organizacion no esta activa.'; END IF;
    IF p_action = 'deleteCompanyProfile' THEN
      DELETE FROM public.company_profiles p WHERE p.org_id = cmd.org_id;
    ELSIF p_action = 'saveBrand' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(p_fields)) <> 12 THEN RAISE EXCEPTION 'Tokens de marca no validos.'; END IF;
      FOR f IN SELECT jsonb_build_object('key', key, 'value', value) FROM jsonb_each_text(p_fields) LOOP
        IF jsonb_typeof(p_fields->(f->>'key')) IS DISTINCT FROM 'string'
          OR f->>'key' NOT IN ('displayFont', 'bodyFont', 'rCard', 'rSm', 'accent', 'bg', 'card', 'fg', 'fgSoft', 'line', 'green', 'amber')
          OR (f->>'key' IN ('displayFont', 'bodyFont') AND f->>'value' !~ '^[a-zA-Z0-9 ,"''-]+$')
          OR (f->>'key' IN ('rCard', 'rSm') AND f->>'value' !~ '^[0-9]{1,3}px$')
          OR (f->>'key' IN ('accent', 'bg', 'card', 'fg', 'fgSoft', 'line', 'green', 'amber') AND f->>'value' !~* '^#[0-9a-f]{6}$')
        THEN RAISE EXCEPTION 'Token de marca no valido.'; END IF;
      END LOOP;
      INSERT INTO public.organization_branding VALUES(cmd.org_id, p_fields) ON CONFLICT ON CONSTRAINT organization_branding_pkey DO UPDATE SET tokens = EXCLUDED.tokens;
    ELSE
      UPDATE public.organizations SET name = btrim(p_fields->>'name'), domain = lower(btrim(coalesce(p_fields->>'domain', ''))) WHERE id = cmd.org_id;
      INSERT INTO public.company_profiles VALUES(cmd.org_id, btrim(coalesce(p_fields->>'bio', '')),
        btrim(coalesce(p_fields->>'bannerTitle', '')), btrim(coalesce(p_fields->>'bannerDesc', '')))
      ON CONFLICT ON CONSTRAINT company_profiles_pkey DO UPDATE SET bio = EXCLUDED.bio, banner_title = EXCLUDED.banner_title, banner_desc = EXCLUDED.banner_desc;
    END IF;
    result_id := org_id;
    INSERT INTO public.audit_events(org_id, actor_id, actor_name, action) VALUES(cmd.org_id, actor.id, actor.name, p_action);

  ELSIF p_action IN ('savePlan', 'deletePlan', 'savePolicy', 'deletePolicy', 'saveGovernancePolicy', 'deleteGovernancePolicy') THEN
    IF p_action IN ('savePlan', 'deletePlan', 'savePolicy', 'deletePolicy') THEN
      IF actor.role <> 'superadmin' THEN RAISE EXCEPTION 'Solo el superadministrador puede modificar la configuracion global.' USING ERRCODE = '42501'; END IF;
      org_id := NULL;
    ELSE
      org_id := actor.org_id;
      IF NOT public.tk_can_access(cmd.org_id, true) THEN RAISE EXCEPTION 'No puedes modificar politicas.' USING ERRCODE = '42501'; END IF;
    END IF;
    IF p_action = 'savePlan' THEN
      IF p_id IS NULL THEN INSERT INTO public.plans(id, name, price) VALUES(result_id, btrim(p_fields->>'name'), (p_fields->>'price')::numeric);
      ELSE UPDATE public.plans SET name = btrim(p_fields->>'name'), price = (p_fields->>'price')::numeric WHERE id = p_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Plan no disponible.'; END IF;
      END IF;
    ELSIF p_action = 'deletePlan' THEN
      DELETE FROM public.plans WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Plan no disponible.'; END IF;
    ELSE
      IF p_id IS NOT NULL THEN
        SELECT p.* INTO policy FROM public.policies p WHERE p.id = p_id AND p.org_id IS NOT DISTINCT FROM cmd.org_id AND p.deleted_at IS NULL FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Politica no disponible en este ambito.' USING ERRCODE = '42501'; END IF;
        IF p_action IN ('saveGovernancePolicy', 'deleteGovernancePolicy') AND p_version IS DISTINCT FROM policy.version THEN
          RAISE EXCEPTION 'La politica cambio de version. Recarga el formulario.' USING ERRCODE = '40001';
        END IF;
      END IF;
      IF p_action IN ('deletePolicy', 'deleteGovernancePolicy') THEN
        IF p_id IS NULL THEN RAISE EXCEPTION 'Politica no disponible.'; END IF;
        UPDATE public.policies SET deleted_at = now(), updated_at = now() WHERE id = p_id;
      ELSE
        IF jsonb_typeof(p_fields->'enabled') <> 'boolean' THEN RAISE EXCEPTION 'Estado de politica no valido.'; END IF;
        IF p_id IS NULL THEN
          INSERT INTO public.policies(id, org_id, name, description, enabled) VALUES(result_id, cmd.org_id,
            btrim(p_fields->>'name'), btrim(coalesce(p_fields->>'description', '')), (p_fields->>'enabled')::boolean);
          policy.version := 1;
        ELSE
          policy.version := policy.version + 1;
          UPDATE public.policies SET name = btrim(p_fields->>'name'), description = btrim(coalesce(p_fields->>'description', '')),
            enabled = (p_fields->>'enabled')::boolean, version = policy.version, updated_at = now() WHERE id = p_id;
        END IF;
        INSERT INTO public.policy_versions(policy_id, version, name, description, enabled, actor_id) VALUES(result_id, policy.version,
          btrim(p_fields->>'name'), btrim(coalesce(p_fields->>'description', '')), (p_fields->>'enabled')::boolean, actor.id);
      END IF;
    END IF;
    INSERT INTO public.audit_events(org_id, actor_id, actor_name, action) VALUES(coalesce(cmd.org_id, actor.org_id), actor.id, actor.name, p_action);
  ELSE
    RAISE EXCEPTION 'Operacion no admitida.' USING ERRCODE = '22023';
  END IF;
  PERFORM nextval('public.workspace_change_seq');
  RETURN jsonb_strip_nulls(jsonb_build_object('id', result_id, 'invitationUserId', invite_id));
END;
$$;

CREATE FUNCTION public.tk_auth_throttle(p_key text, p_limit integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE n integer;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 100 OR p_key !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Limite no valido.'; END IF;
  DELETE FROM public.auth_attempts WHERE key IN (SELECT key FROM public.auth_attempts WHERE expires_at < now() ORDER BY expires_at LIMIT 100);
  INSERT INTO public.auth_attempts(key, attempts, expires_at) VALUES(p_key, 1, now() + interval '15 minutes')
  ON CONFLICT(key) DO UPDATE SET
    attempts = CASE WHEN auth_attempts.expires_at < now() THEN 1 ELSE auth_attempts.attempts + 1 END,
    expires_at = CASE WHEN auth_attempts.expires_at < now() THEN now() + interval '15 minutes' ELSE auth_attempts.expires_at END
  RETURNING attempts INTO n;
  RETURN n <= p_limit;
END;
$$;
CREATE FUNCTION public.tk_invitation_target(p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object('email', u.email, 'name', u.name, 'authUserId', u.auth_user_id, 'verified', coalesce(a.email_verified, false))
  FROM public.users u LEFT JOIN auth.users a ON a.id = u.auth_user_id
  JOIN public.organizations o ON o.id = u.org_id
  WHERE u.id = p_user_id AND u.enabled AND u.deleted_at IS NULL AND o.deleted_at IS NULL
$$;
CREATE FUNCTION public.tk_mark_invitation(p_user_id uuid, p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_state NOT IN ('sent', 'failed') THEN RAISE EXCEPTION 'Estado de invitacion no valido.'; END IF;
  UPDATE public.users SET invitation_state = p_state WHERE id = p_user_id;
  PERFORM nextval('public.workspace_change_seq');
END;
$$;
CREATE FUNCTION public.tk_bootstrap(p_email text, p_username text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE p uuid := gen_random_uuid(); o uuid := gen_random_uuid(); u uuid := gen_random_uuid();
BEGIN
  PERFORM pg_advisory_xact_lock(71526410);
  IF EXISTS(SELECT 1 FROM public.users WHERE role = 'superadmin') THEN RAISE EXCEPTION 'La plataforma ya tiene un superadministrador.'; END IF;
  INSERT INTO public.plans VALUES(p, 'Inicial', 0);
  INSERT INTO public.organizations(id, name, plan_id, admin_id, is_system) VALUES(o, 'Tektonik hub - Plataforma', p, u, true);
  INSERT INTO public.users(id, org_id, email, username, role, name, dept) VALUES(u, o, lower(btrim(p_email)), p_username,
    'superadmin', 'Administrador de plataforma', 'Plataforma');
  RETURN jsonb_build_object('userId', u, 'orgId', o);
END;
$$;

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.plans, public.organizations, public.users, public.company_profiles, public.organization_branding,
  public.categories, public.apps, public.app_versions, public.app_labels, public.app_attachments,
  public.reviews, public.audit_events, public.policies, public.policy_versions, public.auth_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.workspace_change_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.plans, public.organizations, public.users, public.company_profiles, public.organization_branding,
  public.categories, public.apps, public.app_versions, public.app_labels, public.app_attachments,
  public.reviews, public.audit_events, public.policies, public.policy_versions TO authenticated;

CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING ((SELECT public.tk_identity()) IS NOT NULL);
CREATE POLICY categories_read ON public.categories FOR SELECT TO authenticated USING ((SELECT public.tk_identity()) IS NOT NULL);
CREATE POLICY organizations_read ON public.organizations FOR SELECT TO authenticated USING (deleted_at IS NULL AND public.tk_can_access(id));
CREATE POLICY users_read ON public.users FOR SELECT TO authenticated USING (public.tk_can_access(org_id));
CREATE POLICY profiles_read ON public.company_profiles FOR SELECT TO authenticated USING (public.tk_can_access(org_id));
CREATE POLICY branding_read ON public.organization_branding FOR SELECT TO authenticated USING (public.tk_can_access(org_id));
CREATE POLICY apps_read ON public.apps FOR SELECT TO authenticated USING (public.tk_can_read_app(id));
CREATE POLICY versions_read ON public.app_versions FOR SELECT TO authenticated USING (
  public.tk_can_read_app(app_id) AND ((SELECT public.tk_identity()->>'role') IN ('admin', 'superadmin')
    OR ((SELECT public.tk_identity()->>'role') = 'developer' AND author_id::text = (SELECT public.tk_identity()->>'userId')))
);
CREATE POLICY labels_read ON public.app_labels FOR SELECT TO authenticated USING (
  public.tk_can_read_app(app_id) AND version = (SELECT a.version FROM public.apps a WHERE a.id = app_id)
);
CREATE POLICY attachments_read ON public.app_attachments FOR SELECT TO authenticated USING (
  public.tk_can_read_app(app_id) AND version = (SELECT a.version FROM public.apps a WHERE a.id = app_id)
);
CREATE POLICY reviews_read ON public.reviews FOR SELECT TO authenticated USING (public.tk_can_read_app(app_id) AND (SELECT public.tk_identity()->>'role') <> 'catalog');
CREATE POLICY events_read ON public.audit_events FOR SELECT TO authenticated USING (
  public.tk_can_access(org_id) AND (SELECT public.tk_identity()->>'role') <> 'catalog'
  AND (app_id IS NULL OR public.tk_can_read_app(app_id))
  AND ((SELECT public.tk_identity()->>'role') IN ('admin', 'superadmin') OR actor_id::text = (SELECT public.tk_identity()->>'userId') OR app_id IS NOT NULL)
);
CREATE POLICY policies_read ON public.policies FOR SELECT TO authenticated USING (
  deleted_at IS NULL AND (SELECT public.tk_identity()) IS NOT NULL AND (org_id IS NULL OR public.tk_can_access(org_id))
);
CREATE POLICY policy_versions_read ON public.policy_versions FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.policies p WHERE p.id = policy_id AND public.tk_can_access(p.org_id, true))
);

REVOKE ALL ON FUNCTION public.tk_identity(), public.tk_can_access(uuid, boolean), public.tk_can_read_app(uuid),
  public.tk_attach_auth_user(), public.tk_check_org_admin(), public.tk_check_user_integrity(), public.tk_append_only(),
  public.tk_workspace(), public.tk_command(text, uuid, jsonb, integer), public.tk_auth_throttle(text, integer),
  public.tk_invitation_target(uuid), public.tk_mark_invitation(uuid, text), public.tk_bootstrap(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tk_identity(), public.tk_can_access(uuid, boolean), public.tk_can_read_app(uuid),
  public.tk_workspace(), public.tk_command(text, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tk_auth_throttle(text, integer), public.tk_invitation_target(uuid),
  public.tk_mark_invitation(uuid, text), public.tk_bootstrap(text, text) TO project_admin;