# ImageIT3D + LaunchIT3D

Idea-to-listing pipeline for non-technical 3D print sellers (SEMO capstone).

## Run it locally

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in your Meshy API key and Supabase project URL + anon/publishable key.
4. In your Supabase project, open **SQL Editor** and run `supabase/schema.sql`.
5. In Supabase **Authentication -> URL Configuration**, add your local URL (for example `http://localhost:3000`) to the allowed redirect/site URLs.
6. Run `npm start`, then open `http://localhost:3000`.

If Supabase email confirmation is enabled, users must confirm the sign-up email before signing in. You can configure this in Supabase Authentication settings.

## Supabase connection

- Browser config is returned by `GET /api/config` and contains only the Supabase project URL and anon/publishable key.
- Users sign in with email and password.
- App state is stored in `public.user_app_state` as JSONB, with a row per authenticated user.
- Row Level Security policies restrict each user to their own row.
- Local storage remains as a local fallback. Signing in loads the cloud copy; changes are debounced and saved to Supabase.
- Imported mesh geometry (the actual GLB/STL/OBJ data) remains in the current browser's IndexedDB. This version syncs its model settings/metadata, not the mesh file itself.
- Never put a Supabase `service_role` key in `.env` for this browser app or expose it to clients.

## Meshy API

The Meshy API key stays in `.env` on the server and is never sent to the browser.

| Route | What it does |
| --- | --- |
| `GET /api/meshy/health` | Tells the page whether Meshy is set up |
| `POST /api/meshy/preview` | Starts a Text to 3D preview task |
| `GET /api/meshy/tasks/:id` | Status and progress |
| `GET /api/meshy/tasks/:id/model?format=glb` | Downloads the finished model through the server |

Meshy generation requires a Meshy account with sufficient credits. Never commit `.env`. If an API key is pushed to GitHub, revoke it and create a new one.
