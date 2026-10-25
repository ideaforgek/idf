# IdeaForge Hackathon

IdeaForge is a standalone website project. It does not modify or depend on the
TechTrove app.

## Run locally

From this folder, run:

```sh
npm install
npm run dev
```

To create and preview a production build:

```sh
npm run build
npm run preview
```

Copy `.env.example` to `.env` for local, browser-safe Supabase configuration.
The service-role key must only be configured in a trusted backend or Supabase
Edge Function secret store; never add it to this frontend project.

To initialize the database and private payment-proof bucket, run
[`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor.
After the admin has signed in with Google once, follow the bootstrap SQL
comment at the bottom of that file to grant the admin role.
Add the local origin and production origin to Supabase Authentication's
redirect URL allow list so Google OAuth can return to the admin route.

The public registration form saves teams and members to Supabase and uploads
payment screenshots to the private `ideaforge-payment-proofs` bucket. The
admin route uses Google OAuth and checks the `ideaforge_admins` table before
showing live registration data or controls.

After the base schema is installed, review the
[`supabase/migrations/20261025230000_ideaforge_email_confirmation.sql`](./supabase/migrations/20261025230000_ideaforge_email_confirmation.sql)
outbox/trigger migration and run its rollback-only queue test against a
disposable database. It queues one message to the team contact only when
payment changes from `pending_review` to `approved`. It does not backfill
existing approvals.

The Edge Function in `supabase/functions/ideaforge-email-worker/` sends using
the Gmail API and is disabled unless the server-side
`IDEAFORGE_EMAIL_SENDING_ENABLED` secret is explicitly set to `true`. Before
deployment, configure Gmail API OAuth credentials and the sender identity as
Supabase Edge Function secrets; required names are `GMAIL_CLIENT_ID`,
`GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `IDEAFORGE_GMAIL_FROM`,
`IDEAFORGE_GMAIL_FROM_NAME`, `IDEAFORGE_EMAIL_WORKER_TOKEN`, and
`IDEAFORGE_EMAIL_SENDING_ENABLED`. The Supabase service-role key is never
needed in the browser and must never be placed in a `VITE_*` variable.
The worker is configured with `verify_jwt = false` because it authenticates
with its own high-entropy bearer token; deploy it only after configuring that
secret. The Gmail authorization must include the
`https://www.googleapis.com/auth/gmail.send` scope. Existing Google sign-in
OAuth should remain unchanged.

[`supabase/scheduler.sql`](./supabase/scheduler.sql) is a proposed pg_cron /
pg_net / Vault setup, not an applied configuration. Verify those extensions
and existing jobs in the target project before running it. Configure the
`ideaforge_supabase_url` and `ideaforge_email_worker_token` Vault entries
first. The scheduler runs every five minutes; the database enforces a
concurrency-safe 200-message rolling 24-hour cap.

The worker records Gmail API acceptance, which is not proof of inbox delivery.
Sending, deployment, scheduler setup, and migrations remain pending explicit
approval. For sender/OAuth setup requirements, see [URLs needed](./URLs%20needed.md).
