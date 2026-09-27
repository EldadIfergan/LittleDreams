# Migration status

Requested destination: Vercel Hobby + Supabase Free. The owner confirmed on 2026-09-27 that Render has no real accounts, media or album data that need migrating; start with an empty cloud database.

Do not suspend/delete Render until the new deployment passes registration, login, multi-album isolation, parent/viewer permissions, invitations, comments, upload, private download, and persistence tests. Render billing continues while it remains active.

## Provisioning prerequisites

- Owner signs in to Vercel and Supabase, chooses their free personal plans.
- Create a dedicated Supabase project and apply `supabase/schema.sql`.
- Keep database connection credentials and the Supabase service key in server-side environment settings only. Never commit them or send them to the browser.
- Use the Supabase transaction pooler connection for Vercel, with verified TLS.
- Media bucket stays private. Browser uploads go directly to short-lived signed upload URLs, avoiding Vercel's function payload limit.

## Work in progress

Supabase project `ijxgwmckzxanvgdkslbr` (Frankfurt) is healthy. Schema and private storage bucket were created successfully in the SQL editor on 2026-09-27. The cloud handler (`api/index.js`), Vercel configuration and browser direct uploads are implemented. Syntax checks pass; live integration and authorization tests are still required. Existing `server.mjs` remains the Render/local server.

Vercel project `little-dreams` is connected to GitHub and deployed at https://little-dreams.vercel.app. The owner entered the production secrets directly in Vercel. Required server environment values: `DATABASE_URL` (transaction pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Never expose them in frontend files or logs.

2026-09-27 verification: deployment `HgqUSNnwfWq6UDAutV83vQdizb1z`, commit `846cc73`, passed `/api/health`. The official public Supabase CA from the dashboard certificate link is bundled for verified TLS. `test/live-smoke.mjs` passed registration, login, two-album isolation, private PNG upload/download, viewer comments, blocked unauthorized uploads/reads, single-use invitation, logout and persisted data after login. Synthetic private test accounts/albums remain isolated from real users. Browser registration screen verified. Render remains active and billable; offsite backup configuration and Render retirement remain pending.

Supabase Free quotas are shared by all albums, not per user. Configure upload-size limits, confirm available storage and arrange independent backups before relying on it as the only copy of family memories. A migration does not by itself provide backups or guaranteed uptime.
