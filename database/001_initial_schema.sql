-- Tektonik hub: propuesta inicial para PostgreSQL 15+.
-- Ejecutar solo en una base vacía dedicada, con el propietario de la migración.
-- Sin datos de demo, credenciales, roles de login ni integración auth de proveedor.
BEGIN;

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  name varchar(100) NOT NULL CHECK (length(btrim(name)) > 0),
  price numeric(12,2) CHECK (price >= 0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  billing_interval text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year','custom')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX plans_name_ci ON public.plans (lower(name));

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  domain varchar(253) CHECK (domain IS NULL OR domain ~* '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$'),
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  health_status text NOT NULL DEFAULT 'normal' CHECK (health_status IN ('normal','warning')),
  admin_id uuid NOT NULL,
  declared_member_count integer CHECK (declared_member_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE UNIQUE INDEX organizations_name_ci ON public.organizations (lower(name));
CREATE UNIQUE INDEX organizations_domain_ci ON public.organizations (lower(domain)) WHERE domain IS NOT NULL;
CREATE INDEX organizations_plan_idx ON public.organizations(plan_id);

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  email varchar(254) NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  department varchar(120) NOT NULL DEFAULT '',
  bio varchar(2000) NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('developer','catalog','admin','superadmin')),
  preferred_language text NOT NULL DEFAULT 'es' CHECK (preferred_language IN ('es','en')),
  auth_provider text,
  auth_subject text,
  last_access_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  UNIQUE (org_id,id),
  UNIQUE (auth_provider,auth_subject),
  CHECK ((auth_provider IS NULL) = (auth_subject IS NULL))
);
CREATE UNIQUE INDEX users_email_ci ON public.users(lower(email));
CREATE INDEX users_org_role_idx ON public.users(org_id,role);
ALTER TABLE public.organizations ADD CONSTRAINT organizations_admin_fk
  FOREIGN KEY (id,admin_id) REFERENCES public.users(org_id,id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.organization_profiles (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  bio varchar(2000) NOT NULL DEFAULT '',
  banner_title varchar(160) NOT NULL DEFAULT '',
  banner_description varchar(2000) NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_branding (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  tokens jsonb NOT NULL CHECK (jsonb_typeof(tokens) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  max_upload_files integer NOT NULL DEFAULT 10 CHECK (max_upload_files BETWEEN 0 AND 100),
  max_upload_bytes bigint NOT NULL DEFAULT 26214400 CHECK (max_upload_bytes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.categories (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]+$'),
  label varchar(120) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE public.policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  org_id uuid REFERENCES public.organizations(id),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  description varchar(3000) NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX policies_org_idx ON public.policies(org_id);

CREATE TABLE public.apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  author_id uuid NOT NULL,
  ticket varchar(120) NOT NULL UNIQUE,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  review_status text NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review','changes_requested','rejected','approved')),
  maturity text NOT NULL DEFAULT 'new' CHECK (maturity IN ('approved','beta','new')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id,id),
  FOREIGN KEY (org_id,author_id) REFERENCES public.users(org_id,id)
);
CREATE INDEX apps_author_idx ON public.apps(org_id,author_id);
CREATE INDEX apps_queue_idx ON public.apps(org_id,review_status,updated_at) WHERE deleted_at IS NULL;

CREATE TABLE public.app_versions (
  app_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  org_id uuid NOT NULL,
  category_id text NOT NULL REFERENCES public.categories(id),
  title varchar(60) NOT NULL CHECK (length(btrim(title)) > 0),
  description varchar(800) NOT NULL CHECK (length(btrim(description)) >= 30),
  long_description text NOT NULL DEFAULT '',
  tagline varchar(100) NOT NULL DEFAULT '',
  impact varchar(500) NOT NULL DEFAULT '',
  data_note varchar(2000) NOT NULL DEFAULT '',
  repository_url varchar(1000) CHECK (repository_url IS NULL OR repository_url ~* '^https?://[^[:space:]]+$'),
  generated_html text CHECK (generated_html IS NULL OR length(generated_html) <= 300000),
  dashboard_config jsonb CHECK (dashboard_config IS NULL OR jsonb_typeof(dashboard_config) = 'object'),
  engine text CHECK (engine IS NULL OR engine IN ('demo','azure-openai')),
  model varchar(128),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id,version),
  FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
);
CREATE INDEX app_versions_category_idx ON public.app_versions(category_id);
CREATE INDEX app_versions_org_idx ON public.app_versions(org_id);
CREATE INDEX app_versions_creator_idx ON public.app_versions(created_by);
ALTER TABLE public.apps ADD CONSTRAINT apps_current_version_fk
  FOREIGN KEY (id,current_version) REFERENCES public.app_versions(app_id,version) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.app_version_labels (
  app_id uuid NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tag','technology')),
  label varchar(120) NOT NULL CHECK (length(btrim(label)) > 0),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY (app_id,version,kind,label),
  FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version)
);
CREATE TABLE public.files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  uploaded_by uuid NOT NULL,
  name varchar(255) NOT NULL CHECK (length(btrim(name)) > 0),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  mime_type varchar(128) NOT NULL DEFAULT '',
  storage_bucket text,
  storage_key text,
  sha256 char(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,id),
  UNIQUE (storage_bucket,storage_key),
  FOREIGN KEY (org_id,uploaded_by) REFERENCES public.users(org_id,id),
  CHECK ((storage_bucket IS NULL) = (storage_key IS NULL))
);
CREATE INDEX files_uploader_idx ON public.files(org_id,uploaded_by);
CREATE TABLE public.app_version_files (
  app_id uuid NOT NULL,
  version integer NOT NULL,
  org_id uuid NOT NULL,
  file_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY (app_id,version,file_id),
  FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version),
  FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id),
  FOREIGN KEY (org_id,file_id) REFERENCES public.files(org_id,id)
);
CREATE INDEX app_version_files_file_idx ON public.app_version_files(org_id,file_id);

CREATE TABLE public.app_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  app_id uuid NOT NULL,
  version integer NOT NULL,
  reviewer_id uuid NOT NULL REFERENCES public.users(id),
  action text NOT NULL CHECK (action IN ('approved','rejected','changes_requested')),
  reason varchar(3000) NOT NULL DEFAULT '',
  environment varchar(200) NOT NULL DEFAULT '',
  manual_security_checked boolean NOT NULL DEFAULT false,
  manual_data_checked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app_id,version),
  UNIQUE (app_id,version,id),
  FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version),
  CHECK (action = 'approved' OR length(btrim(reason)) > 0),
  CHECK (action <> 'approved' OR (manual_security_checked AND manual_data_checked))
);
CREATE INDEX app_reviews_reviewer_idx ON public.app_reviews(reviewer_id);
CREATE TABLE public.app_security_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  version integer NOT NULL,
  review_id uuid,
  label varchar(200) NOT NULL,
  certificate_reference varchar(200),
  evidence_url text,
  source text NOT NULL CHECK (source IN ('demo','manual','scanner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version),
  FOREIGN KEY (app_id,version,review_id) REFERENCES public.app_reviews(app_id,version,id)
);
CREATE INDEX app_security_version_idx ON public.app_security_evidence(app_id,version);
CREATE INDEX app_security_review_idx ON public.app_security_evidence(review_id);

CREATE TABLE public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_id uuid NOT NULL REFERENCES public.users(id),
  app_id uuid,
  action varchar(120) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
);
CREATE INDEX audit_events_org_date_idx ON public.audit_events(org_id,created_at DESC);
CREATE INDEX audit_events_app_idx ON public.audit_events(app_id);
CREATE INDEX audit_events_actor_idx ON public.audit_events(actor_id);

CREATE TABLE public.studio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_id text UNIQUE,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  owner_id uuid NOT NULL,
  title varchar(120) NOT NULL,
  current_version integer,
  submitted_app_id uuid,
  submitted_version integer,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,id),
  FOREIGN KEY (org_id,owner_id) REFERENCES public.users(org_id,id),
  FOREIGN KEY (org_id,submitted_app_id) REFERENCES public.apps(org_id,id),
  FOREIGN KEY (submitted_app_id,submitted_version) REFERENCES public.app_versions(app_id,version),
  CHECK ((submitted_app_id IS NULL) = (submitted_version IS NULL))
);
CREATE INDEX studio_projects_owner_idx ON public.studio_projects(org_id,owner_id);
CREATE INDEX studio_projects_submission_idx ON public.studio_projects(submitted_app_id,submitted_version);
CREATE TABLE public.studio_versions (
  project_id uuid NOT NULL REFERENCES public.studio_projects(id),
  version integer NOT NULL CHECK (version > 0),
  prompt varchar(2000) NOT NULL,
  generated_html text NOT NULL CHECK (length(generated_html) BETWEEN 1 AND 300000),
  dashboard_config jsonb CHECK (dashboard_config IS NULL OR jsonb_typeof(dashboard_config) = 'object'),
  engine text NOT NULL CHECK (engine IN ('demo','azure-openai')),
  model varchar(128),
  template varchar(80),
  spec jsonb CHECK (spec IS NULL OR jsonb_typeof(spec) = 'object'),
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id,version)
);
ALTER TABLE public.studio_projects ADD CONSTRAINT studio_current_version_fk
  FOREIGN KEY (id,current_version) REFERENCES public.studio_versions(project_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.studio_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id),
  position integer NOT NULL CHECK (position >= 0),
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  body text NOT NULL,
  version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,position),
  FOREIGN KEY (project_id,version) REFERENCES public.studio_versions(project_id,version)
);
CREATE TABLE public.studio_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.studio_projects(id),
  action varchar(120) NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX studio_activity_project_idx ON public.studio_activity(project_id,created_at);
CREATE TABLE public.llm_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  provider text NOT NULL DEFAULT 'azure-openai' CHECK (provider = 'azure-openai'),
  endpoint text NOT NULL CHECK (endpoint ~ '^https://[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com/?$'),
  deployment varchar(128) NOT NULL CHECK (deployment ~ '^[a-zA-Z0-9._-]{1,128}$'),
  api_version varchar(30) NOT NULL DEFAULT '2024-10-21' CHECK (api_version ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}(-preview)?$'),
  secret_reference text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_test_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id,provider)
);

-- Extensiones propuestas: no hay fuentes de medición reales en el frontend.
CREATE TABLE public.app_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL REFERENCES public.apps(id),
  observed_at timestamptz NOT NULL,
  hours_saved numeric(14,2) CHECK (hours_saved >= 0),
  active_users integer CHECK (active_users >= 0),
  rating numeric(3,2) CHECK (rating BETWEEN 1 AND 5),
  source text NOT NULL CHECK (source IN ('demo','manual','measured')),
  methodology text,
  UNIQUE (app_id,observed_at)
);
CREATE TABLE public.app_ratings (
  org_id uuid NOT NULL,
  app_id uuid NOT NULL,
  user_id uuid NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id,user_id),
  FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id),
  FOREIGN KEY (org_id,user_id) REFERENCES public.users(org_id,id)
);
CREATE INDEX app_ratings_user_idx ON public.app_ratings(org_id,user_id);
CREATE TABLE public.app_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  app_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('opened','execution_started','execution_completed','execution_failed')),
  duration_ms bigint CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id),
  FOREIGN KEY (org_id,user_id) REFERENCES public.users(org_id,id)
);
CREATE INDEX app_usage_app_date_idx ON public.app_usage_events(org_id,app_id,created_at);
CREATE INDEX app_usage_user_idx ON public.app_usage_events(org_id,user_id);
CREATE TABLE public.content_translations (
  page text NOT NULL CHECK (page IN ('index','login','profile','companyProfile','catalog','creator','admin','superAdmin')),
  locale text NOT NULL CHECK (locale IN ('es','en')),
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page,locale,key)
);

CREATE FUNCTION public.blk_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','users','organization_profiles','organization_branding','organization_settings','policies','apps','studio_projects','llm_connections','app_ratings','content_translations'] LOOP
    EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.blk_touch_updated_at()',t);
  END LOOP;
END $$;

CREATE FUNCTION public.blk_check_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations o LEFT JOIN public.users u ON u.id=o.admin_id AND u.org_id=o.id
    WHERE u.id IS NULL OR u.role NOT IN ('admin','superadmin') OR u.disabled_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cada organización requiere un administrador activo de la misma organización';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER check_organization_admin AFTER INSERT OR UPDATE ON public.organizations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.blk_check_admin();
CREATE CONSTRAINT TRIGGER check_user_admin AFTER INSERT OR UPDATE OR DELETE ON public.users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.blk_check_admin();

CREATE FUNCTION public.blk_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Historial inmutable: crear una nueva versión o usar borrado lógico'; END;
$$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['app_versions','app_version_labels','app_version_files','app_reviews','app_security_evidence','audit_events','studio_versions','studio_messages','studio_activity','app_usage_events'] LOOP
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.blk_append_only()',t);
  END LOOP;
END $$;

CREATE FUNCTION public.blk_protect_app_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN RAISE EXCEPTION 'Una aplicación no puede cambiar de organización'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_app_tenant BEFORE UPDATE ON public.apps FOR EACH ROW EXECUTE FUNCTION public.blk_protect_app_tenant();
CREATE FUNCTION public.blk_check_version_label() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.apps WHERE id=NEW.app_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.app_reviews WHERE app_id=NEW.app_id AND version=NEW.version) THEN
    RAISE EXCEPTION 'No se pueden añadir etiquetas a una versión ya revisada';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_version_label BEFORE INSERT ON public.app_version_labels FOR EACH ROW EXECUTE FUNCTION public.blk_check_version_label();
CREATE TRIGGER files_append_only BEFORE UPDATE OR DELETE ON public.files FOR EACH ROW EXECUTE FUNCTION public.blk_append_only();

CREATE FUNCTION public.blk_check_attachment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; bytes bigint; max_n integer; max_bytes bigint;
BEGIN
  PERFORM 1 FROM public.apps WHERE id=NEW.app_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.app_reviews WHERE app_id=NEW.app_id AND version=NEW.version) THEN
    RAISE EXCEPTION 'No se pueden añadir adjuntos a una versión ya revisada';
  END IF;
  SELECT coalesce(s.max_upload_files,10),coalesce(s.max_upload_bytes,26214400)
    INTO max_n,max_bytes FROM public.organizations o LEFT JOIN public.organization_settings s ON s.org_id=o.id WHERE o.id=NEW.org_id;
  SELECT count(*),coalesce(sum(f.byte_size),0) INTO n,bytes
    FROM public.app_version_files af JOIN public.files f ON f.id=af.file_id
    WHERE af.app_id=NEW.app_id AND af.version=NEW.version;
  SELECT bytes+byte_size INTO bytes FROM public.files WHERE id=NEW.file_id;
  IF n+1>max_n OR bytes>max_bytes THEN RAISE EXCEPTION 'Límite de adjuntos excedido'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER check_attachment BEFORE INSERT ON public.app_version_files FOR EACH ROW EXECUTE FUNCTION public.blk_check_attachment();

-- Solo backend de confianza: actor_id debe proceder de una sesión verificada, no del payload del navegador.
CREATE FUNCTION public.blk_review_app(p_app_id uuid,p_actor_id uuid,p_expected_version integer,
  p_action text,p_reason text DEFAULT '',p_environment text DEFAULT '',
  p_security_checked boolean DEFAULT false,p_data_checked boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a public.apps; u public.users; r uuid;
BEGIN
  SELECT * INTO a FROM public.apps WHERE id=p_app_id FOR UPDATE;
  IF NOT FOUND OR a.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Aplicación inexistente'; END IF;
  SELECT * INTO u FROM public.users WHERE id=p_actor_id;
  IF NOT FOUND OR u.disabled_at IS NOT NULL OR u.role NOT IN ('admin','superadmin') OR (u.role<>'superadmin' AND u.org_id<>a.org_id) THEN
    RAISE EXCEPTION 'Revisor no autorizado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=a.org_id AND status='active' AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Organización no activa';
  END IF;
  IF a.review_status<>'pending_review' OR a.current_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Conflicto de estado o versión'; END IF;
  INSERT INTO public.app_reviews(app_id,version,reviewer_id,action,reason,environment,manual_security_checked,manual_data_checked)
    VALUES (a.id,a.current_version,u.id,p_action,p_reason,p_environment,p_security_checked,p_data_checked) RETURNING id INTO r;
  UPDATE public.apps SET review_status=p_action WHERE id=a.id;
  INSERT INTO public.audit_events(org_id,actor_id,app_id,action,metadata)
    VALUES (a.org_id,u.id,a.id,p_action,jsonb_build_object('version',a.current_version,'review_id',r));
  RETURN r;
END;
$$;

CREATE VIEW public.catalog_apps WITH (security_invoker=true) AS
SELECT a.id,a.org_id,a.author_id,a.ticket,a.current_version,a.maturity,
  v.title,v.description,v.category_id,v.tagline,v.created_at AS version_created_at,a.updated_at
FROM public.apps a JOIN public.app_versions v ON v.app_id=a.id AND v.version=a.current_version
JOIN public.organizations o ON o.id=a.org_id
WHERE a.review_status='approved' AND a.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL;
CREATE VIEW public.organization_metrics WITH (security_invoker=true) AS
SELECT o.id AS org_id,
  (SELECT count(*) FROM public.users u WHERE u.org_id=o.id AND u.disabled_at IS NULL) AS registered_members,
  (SELECT count(*) FROM public.apps a WHERE a.org_id=o.id AND a.deleted_at IS NULL AND a.review_status='approved') AS approved_apps,
  (SELECT count(*) FROM public.apps a WHERE a.org_id=o.id AND a.deleted_at IS NULL AND a.review_status='pending_review') AS pending_apps
FROM public.organizations o WHERE o.deleted_at IS NULL;

-- Denegación por defecto: no dar acceso al navegador antes de integrar identidad y políticas por tenant.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['plans','organizations','users','organization_profiles','organization_branding','organization_settings','categories','policies','apps','app_versions','app_version_labels','files','app_version_files','app_reviews','app_security_evidence','audit_events','studio_projects','studio_versions','studio_messages','studio_activity','llm_connections','app_metric_snapshots','app_ratings','app_usage_events','content_translations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',t);
  END LOOP;
END $$;
REVOKE ALL ON public.catalog_apps,public.organization_metrics FROM PUBLIC;
REVOKE ALL ON FUNCTION public.blk_touch_updated_at(),public.blk_check_admin(),public.blk_append_only(),public.blk_protect_app_tenant(),public.blk_check_version_label(),public.blk_check_attachment(),
  public.blk_review_app(uuid,uuid,integer,text,text,text,boolean,boolean) FROM PUBLIC;
COMMIT;
