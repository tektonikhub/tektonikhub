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
    lease = p_lease, lease_until = now() + interval '300 seconds' WHERE org_id = p_org;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.tk_azure_claim(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tk_azure_claim(uuid,uuid) TO authenticated;
