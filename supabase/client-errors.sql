-- Connection-problem reports sent by the browser (see src/game/errorLog.ts).
-- No player id, no IP address, no free text: only the fixed fields below.
create table if not exists public.client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  fn text not null,
  reason text not null,
  status int,
  duration_ms int not null,
  via text not null,
  attempt int not null,
  outcome text not null,
  online boolean not null default true,
  net text,
  browser text not null default 'other'
);
create index if not exists client_errors_created_at_idx on public.client_errors (created_at desc);
alter table public.client_errors enable row level security;
-- No policies: only the service role (the Edge Function) can read or write.

-- Added later: the public API roles get no table privileges at all (RLS already blocked them; this
-- matches guess_log). Safe to re-run.
revoke all on table public.client_errors from anon, authenticated;
