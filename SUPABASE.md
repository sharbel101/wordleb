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

## Community statistics ("All players")

The Statistics window shows how many people solved the puzzle in 1, 2, ... 6 guesses, today and all time, across everyone who plays (so you can see that a friend on another phone also got it first try). Each browser keeps a private random id; the server stores only `(puzzle date, that id, number of guesses)`: no names, no accounts, no guesses and no answers. Each browser is counted once per day.

One-time setup, in this order:

1. **Create the table and function.** Supabase dashboard > SQL editor > paste all of `supabase/community-stats.sql` > Run. It only adds a table and a function; your other tables are untouched. The last line should return seven rows (0 to 6) of zeros. The table has row level security on and no policies, so the public key cannot read or write it.
2. **Create a new function** named exactly `get-community-stats` (Edge Functions > Deploy a new function > Via Editor) and paste `supabase/dashboard/get-community-stats.ts`.
3. **Redeploy `submit-guess`** by pasting the updated `supabase/dashboard/submit-guess.ts` over the existing code. It now records each finished game.
4. Publish the new frontend (push to GitHub; Netlify deploys it).

Until steps 1 to 3 are done the game still works; the "All players" section just says community stats are unavailable. Results are only counted from when the new `submit-guess` is live. To look at the raw numbers any time, run `select * from public.community_stats(current_date);` in the SQL editor.

Limits: counts are per browser, not per person, so someone who clears site data or uses another browser can be counted again, and a determined person could inflate the numbers with scripted requests. That is fine for a casual game; stronger protection would need accounts, which this app deliberately does not have.

## Growing the word list from play

You do not need to type a dictionary in advance. While `ENFORCE_WORD_LIST` is off, every well-formed guess is accepted. When a guess is not an approved word, the server (a) tells the game, which shows a small "Suggest it" prompt after the tiles reveal, and (b) quietly records "this anonymous player tried this word" in a `guess_log` table. Words that several different players tried rise to the top of a list you review, and one query approves them.

One-time setup, in this order:

1. **Create the table and helpers.** SQL editor > paste all of `supabase/word-candidates.sql` > Run. It only adds one table (`guess_log`, row level security on, no public access) and two functions; your other tables are untouched.
2. **Redeploy `submit-guess`** by pasting the updated `supabase/dashboard/submit-guess.ts` over the existing code.
3. Publish the new frontend (push to GitHub; Netlify deploys it).

Until step 1 is done the game works exactly as before; it just does not collect candidates.

Everyday use, in the SQL editor:

```sql
-- What are players trying? (3+ different players, most popular first)
select * from public.word_candidates(3);

-- Approve one (meaning and Arabic spelling are optional):
select public.approve_word('mnaqo', 'a meaning', 'مناقو');

-- Approve everything 5+ players tried (read the list first!):
select public.approve_word(word) from public.word_candidates(5);
```

Only anonymous random ids and five-letter words are stored. Because anyone can type anything, treat the list as suggestions to review, not as truth: a single person cannot push a word up (each browser counts once), but you should still read it before approving. Once the dictionary is big enough, switch on strict checking with the Supabase secret `ENFORCE_WORD_LIST=true`; players then only get "Not in word list" for words you have not approved.

The front-end filter is also slightly stricter now: besides wrong length, odd characters, five identical characters, five vowels and repeats, it rejects three identical characters in a row, words with no vowel letter and no digit at all (such as BCDRT), and four or more consonant sounds in a row (SH, KH, GH, TH, DH and CH count as one). Real spellings such as KIFAK, 7ABIB, SHWAY, 3AJ2A and KHBZ2 all pass.
