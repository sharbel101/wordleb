# WordleB: Supabase setup and deployment

The browser only ever talks to three Edge Functions. It never reads `words` or `daily_puzzles` directly, and it never sees the service-role key.

| Function | What it does |
| --- | --- |
| `get-daily-puzzle` | Works out today's date in `Asia/Beirut`, confirms a puzzle exists for it, returns the date and puzzle number. Never returns the answer. |
| `submit-guess` | Loads the answer server-side, checks the guess against approved rows in `words`, scores it (green / yellow / grey, with correct duplicate-letter handling), and only returns the answer, meaning and Arabic spelling once the game is won or the 6th attempt is used. |
| `submit-suggestion` | Validates a suggestion, rate-limits it, rejects words that already exist, and inserts into `suggestions`. |

Code: `supabase/functions/`. Shared, unit-tested logic: `supabase/functions/_shared/`.

## 1. Check your existing schema (nothing here changes it)

In the Supabase SQL editor, confirm the tables look like what the functions expect:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name in ('words', 'daily_puzzles', 'suggestions')
order by table_name, ordinal_position;

-- RLS should be enabled on all three, with no public read policy on words / daily_puzzles
select tablename, rowsecurity from pg_tables where schemaname = 'public'
  and tablename in ('words', 'daily_puzzles', 'suggestions');
select tablename, policyname, roles, cmd from pg_policies where schemaname = 'public';
```

The functions assume:

- `daily_puzzles.puzzle_date` is a `date`, and `daily_puzzles.word` is the answer.
- `words.word` is the five-character Arabizi spelling and `words.approved` is a `boolean`.
- `suggestions.created_at` defaults to `now()`.
- `words.word` and `daily_puzzles.word` match the game alphabet: lowercase `a-z` plus the digits `2 3 5 6 7 8 9`. Matching is case-insensitive, but any other characters would never be accepted as a guess.

The service-role key bypasses RLS, so no policy changes are needed.

## 2. Add today's puzzle

```sql
insert into daily_puzzles (puzzle_date, word) values ('2026-11-01', '5obez');
```

The word should also exist in `words` (approved or not) so its meaning can be shown at the end. Add puzzles ahead of time, one per Beirut date. If a date has no row, the game shows "No puzzle today".

## 3. Deploy the functions

```bash
npm install -g supabase        # or: npx supabase ...
supabase login
supabase link --project-ref YOUR-PROJECT-REF
supabase functions deploy get-daily-puzzle
supabase functions deploy submit-guess
supabase functions deploy submit-suggestion
```

Supabase injects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` into every Edge Function automatically, so you do not need to set any secrets for the game to work. Do not put the service-role key in any `.env` file or in the frontend.

Optional: lock CORS to your site instead of `*`:

```bash
supabase secrets set ALLOWED_ORIGIN=https://your-domain.com
```

If your project uses the newer `sb_publishable_...` API keys instead of the legacy anon JWT, deploy with `--no-verify-jwt` (the functions do their own validation and expose nothing sensitive).

### Required secret: `GAME_TOKEN_SECRET`

`submit-guess` refuses to run without it (it fails closed rather than count attempts insecurely). Create a long random value locally and store it in Supabase (Dashboard > Edge Functions > Secrets, or `supabase secrets set GAME_TOKEN_SECRET=...`). Never commit it or put it in a `VITE_` variable.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Order matters:** set the secret first, then deploy the new `submit-guess` (paste `supabase/dashboard/submit-guess.ts`), then publish the new frontend. Rotating the secret later invalidates in-progress games for that day; those players are restarted automatically.

## 4. Configure the frontend

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings > API; the anon key is meant to be public). On your host (Netlify, Vercel, Cloudflare Pages...) set the same two variables, then `npm run build` and publish `dist/`.

## 5. Check it works

```bash
curl -X POST "$VITE_SUPABASE_URL/functions/v1/get-daily-puzzle" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```

Expect `{"puzzle_date":"...","puzzle_number":...,"word_length":5}` and no answer anywhere. Logs: Dashboard > Edge Functions > Logs.

## Known limits

- **Attempts are counted with a signed token, not a database.** Every scored guess returns a `state_token`: the guesses so far, signed with `GAME_TOKEN_SECRET`. The next guess must send it back, and `submit-guess` ignores any history the browser claims, so the answer can no longer be unlocked with a forged request. What this does *not* stop: a player can replay an old token to try several different guesses at the same attempt number, and can clear their browser data to start the day over. Neither reveals the answer without genuinely using the guesses; stopping them needs a server-side attempts table.
- **Suggestion rate limiting is best effort.** `submit-suggestion` limits each IP to 3 suggestions per 10 minutes in memory (per function instance, so it resets on cold starts) and applies a global cap of 100 per hour counted from the `suggestions` table. Strict per-IP limits would need an IP or hash column or a separate table, which I did not add because you asked me not to change the schema.
- **Streaks and statistics live in the browser** (`localStorage`), so clearing site data or switching devices resets them.

## Deploying the site to Netlify

`netlify.toml` already sets the build command (`npm run build`), the publish folder (`dist`), single-page-app routing, security headers and a Content-Security-Policy. It contains no secrets.

In the Netlify dashboard (Site configuration > Environment variables), add exactly these two variables, and nothing else:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT-REF.supabase.co` (project root, no `/rest/v1`) |
| `VITE_SUPABASE_ANON_KEY` | the anon / publishable key (it is public by design) |

Never create `VITE_` variables for a service-role key, a secret key or a database password: Vite copies every `VITE_` value into the public JavaScript. Server secrets belong only in Supabase (Edge Functions > Secrets).

Netlify's secrets scanner would otherwise fail the build because those two public values appear in the bundle, so `netlify.toml` lists exactly those two names in `SECRETS_SCAN_OMIT_KEYS`.

After the first deploy, restrict the functions to your site: set the Supabase secret `ALLOWED_ORIGIN` to `https://your-site.netlify.app`.

## Before publishing the repository

- `.env.local` must never be committed (it is ignored). Only `.env.example`, which holds placeholders, is tracked.
- Run `git status` and `git ls-files` before the first push and confirm no `.env*` file other than `.env.example` appears.
- If a real secret is ever committed, deleting the file is not enough: rotate the key in Supabase and treat the old one as public.
