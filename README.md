# Challenge Journal

Trading journal for an FTMO 2-Step challenge: calendar, trades, analytics, risk calculator, AI coach, Thai/English, dark/light, Supabase cloud sync.

## Run locally
```bash
cp .env.example .env     # then put your real PSU_API_KEY in .env
npm start                # http://localhost:5174
```

## Deploy
The app is a static page plus one small Node server (`server.mjs`) that keeps the LLM key off the browser.
Deploy to any Node host (Render, Railway, Fly.io). Build command: none. Start command: `npm start`.

Environment variables on the host:
- `PSU_API_KEY`, `PSU_BASE_URL`, `PSU_MODEL`
- `HOST=0.0.0.0`
- `REQUIRE_AUTH=1` so only signed-in users can call the AI (otherwise anyone with the URL can spend your key)
- `ALLOWED_EMAILS=you@example.com` (optional, recommended for a personal journal)

After you have the public URL, in Supabase → Authentication → URL Configuration:
- Site URL: your public URL
- Redirect URLs: add `https://your-domain/**`

## Notes
- Journal data lives in the browser and, if signed in, in the Supabase table `journals` (row-level security: each user sees only their own row).
- The Supabase publishable key in `public/index.html` is meant to be public. Never commit `.env`.
