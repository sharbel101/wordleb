# Hints for WordleB: proposed architecture (design only, nothing implemented)

Status: **planning for Phase 2.** No hint column, table or gameplay change exists yet, and none has been added to the database.

## What a hint is

Exactly one short English hint per **canonical** dictionary word. A hint helps a player recognise the word without saying it. Any one of these styles is fine; pick one per word:

| Style | Example (REE7A) |
| --- | --- |
| Synonym | "Smell" |
| Explanation | "Something you notice through your nose." |
| Context | "You might say this about food cooking in the kitchen." |

Rules for writing hints (enforced where possible, see below): 3 to 100 characters, never contains the answer or any of its registered variants, no Arabic script requirement (English first).

## Where it is stored

**Recommended: one nullable column on `words`** (`hint text`), not a separate table.

Why this is the simplest correct design:

- The dictionary already has exactly one row per canonical word, which is the "exactly one hint per word" rule for free.
- Spelling variants point at the canonical row (`word_variants.canonical_word`), so **all variants share the canonical word's hint automatically**. No hint ever belongs to a variant.
- `words` is already locked down (RLS on, no policies); the hint inherits that protection.
- The admin already edits `words` (meaning, Arabic spelling). The hint is one more field there.

A separate `word_hints` table would only be worth it if a word could ever need several hints or per-language hints. That is not the requirement, so it is not recommended.

Phase 2 migration sketch (**not applied, not created yet**):

```sql
alter table public.words add column if not exists hint text;
alter table public.words add constraint words_hint_length
  check (hint is null or char_length(btrim(hint)) between 3 and 100);
-- A hint may not contain its own word (a trigger adds the same check against the word's variants).
alter table public.words add constraint words_hint_not_answer
  check (hint is null or position(lower(word) in lower(hint)) = 0);
```

Existing rows keep `hint = null` until you fill them in, so nothing breaks. A word without a hint simply shows none.

## How the player receives a hint without leaking the answer

**Recommended: the hint rides inside the `submit-guess` response, only after a set number of guesses.**

1. The server already knows the true attempt number from the signed `state_token`; the client cannot fake it.
2. When a guess is scored and the attempt number reaches the unlock point (suggested: after the **3rd** wrong guess), the server reads the hint for the **canonical** answer and adds `hint: "..."` to that response.
3. The browser stores the hint in the saved game next to the guesses, so a refresh keeps it. Past-day replays work the same way.
4. The hint is **never** returned by `get-daily-puzzle`, never sent with an ordinary early guess, and never stored in anything the browser can read before it unlocks. Before the unlock point the browser has no hint to leak.
5. As a last safety net the server omits a hint if it contains the answer (or any registered variant), even if a bad row got in.

No extra endpoint or extra network round trip is needed, which also matters for players on weak connections.

Alternatives considered:

- A separate `get-hint` endpoint that takes the state token: also safe, but it adds a request per game and a second place that must verify attempts. Not worth it.
- A "Show hint" button the player can press at any time: possible, but then the unlock rule would have to be tied to a token the server issues for that purpose. Simplest is to keep the automatic unlock and add the button later if wanted.

## How it is shown (Phase 2, for your approval)

- A small line above the keyboard after the unlock point: **Hint: Smell**. Same visual style as the existing toast/nudge; no layout change before it appears.
- Announced to screen readers through the existing live region.
- Not included in the share text.
- When a game is finished, the result screen can show the hint next to the meaning (optional).

## Admin workflow (Phase 2)

Same style as `approve_word` and the variant functions (service role only):

```sql
select public.set_word_hint('REE7A', 'Something you notice through your nose.');
select * from public.words_missing_hints();          -- words that still need one
select public.check_word_hint('REE7A', 'A smell');   -- dry run: lists problems (empty list = OK)
```

Problems reported before saving: shorter than 3 or longer than 100 characters, contains the word, contains one of its variants, or the word is not in the dictionary. Editing a word's variants re-checks its hint.

## Phase 2 plan, in order

1. You approve the words and spellings from `reports/suggestion-audit.md`.
2. I prepare one migration: insert approved words (with meanings and hints), register approved variants, add the hint column and its checks, add the admin functions. You review the SQL; nothing runs before you approve.
3. Backend: `submit-guess` returns the hint at the unlock point; `submit-suggestion` is unchanged.
4. Frontend: store and show the hint as above.
5. Tests: hint never present before the unlock point, never contains the answer or a variant, shared by variants, survives refresh, hidden when absent; plus the dictionary, suggestion and variant tests.
6. Fill in hints for existing words (28 today) from your approved list.

## Decisions I need from you before Phase 2

1. After which guess should the hint unlock (3rd recommended)?
2. One style of hint for all words, or my choice per word (with you reviewing every one)?
3. Show the hint on the result screen as well?
