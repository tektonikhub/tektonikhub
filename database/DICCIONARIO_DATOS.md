# Diccionario de datos Tektonik hub para PostgreSQL

Generado de `001_initial_schema.sql`. Este archivo no sustituye al SQL ejecutable. Ver [MAPA_POSTGRESQL.md](MAPA_POSTGRESQL.md) para significado, alcance y reglas de backend.

**Convenciones:** UUID = identidad técnica; `legacy_id` = ID anterior; `org_id` = tenant; `timestamptz` = fecha con zona; una PK implica NOT NULL aunque no aparezca escrito. Las FK sin `ON DELETE` usan NO ACTION: no hay borrado en cascada automático. JSONB solo valida forma básica; el backend valida su contenido.

## 1. `plans`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `name` | `varchar(100) NOT NULL CHECK (length(btrim(name)) > 0)` |
| `price` | `numeric(12,2) CHECK (price >= 0)` |
| `currency` | `char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$')` |
| `billing_interval` | `text NOT NULL DEFAULT 'month' CHECK (billing_interval IN ('month','year','custom'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 2. `organizations`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `name` | `varchar(120) NOT NULL CHECK (length(btrim(name)) > 0)` |
| `domain` | `varchar(253) CHECK (domain IS NULL OR domain ~* '^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$')` |
| `plan_id` | `uuid NOT NULL REFERENCES public.plans(id)` |
| `status` | `text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending'))` |
| `health_status` | `text NOT NULL DEFAULT 'normal' CHECK (health_status IN ('normal','warning'))` |
| `admin_id` | `uuid NOT NULL` |
| `declared_member_count` | `integer CHECK (declared_member_count >= 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `deleted_at` | `timestamptz` |
| `revision` | `integer NOT NULL DEFAULT 1 CHECK (revision > 0)` |

## 3. `users`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `org_id` | `uuid NOT NULL REFERENCES public.organizations(id)` |
| `name` | `varchar(120) NOT NULL CHECK (length(btrim(name)) > 0)` |
| `email` | `varchar(254) NOT NULL CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')` |
| `department` | `varchar(120) NOT NULL DEFAULT ''` |
| `bio` | `varchar(2000) NOT NULL DEFAULT ''` |
| `role` | `text NOT NULL CHECK (role IN ('developer','catalog','admin','superadmin'))` |
| `preferred_language` | `text NOT NULL DEFAULT 'es' CHECK (preferred_language IN ('es','en'))` |
| `auth_provider` | `text` |
| `auth_subject` | `text` |
| `last_access_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `disabled_at` | `timestamptz` |

Restricciones de tabla:

```sql
UNIQUE (org_id,id)
UNIQUE (auth_provider,auth_subject)
CHECK ((auth_provider IS NULL) = (auth_subject IS NULL))
```

## 4. `organization_profiles`

| Columna | Definición SQL |
|---|---|
| `org_id` | `uuid PRIMARY KEY REFERENCES public.organizations(id)` |
| `bio` | `varchar(2000) NOT NULL DEFAULT ''` |
| `banner_title` | `varchar(160) NOT NULL DEFAULT ''` |
| `banner_description` | `varchar(2000) NOT NULL DEFAULT ''` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

## 5. `organization_branding`

| Columna | Definición SQL |
|---|---|
| `org_id` | `uuid PRIMARY KEY REFERENCES public.organizations(id)` |
| `tokens` | `jsonb NOT NULL CHECK (jsonb_typeof(tokens) = 'object')` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

## 6. `organization_settings`

| Columna | Definición SQL |
|---|---|
| `org_id` | `uuid PRIMARY KEY REFERENCES public.organizations(id)` |
| `max_upload_files` | `integer NOT NULL DEFAULT 10 CHECK (max_upload_files BETWEEN 0 AND 100)` |
| `max_upload_bytes` | `bigint NOT NULL DEFAULT 26214400 CHECK (max_upload_bytes >= 0)` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

## 7. `categories`

| Columna | Definición SQL |
|---|---|
| `id` | `text PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]+$')` |
| `label` | `varchar(120) NOT NULL` |
| `sort_order` | `integer NOT NULL DEFAULT 0` |

## 8. `policies`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `org_id` | `uuid REFERENCES public.organizations(id)` |
| `name` | `varchar(120) NOT NULL CHECK (length(btrim(name)) > 0)` |
| `description` | `varchar(3000) NOT NULL DEFAULT ''` |
| `enabled` | `boolean NOT NULL DEFAULT true` |
| `version` | `integer NOT NULL DEFAULT 1 CHECK (version > 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

## 9. `apps`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `org_id` | `uuid NOT NULL REFERENCES public.organizations(id)` |
| `author_id` | `uuid NOT NULL` |
| `ticket` | `varchar(120) NOT NULL UNIQUE` |
| `current_version` | `integer NOT NULL DEFAULT 1 CHECK (current_version > 0)` |
| `review_status` | `text NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review','changes_requested','rejected','approved'))` |
| `maturity` | `text NOT NULL DEFAULT 'new' CHECK (maturity IN ('approved','beta','new'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |
| `deleted_at` | `timestamptz` |

Restricciones de tabla:

```sql
UNIQUE (org_id,id)
FOREIGN KEY (org_id,author_id) REFERENCES public.users(org_id,id)
```

## 10. `app_versions`

| Columna | Definición SQL |
|---|---|
| `app_id` | `uuid NOT NULL` |
| `version` | `integer NOT NULL CHECK (version > 0)` |
| `org_id` | `uuid NOT NULL` |
| `category_id` | `text NOT NULL REFERENCES public.categories(id)` |
| `title` | `varchar(60) NOT NULL CHECK (length(btrim(title)) > 0)` |
| `description` | `varchar(800) NOT NULL CHECK (length(btrim(description)) >= 30)` |
| `long_description` | `text NOT NULL DEFAULT ''` |
| `tagline` | `varchar(100) NOT NULL DEFAULT ''` |
| `impact` | `varchar(500) NOT NULL DEFAULT ''` |
| `data_note` | `varchar(2000) NOT NULL DEFAULT ''` |
| `repository_url` | `varchar(1000) CHECK (repository_url IS NULL OR repository_url ~* '^https?://[^[:space:]]+$')` |
| `generated_html` | `text CHECK (generated_html IS NULL OR length(generated_html) <= 300000)` |
| `dashboard_config` | `jsonb CHECK (dashboard_config IS NULL OR jsonb_typeof(dashboard_config) = 'object')` |
| `engine` | `text CHECK (engine IS NULL OR engine IN ('demo','azure-openai'))` |
| `model` | `varchar(128)` |
| `created_by` | `uuid NOT NULL REFERENCES public.users(id)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
PRIMARY KEY (app_id,version)
FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
```

## 11. `app_version_labels`

| Columna | Definición SQL |
|---|---|
| `app_id` | `uuid NOT NULL` |
| `version` | `integer NOT NULL` |
| `kind` | `text NOT NULL CHECK (kind IN ('tag','technology'))` |
| `label` | `varchar(120) NOT NULL CHECK (length(btrim(label)) > 0)` |
| `position` | `integer NOT NULL DEFAULT 0 CHECK (position >= 0)` |

Restricciones de tabla:

```sql
PRIMARY KEY (app_id,version,kind,label)
FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version)
```

## 12. `files`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `org_id` | `uuid NOT NULL REFERENCES public.organizations(id)` |
| `uploaded_by` | `uuid NOT NULL` |
| `name` | `varchar(255) NOT NULL CHECK (length(btrim(name)) > 0)` |
| `byte_size` | `bigint NOT NULL CHECK (byte_size >= 0)` |
| `mime_type` | `varchar(128) NOT NULL DEFAULT ''` |
| `storage_bucket` | `text` |
| `storage_key` | `text` |
| `sha256` | `char(64) CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
UNIQUE (org_id,id)
UNIQUE (storage_bucket,storage_key)
FOREIGN KEY (org_id,uploaded_by) REFERENCES public.users(org_id,id)
CHECK ((storage_bucket IS NULL) = (storage_key IS NULL))
```

## 13. `app_version_files`

| Columna | Definición SQL |
|---|---|
| `app_id` | `uuid NOT NULL` |
| `version` | `integer NOT NULL` |
| `org_id` | `uuid NOT NULL` |
| `file_id` | `uuid NOT NULL` |
| `position` | `integer NOT NULL DEFAULT 0 CHECK (position >= 0)` |

Restricciones de tabla:

```sql
PRIMARY KEY (app_id,version,file_id)
FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version)
FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
FOREIGN KEY (org_id,file_id) REFERENCES public.files(org_id,id)
```

## 14. `app_reviews`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `app_id` | `uuid NOT NULL` |
| `version` | `integer NOT NULL` |
| `reviewer_id` | `uuid NOT NULL REFERENCES public.users(id)` |
| `action` | `text NOT NULL CHECK (action IN ('approved','rejected','changes_requested'))` |
| `reason` | `varchar(3000) NOT NULL DEFAULT ''` |
| `environment` | `varchar(200) NOT NULL DEFAULT ''` |
| `manual_security_checked` | `boolean NOT NULL DEFAULT false` |
| `manual_data_checked` | `boolean NOT NULL DEFAULT false` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
UNIQUE (app_id,version)
UNIQUE (app_id,version,id)
FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version)
CHECK (action = 'approved' OR length(btrim(reason)) > 0)
CHECK (action <> 'approved' OR (manual_security_checked AND manual_data_checked))
```

## 15. `app_security_evidence`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `app_id` | `uuid NOT NULL` |
| `version` | `integer NOT NULL` |
| `review_id` | `uuid` |
| `label` | `varchar(200) NOT NULL` |
| `certificate_reference` | `varchar(200)` |
| `evidence_url` | `text` |
| `source` | `text NOT NULL CHECK (source IN ('demo','manual','scanner'))` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
FOREIGN KEY (app_id,version) REFERENCES public.app_versions(app_id,version)
FOREIGN KEY (app_id,version,review_id) REFERENCES public.app_reviews(app_id,version,id)
```

## 16. `audit_events`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `org_id` | `uuid NOT NULL REFERENCES public.organizations(id)` |
| `actor_id` | `uuid NOT NULL REFERENCES public.users(id)` |
| `app_id` | `uuid` |
| `action` | `varchar(120) NOT NULL` |
| `metadata` | `jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object')` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
```

## 17. `studio_projects`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `legacy_id` | `text UNIQUE` |
| `org_id` | `uuid NOT NULL REFERENCES public.organizations(id)` |
| `owner_id` | `uuid NOT NULL` |
| `title` | `varchar(120) NOT NULL` |
| `current_version` | `integer` |
| `submitted_app_id` | `uuid` |
| `submitted_version` | `integer` |
| `revision` | `integer NOT NULL DEFAULT 1 CHECK (revision > 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
UNIQUE (org_id,id)
FOREIGN KEY (org_id,owner_id) REFERENCES public.users(org_id,id)
FOREIGN KEY (org_id,submitted_app_id) REFERENCES public.apps(org_id,id)
FOREIGN KEY (submitted_app_id,submitted_version) REFERENCES public.app_versions(app_id,version)
CHECK ((submitted_app_id IS NULL) = (submitted_version IS NULL))
```

## 18. `studio_versions`

| Columna | Definición SQL |
|---|---|
| `project_id` | `uuid NOT NULL REFERENCES public.studio_projects(id)` |
| `version` | `integer NOT NULL CHECK (version > 0)` |
| `prompt` | `varchar(2000) NOT NULL` |
| `generated_html` | `text NOT NULL CHECK (length(generated_html) BETWEEN 1 AND 300000)` |
| `dashboard_config` | `jsonb CHECK (dashboard_config IS NULL OR jsonb_typeof(dashboard_config) = 'object')` |
| `engine` | `text NOT NULL CHECK (engine IN ('demo','azure-openai'))` |
| `model` | `varchar(128)` |
| `template` | `varchar(80)` |
| `spec` | `jsonb CHECK (spec IS NULL OR jsonb_typeof(spec) = 'object')` |
| `summary` | `text NOT NULL DEFAULT ''` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
PRIMARY KEY (project_id,version)
```

## 19. `studio_messages`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `project_id` | `uuid NOT NULL REFERENCES public.studio_projects(id)` |
| `position` | `integer NOT NULL CHECK (position >= 0)` |
| `role` | `text NOT NULL CHECK (role IN ('user','assistant','system'))` |
| `body` | `text NOT NULL` |
| `version` | `integer` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
UNIQUE (project_id,position)
FOREIGN KEY (project_id,version) REFERENCES public.studio_versions(project_id,version)
```

## 20. `studio_activity`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `project_id` | `uuid NOT NULL REFERENCES public.studio_projects(id)` |
| `action` | `varchar(120) NOT NULL` |
| `message` | `text NOT NULL` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

## 21. `llm_connections`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `org_id` | `uuid NOT NULL REFERENCES public.organizations(id)` |
| `provider` | `text NOT NULL DEFAULT 'azure-openai' CHECK (provider = 'azure-openai')` |
| `endpoint` | `text NOT NULL CHECK (endpoint ~ '^https://[a-z0-9][a-z0-9-]{0,62}\.openai\.azure\.com/?$')` |
| `deployment` | `varchar(128) NOT NULL CHECK (deployment ~ '^[a-zA-Z0-9._-]{1,128}$')` |
| `api_version` | `varchar(30) NOT NULL DEFAULT '2024-10-21' CHECK (api_version ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}(-preview)?$')` |
| `secret_reference` | `text NOT NULL` |
| `enabled` | `boolean NOT NULL DEFAULT true` |
| `last_test_at` | `timestamptz` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
UNIQUE (org_id,provider)
```

## 22. `app_metric_snapshots`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `app_id` | `uuid NOT NULL REFERENCES public.apps(id)` |
| `observed_at` | `timestamptz NOT NULL` |
| `hours_saved` | `numeric(14,2) CHECK (hours_saved >= 0)` |
| `active_users` | `integer CHECK (active_users >= 0)` |
| `rating` | `numeric(3,2) CHECK (rating BETWEEN 1 AND 5)` |
| `source` | `text NOT NULL CHECK (source IN ('demo','manual','measured'))` |
| `methodology` | `text` |

Restricciones de tabla:

```sql
UNIQUE (app_id,observed_at)
```

## 23. `app_ratings`

| Columna | Definición SQL |
|---|---|
| `org_id` | `uuid NOT NULL` |
| `app_id` | `uuid NOT NULL` |
| `user_id` | `uuid NOT NULL` |
| `score` | `smallint NOT NULL CHECK (score BETWEEN 1 AND 5)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
PRIMARY KEY (app_id,user_id)
FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
FOREIGN KEY (org_id,user_id) REFERENCES public.users(org_id,id)
```

## 24. `app_usage_events`

| Columna | Definición SQL |
|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` |
| `org_id` | `uuid NOT NULL` |
| `app_id` | `uuid NOT NULL` |
| `user_id` | `uuid NOT NULL` |
| `event_type` | `text NOT NULL CHECK (event_type IN ('opened','execution_started','execution_completed','execution_failed'))` |
| `duration_ms` | `bigint CHECK (duration_ms >= 0)` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
FOREIGN KEY (org_id,app_id) REFERENCES public.apps(org_id,id)
FOREIGN KEY (org_id,user_id) REFERENCES public.users(org_id,id)
```

## 25. `content_translations`

| Columna | Definición SQL |
|---|---|
| `page` | `text NOT NULL CHECK (page IN ('index','login','profile','companyProfile','catalog','creator','admin','superAdmin'))` |
| `locale` | `text NOT NULL CHECK (locale IN ('es','en'))` |
| `key` | `text NOT NULL` |
| `value` | `text NOT NULL` |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` |

Restricciones de tabla:

```sql
PRIMARY KEY (page,locale,key)
```

## Relaciones diferidas adicionales

Estas FK permiten insertar las entidades circulares dentro de una única transacción. Se validan al confirmar; no permiten referencias inexistentes:

```sql
ALTER TABLE public.organizations ADD CONSTRAINT organizations_admin_fk
  FOREIGN KEY (id,admin_id) REFERENCES public.users(org_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.apps ADD CONSTRAINT apps_current_version_fk
  FOREIGN KEY (id,current_version) REFERENCES public.app_versions(app_id,version) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.studio_projects ADD CONSTRAINT studio_current_version_fk
  FOREIGN KEY (id,current_version) REFERENCES public.studio_versions(project_id,version) DEFERRABLE INITIALLY DEFERRED;
```

## Índices explícitos

Los índices de PK/UNIQUE también se crean automáticamente. Se añaden los siguientes para búsquedas y referencias:

```sql
CREATE UNIQUE INDEX plans_name_ci ON public.plans (lower(name));
CREATE UNIQUE INDEX organizations_name_ci ON public.organizations (lower(name));
CREATE UNIQUE INDEX organizations_domain_ci ON public.organizations (lower(domain)) WHERE domain IS NOT NULL;
CREATE INDEX organizations_plan_idx ON public.organizations(plan_id);
CREATE UNIQUE INDEX users_email_ci ON public.users(lower(email));
CREATE INDEX users_org_role_idx ON public.users(org_id,role);
CREATE INDEX policies_org_idx ON public.policies(org_id);
CREATE INDEX apps_author_idx ON public.apps(org_id,author_id);
CREATE INDEX apps_queue_idx ON public.apps(org_id,review_status,updated_at) WHERE deleted_at IS NULL;
CREATE INDEX app_versions_category_idx ON public.app_versions(category_id);
CREATE INDEX app_versions_org_idx ON public.app_versions(org_id);
CREATE INDEX app_versions_creator_idx ON public.app_versions(created_by);
CREATE INDEX files_uploader_idx ON public.files(org_id,uploaded_by);
CREATE INDEX app_version_files_file_idx ON public.app_version_files(org_id,file_id);
CREATE INDEX app_reviews_reviewer_idx ON public.app_reviews(reviewer_id);
CREATE INDEX app_security_version_idx ON public.app_security_evidence(app_id,version);
CREATE INDEX app_security_review_idx ON public.app_security_evidence(review_id);
CREATE INDEX audit_events_org_date_idx ON public.audit_events(org_id,created_at DESC);
CREATE INDEX audit_events_app_idx ON public.audit_events(app_id);
CREATE INDEX audit_events_actor_idx ON public.audit_events(actor_id);
CREATE INDEX studio_projects_owner_idx ON public.studio_projects(org_id,owner_id);
CREATE INDEX studio_projects_submission_idx ON public.studio_projects(submitted_app_id,submitted_version);
CREATE INDEX studio_activity_project_idx ON public.studio_activity(project_id,created_at);
CREATE INDEX app_ratings_user_idx ON public.app_ratings(org_id,user_id);
CREATE INDEX app_usage_app_date_idx ON public.app_usage_events(org_id,app_id,created_at);
CREATE INDEX app_usage_user_idx ON public.app_usage_events(org_id,user_id);
```

## Vistas

- `catalog_apps`: solo versión actual aprobada, app no eliminada y empresa activa/no eliminada. No devuelve HTML ni credenciales. Usar filtro de empresa/autorización además de la vista.
- `organization_metrics`: usuarios activos registrados, apps aprobadas y apps pendientes. No son cifras comerciales declaradas.

## Funciones y triggers

- `blk_touch_updated_at`: timestamp mantenido por servidor.
- `blk_check_admin`: comprobación diferida de admin principal, activo y del mismo tenant.
- `blk_append_only`: rechaza UPDATE/DELETE de historial y archivos.
- `blk_protect_app_tenant`: tenant de app inmutable.
- `blk_check_version_label`: no añadir etiquetas a una versión ya revisada.
- `blk_check_attachment`: bloquea la app, valida límites de archivos/bytes por versión y prohíbe adjuntar después de revisar.
- `blk_review_app`: revisión transaccional; verifica rol, tenant, estado y versión; registra decisión y evento. Solo backend de confianza.

RLS activado en todas las tablas sin políticas y sin acceso PUBLIC. No hay integración de identidad/grants de aplicación en esta migración. Ver las limitaciones y requisitos antes de producción en el mapa.

