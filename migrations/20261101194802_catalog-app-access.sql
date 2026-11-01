CREATE POLICY catalog_versions_read ON public.app_versions
  FOR SELECT TO authenticated USING (
    public.tk_can_use_flow_app(app_id)
    AND version = (
      SELECT a.version FROM public.apps a
      WHERE a.id = app_versions.app_id AND a.org_id = app_versions.org_id
    )
  );