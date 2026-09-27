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

Vercel's GitHub login connection is missing; the owner was asked to connect GitHub and grant access only to LittleDreams. No Vercel project has been created. Required production server environment values: `DATABASE_URL` (transaction pooler), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Never expose them in frontend files or logs. The database password is held by the owner and has not been requested in chat.

Supabase Free quotas are shared by all albums, not per user. Configure upload-size limits, confirm available storage and arrange independent backups before relying on it as the only copy of family memories. A migration does not by itself provide backups or guaranteed uptime.
