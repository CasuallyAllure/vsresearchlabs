-- =============================================================================
-- VS Research Labs — Contact Messages (S5)
-- =============================================================================
-- General-purpose contact intake from the public /contact form. Distinct
-- from `inquiries` (which carries an items[] cart payload) — these are
-- free-form questions, partnership requests, documentation requests,
-- procurement scoping, etc. Service role inserts via the Edge Function;
-- admins read via RLS.
-- =============================================================================

create table if not exists contact_messages (
  id              uuid        primary key default gen_random_uuid(),
  reference_id    text        unique not null,         -- VSR-MSG-YYMMDD-NNN
  created_at      timestamptz not null default now(),
  name            text        not null,
  email           text        not null,
  phone           text,
  organization    text,
  role_title      text,
  topic           text        not null default 'general'
                              check (topic in ('general', 'procurement', 'documentation',
                                               'partnership', 'media', 'other')),
  message         text        not null,
  referrer        text,                                -- "how did you find us"
  source          text,                                -- e.g. utm_source / channel
  status          text        not null default 'OPEN'
                              check (status in ('OPEN', 'REVIEWING', 'RESPONDED', 'CLOSED')),
  intake_channel  text        not null default 'VSR-WEB-PORTAL'
);

create index if not exists contact_messages_created_at_idx on contact_messages (created_at desc);
create index if not exists contact_messages_status_idx     on contact_messages (status);
create index if not exists contact_messages_email_idx      on contact_messages (lower(email));

alter table contact_messages enable row level security;

drop policy if exists "Admins can read contact_messages"   on contact_messages;
drop policy if exists "Admins can update contact_messages" on contact_messages;

create policy "Admins can read contact_messages"
  on contact_messages for select using (is_admin());

create policy "Admins can update contact_messages"
  on contact_messages for update using (is_admin()) with check (is_admin());

-- Service role bypasses RLS so the Edge Function can INSERT. Anon writes
-- are blocked at the network layer (Edge Function as the only ingress).
