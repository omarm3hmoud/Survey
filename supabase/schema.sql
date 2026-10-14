-- DawaNetwork pharmacist survey — Supabase schema
--
-- Run this once in your Supabase project's SQL editor (or via the Supabase
-- CLI) before pointing config.js at that project. It has not been executed
-- against a live project from here — there is no Supabase access available
-- in the environment that produced this file — so test it in a development
-- project first.

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  submitted_at timestamptz not null default now(),
  -- One jsonb column holds every answer, keyed by question id (q1, q2, ...).
  -- This keeps the schema stable even if questions are reworded later, and
  -- avoids one Postgres column per question.
  answers jsonb not null,
  -- Set automatically from the request; not shown or asked of the pharmacist.
  user_agent text
);

comment on table public.survey_responses is
  'Responses to the DawaNetwork pharmacist survey.';


-- Row Level Security: lock the table down, then open only the two narrow
-- operations the public form actually needs.
alter table public.survey_responses enable row level security;

-- Allow anyone using the anon key to INSERT a new response...
create policy "public can submit a response"
  on public.survey_responses
  for insert
  to anon
  with check (true);

-- ...but not read, update, or delete any response by default.
-- Review responses from the Supabase dashboard (as the project owner),
-- through a service-role key in admin.html, or if you want admin.html to read
-- directly using the anon key, uncomment and run the SELECT policy below:

-- create policy "allow_admin_read"
--   on public.survey_responses
--   for select
--   to anon
--   using (true);

