# Beacon API

The API serves the Beacon web app on port `3003`. It uses Supabase Auth with GitHub sign-in, PostgreSQL for conversations, Tavily for web search, and the AI Gateway for answers.

## Local setup

1. In Supabase, open **Authentication → Sign In / Providers → GitHub**, enable the provider, and enter the GitHub OAuth app Client ID and Client Secret.
2. In the GitHub OAuth app, set its authorization callback URL to `https://<your-project-ref>.supabase.co/auth/v1/callback` (for this project: `https://neqroulxqlikhejnkepk.supabase.co/auth/v1/callback`).
3. In Supabase, open **Authentication → URL Configuration**. Set Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to Redirect URLs.
4. Copy `apps/api/.env.example` to `apps/api/.env` and fill in Supabase URL and anon/publishable key, database, Tavily, AI Gateway, and session secret values. Generate a session secret with `openssl rand -base64 32`.
5. Copy `apps/web/.env.example` to `apps/web/.env.local` and fill in the same Supabase URL and anon/publishable key.
6. Install the monorepo dependencies from the repository root:

```bash
bun install
```

7. Apply migrations and generate Prisma Client from `packages/db`:

```bash
cd packages/db
bun --env-file=../../apps/api/.env run db:migrate
bun --env-file=../../apps/api/.env run db:generate
```

8. Start both the API and web app from the repository root:

```bash
bun dev
```

The web app defaults to `http://localhost:3000` and the API defaults to `http://localhost:3003`. `bun dev` starts both. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe for browser use; never put a Supabase service-role or secret key in the web app.
