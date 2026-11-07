-- The guarded finalization RPC owns the transaction but never trusts client object metadata.
GRANT USAGE ON SCHEMA storage TO project_admin;
GRANT SELECT, UPDATE ON storage.objects TO project_admin;
