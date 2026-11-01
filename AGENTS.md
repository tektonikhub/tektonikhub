# Project agent instructions

## Existing application

Tektonik hub is an existing Next.js App Router application with React,
strict TypeScript, and Tailwind CSS 4. Follow the installed versions and
patterns in `package.json`; do not replace the app with a starter template
or downgrade Tailwind to match generic SDK examples.

The application uses InsForge identity and the remote business repository.
Authentication is server-owned through the SDK SSR cookie helpers; roles and
organizations come from `tk_identity`, never browser storage or role selectors.
The local repository and `data.json` remain isolated demo/test fixtures.
Do not fall back to demo identities when a real account or backend is unavailable.
The public URL, first-account activation and deployment are in `README.md`.

## InsForge backend

This directory is linked to the `tektonik-hub` cloud project in `eu-central`.
Use the linked project rather than creating another backend.

Before infrastructure work, read `.agents\skills\insforge-cli\SKILL.md` and
the relevant reference files. Run CLI commands as
`npx -y @insforge/cli@latest <command>` in this workspace to bypass an older
cached release that lacks documented setup and memory commands. Check the
target with `npx -y @insforge/cli@latest current`, and consult
`npx -y @insforge/cli@latest memory list` before non-trivial backend work.

Before application integration, read `.agents\skills\insforge\SKILL.md`.
Use `@insforge/sdk` and the documented Next.js SSR authentication helpers
when implementing real identity. Read the feature documentation before
writing integration code.

For schema changes, use CLI migrations and apply the documented SQL
privileges and row-level security policies to application-owned objects in
`public`. Browser demo roles are not a substitute for backend authorization.
Do not seed business data or migrate the demo fixture without an explicit
request.

## Credentials

`.insforge\project.json` is CLI-managed local connection state containing an
admin API key. Never edit it manually, commit it, or copy its contents into
documentation or frontend code. `.insforge` and local environment files are
ignored by `.gitignore`.

Only the backend URL and anon key may use `NEXT_PUBLIC_INSFORGE_*` variables.
Admin API keys, user API keys, and other privileged credentials must remain
server-only. Do not use an admin client to bypass user-scoped authorization.

## Changes and validation

Keep directly related documentation in `README.md` up to date. Use the
smallest relevant commands from `package.json`; TypeScript application
changes normally require `npm run typecheck`, `npm run lint`, and
`npm run test:next`. Backend provisioning can be checked with
`npx -y @insforge/cli@latest db query "SELECT 1 AS ok" --json`.
Auth changes also require `npm run test:next:auth`, which starts its own
loopback-only Next server and synthetic backend; it never seeds cloud accounts.
Use `npm run accounts:bootstrap -- <email> <username>` only with an
operator-approved first account. The operator receives verification and sets
their own password; never create or share a provisional password.

For frontend deployment, read
`.agents\skills\insforge-cli\references\deployments\deploy.md`, build locally,
then deploy the source root with
`npx -y @insforge/cli@latest deployments deploy . --json`.
Preserve `.vercelignore` exclusions and portable npm script paths.
This is a Next.js application: do not replace it with a static export or
add SPA rewrites to `index.html`. Keep the local LLM bridge disabled in
public deployments.
