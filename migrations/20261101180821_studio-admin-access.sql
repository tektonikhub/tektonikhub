CREATE OR REPLACE FUNCTION public.tk_command(p_action text, p_id uuid DEFAULT NULL, p_fields jsonb DEFAULT '{}'::jsonb, p_version integer DEFAULT NULL)
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
      IF actor.role NOT IN ('developer', 'admin', 'superadmin') OR cmd.org_id <> actor.org_id
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
      IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = cmd.author_id AND u.org_id = cmd.org_id AND u.role IN ('developer', 'admin', 'superadmin') AND u.enabled AND u.deleted_at IS NULL) THEN
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