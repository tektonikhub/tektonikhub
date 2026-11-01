CREATE TABLE IF NOT EXISTS public.organization_azure (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  endpoint text NOT NULL,
  deployment text NOT NULL,
  api_version text NOT NULL,
  encrypted_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  calls integer NOT NULL DEFAULT 0,
  lease uuid,
  lease_until timestamptz
);

ALTER TABLE public.organization_azure
  ADD CONSTRAINT organization_azure_endpoint_valid CHECK (
    endpoint ~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.(openai\.azure\.com|services\.ai\.azure\.com)(/openai/v1/responses)?$'
  ),
  ADD CONSTRAINT organization_azure_deployment_valid CHECK (deployment ~ '^[a-zA-Z0-9._-]{1,128}$'),
  ADD CONSTRAINT organization_azure_api_version_valid CHECK (api_version = 'v1' OR api_version ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}(-preview)?$'),
  ADD CONSTRAINT organization_azure_key_valid CHECK (
    length(encrypted_key) BETWEEN 54 AND 726
    AND encrypted_key ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  ),
  ADD CONSTRAINT organization_azure_counters_valid CHECK (version > 0 AND calls BETWEEN 0 AND 12),
  ADD CONSTRAINT organization_azure_lease_valid CHECK ((lease IS NULL) = (lease_until IS NULL));

ALTER TABLE public.organization_azure ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_azure FROM PUBLIC, anon, authenticated;
GRANT SELECT (org_id, endpoint, deployment, api_version, encrypted_key, version)
  ON public.organization_azure TO authenticated;
DROP POLICY IF EXISTS azure_read ON public.organization_azure;
CREATE POLICY azure_read ON public.organization_azure FOR SELECT TO authenticated
  USING (public.tk_can_access(org_id) AND public.tk_identity()->>'role' IN ('developer', 'admin', 'superadmin'));

CREATE OR REPLACE FUNCTION public.tk_azure_save(
  p_org uuid, p_endpoint text, p_deployment text, p_api_version text, p_encrypted_key text, p_version integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  config public.organization_azure;
BEGIN
  IF NOT public.tk_can_access(p_org, true) THEN
    RAISE EXCEPTION 'Solo Administracion puede configurar Azure en esta empresa.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id = p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organizacion no disponible.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO config FROM public.organization_azure WHERE org_id = p_org FOR UPDATE;
  IF p_version IS NULL OR coalesce(config.version, 0) <> p_version THEN
    RAISE EXCEPTION 'La configuracion cambio. Recarga antes de guardar.' USING ERRCODE = '40001';
  END IF;
  IF config.lease_until > now() THEN
    RAISE EXCEPTION 'Espera a que termine la peticion de esta organizacion.' USING ERRCODE = '40001';
  END IF;
  IF p_endpoint IS NULL OR p_endpoint !~ '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.(openai\.azure\.com|services\.ai\.azure\.com)/openai/v1/responses$'
    OR p_deployment IS NULL OR p_deployment !~ '^[a-zA-Z0-9._-]{1,128}$'
    OR p_api_version IS DISTINCT FROM 'v1'
    OR p_encrypted_key IS NULL OR length(p_encrypted_key) NOT BETWEEN 54 AND 726
    OR p_encrypted_key !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Configuracion Azure Responses v1 invalida.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.organization_azure(org_id, endpoint, deployment, api_version, encrypted_key)
    VALUES(p_org, p_endpoint, p_deployment, p_api_version, p_encrypted_key)
    ON CONFLICT(org_id) DO UPDATE SET endpoint = excluded.endpoint, deployment = excluded.deployment,
      api_version = excluded.api_version, encrypted_key = excluded.encrypted_key,
      version = organization_azure.version + 1;
END $$;

DROP FUNCTION IF EXISTS public.tk_azure_clear(uuid);
CREATE FUNCTION public.tk_azure_clear(p_org uuid, p_version integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  config public.organization_azure;
BEGIN
  IF NOT public.tk_can_access(p_org, true) THEN
    RAISE EXCEPTION 'Solo Administracion puede borrar Azure en esta empresa.' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id = p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organizacion no disponible.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO config FROM public.organization_azure WHERE org_id = p_org FOR UPDATE;
  IF p_version IS NULL OR coalesce(config.version, 0) <> p_version THEN
    RAISE EXCEPTION 'La configuracion cambio. Recarga antes de borrar.' USING ERRCODE = '40001';
  END IF;
  IF config.lease_until > now() THEN
    RAISE EXCEPTION 'Espera a que termine la peticion de esta organizacion.' USING ERRCODE = '40001';
  END IF;
  DELETE FROM public.organization_azure WHERE org_id = p_org;
END $$;

CREATE OR REPLACE FUNCTION public.tk_azure_claim(p_org uuid, p_lease uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  config public.organization_azure;
BEGIN
  IF NOT public.tk_can_access(p_org) OR public.tk_identity()->>'role' NOT IN ('developer', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'No puedes utilizar Azure en esta empresa.' USING ERRCODE = '42501';
  END IF;
  IF p_lease IS NULL THEN RAISE EXCEPTION 'Peticion Azure invalida.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO config FROM public.organization_azure WHERE org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Configura Azure OpenAI en Admin.'; END IF;
  IF config.lease_until > now() THEN RETURN false; END IF;
  IF config.window_start <= now() - interval '1 minute' THEN
    config.calls := 0;
    config.window_start := now();
  END IF;
  IF config.calls >= 12 THEN RETURN false; END IF;
  UPDATE public.organization_azure SET calls = config.calls + 1, window_start = config.window_start,
    lease = p_lease, lease_until = now() + interval '65 seconds' WHERE org_id = p_org;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.tk_azure_release(p_org uuid, p_lease uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT public.tk_can_access(p_org) OR public.tk_identity()->>'role' NOT IN ('developer', 'admin', 'superadmin') THEN
    RAISE EXCEPTION 'Empresa no autorizada.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_azure SET lease = NULL, lease_until = NULL WHERE org_id = p_org AND lease = p_lease;
END $$;

REVOKE ALL ON FUNCTION public.tk_azure_save(uuid,text,text,text,text,integer),
  public.tk_azure_clear(uuid,integer), public.tk_azure_claim(uuid,uuid), public.tk_azure_release(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tk_azure_save(uuid,text,text,text,text,integer),
  public.tk_azure_clear(uuid,integer), public.tk_azure_claim(uuid,uuid), public.tk_azure_release(uuid,uuid)
  TO authenticated;