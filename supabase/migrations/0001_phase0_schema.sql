-- StepLink Phase 0 schema draft. Apply only after Phase 2 auth/RLS integration tests.
-- Codes and recovery/session tokens are stored as one-way digests. Service-role keys never belong in the client.
create extension if not exists pgcrypto with schema extensions;

create type public.event_status as enum ('DRAFT','OPEN','ACTIVE','ENDED');
create type public.event_role as enum ('OWNER','OPERATOR','PARTICIPANT');
create type public.participant_status as enum ('NORMAL','STALE_LOCATION','LONG_STOP','COURSE_DEVIATION','HELP_REQUEST','COMPLETED','OFFLINE');
create type public.join_policy as enum ('OPEN','ROSTER');
create type public.roster_miss_policy as enum ('ALLOW','REQUIRE_APPROVAL','BLOCK');
create type public.course_mode as enum ('FREE','SIMPLE','DETAILED');
create type public.finish_method as enum ('AUTO','MANUAL');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  event_date date not null,
  expected_participants integer not null check (expected_participants between 1 and 10000),
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  end_message text check (char_length(end_message) <= 1000),
  status public.event_status not null default 'DRAFT',
  join_policy public.join_policy not null default 'OPEN',
  roster_miss_policy public.roster_miss_policy not null default 'ALLOW',
  school_template boolean not null default false,
  course_mode public.course_mode not null default 'FREE',
  finish_zone jsonb not null default '{"type":"circle","radiusMeters":100}'::jsonb,
  course_deviation_meters integer not null default 100 check (course_deviation_meters between 10 and 5000),
  route_retention text not null default 'NONE' check (route_retention in ('NONE','SIMPLIFIED','DETAILED')),
  settings jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_owner_created on public.events(owner_user_id, created_at desc);
create index events_status_schedule on public.events(status, scheduled_end_at);

-- Intentionally isolated from member-readable event rows. A five-character human-entry code has limited entropy,
-- so Phase 2 must compare a keyed digest (server-held pepper) behind a rate-limited function.
create table public.event_access_secrets (
  event_id uuid primary key references public.events(id) on delete cascade,
  join_code_digest text not null unique,
  operator_code_digest text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_operators (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.event_role not null check (role in ('OWNER','OPERATOR')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_identifier text not null check (char_length(participant_identifier) between 1 and 80),
  display_name text not null check (char_length(display_name) between 1 and 80),
  grade text,
  class_name text,
  approval_status text not null default 'APPROVED' check (approval_status in ('PENDING','APPROVED','BLOCKED')),
  session_token_digest text,
  recovery_token_digest text,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, participant_identifier),
  unique(event_id, user_id)
);
create index participants_event_name on public.participants(event_id, display_name);
create index participants_event_group on public.participants(event_id, grade, class_name);

create table public.participant_live_state (
  participant_id uuid primary key references public.participants(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  latitude double precision,
  longitude double precision,
  accuracy_m real,
  status public.participant_status not null default 'NORMAL',
  distance_m real not null default 0,
  elapsed_time_ms bigint not null default 0,
  last_received_at timestamptz,
  client_sequence bigint not null default 0,
  updated_at timestamptz not null default now()
);
create index participant_live_event_status on public.participant_live_state(event_id, status, last_received_at);

create table public.event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  target_type text not null check (target_type in ('ALL','GRADE','CLASS','PARTICIPANT','SELECTION')),
  target_value text,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index event_messages_event_time on public.event_messages(event_id, created_at desc);

create table public.event_message_recipients (
  message_id uuid not null references public.event_messages(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, participant_id)
);

create table public.help_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  request_type text not null check (request_type in ('INJURY','LOST','COMPANION','OTHER')),
  status text not null default 'OPEN' check (status in ('OPEN','ACKNOWLEDGED','RESOLVED')),
  latitude double precision,
  longitude double precision,
  accuracy_m real,
  location_received_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index help_requests_event_status on public.help_requests(event_id, status, created_at desc);

create table public.event_results (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete restrict,
  display_name text not null,
  participant_identifier text not null,
  participated boolean not null default true,
  completed boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  distance_m real not null default 0,
  moving_time_ms bigint not null default 0,
  stopped_time_ms bigint not null default 0,
  average_speed_mps real,
  had_help_request boolean not null default false,
  course_deviation_count integer not null default 0,
  completion_method public.finish_method,
  route_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, participant_id)
);

create table public.photo_verifications (
  id text primary key,
  event_id uuid references public.events(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  captured_at timestamptz not null,
  image_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.event_roster (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  participant_identifier text not null,
  expected_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, participant_identifier)
);

create table public.event_stickers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  kind text not null check (kind in ('STEPLINK','BUILT_IN','UPLOAD')),
  asset_key text not null,
  mime_type text,
  byte_size integer,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id)
);

create table public.event_courses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  mode public.course_mode not null,
  geometry jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.course_points (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.event_courses(id) on delete cascade,
  point_type text not null check (point_type in ('START','WAYPOINT','FINISH')),
  sequence integer not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, sequence)
);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
do $$ declare table_name text; begin
  foreach table_name in array array['events','event_access_secrets','event_operators','participants','participant_live_state','event_messages','event_message_recipients','help_requests','event_results','photo_verifications','event_roster','event_stickers','event_courses','course_points']
  loop execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name); end loop;
end $$;

create or replace function public.is_event_operator(target_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.events e where e.id = target_event and e.owner_user_id = auth.uid())
    or exists(select 1 from public.event_operators eo where eo.event_id = target_event and eo.user_id = auth.uid());
$$;
revoke all on function public.is_event_operator(uuid) from public;
grant execute on function public.is_event_operator(uuid) to authenticated;

create or replace function public.is_message_operator(target_message uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.event_messages m where m.id = target_message and public.is_event_operator(m.event_id));
$$;
revoke all on function public.is_message_operator(uuid) from public;
grant execute on function public.is_message_operator(uuid) to authenticated;

alter table public.events enable row level security;
alter table public.event_access_secrets enable row level security;
alter table public.event_operators enable row level security;
alter table public.participants enable row level security;
alter table public.participant_live_state enable row level security;
alter table public.event_messages enable row level security;
alter table public.event_message_recipients enable row level security;
alter table public.help_requests enable row level security;
alter table public.event_results enable row level security;
alter table public.photo_verifications enable row level security;
alter table public.event_roster enable row level security;
alter table public.event_stickers enable row level security;
alter table public.event_courses enable row level security;
alter table public.course_points enable row level security;

create policy events_owner_all on public.events for all to authenticated using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy events_member_read on public.events for select to authenticated using (
  public.is_event_operator(id) or exists(select 1 from public.participants p where p.event_id = id and p.user_id = auth.uid())
);
create policy operators_member_read on public.event_operators for select to authenticated using (user_id = auth.uid() or public.is_event_operator(event_id));
create policy operators_owner_write on public.event_operators for all to authenticated using (
  exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid())
) with check (exists(select 1 from public.events e where e.id = event_id and e.owner_user_id = auth.uid()));
create policy participants_self_or_operator_read on public.participants for select to authenticated using (user_id = auth.uid() or public.is_event_operator(event_id));
create policy participants_self_update on public.participants for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy participants_operator_update on public.participants for update to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id));
create policy live_self_write on public.participant_live_state for all to authenticated using (
  exists(select 1 from public.participants p where p.id = participant_id and p.user_id = auth.uid())
) with check (exists(select 1 from public.participants p where p.id = participant_id and p.user_id = auth.uid() and p.event_id = event_id));
create policy live_operator_read on public.participant_live_state for select to authenticated using (public.is_event_operator(event_id));
create policy messages_operator_write on public.event_messages for all to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id) and sender_user_id = auth.uid());
create policy messages_participant_read on public.event_messages for select to authenticated using (
  exists(select 1 from public.participants p where p.event_id = event_id and p.user_id = auth.uid() and (
    target_type = 'ALL' or (target_type = 'PARTICIPANT' and target_value = p.id::text) or
    (target_type = 'GRADE' and target_value = p.grade) or (target_type = 'CLASS' and target_value = p.class_name) or
    (target_type = 'SELECTION' and exists(select 1 from public.event_message_recipients r where r.message_id = event_messages.id and r.participant_id = p.id))
  ))
);
create policy recipients_self_or_operator_read on public.event_message_recipients for select to authenticated using (
  exists(select 1 from public.participants p where p.id = participant_id and p.user_id = auth.uid()) or
  public.is_message_operator(message_id)
);
create policy recipients_operator_write on public.event_message_recipients for all to authenticated using (
  public.is_message_operator(message_id)
) with check (public.is_message_operator(message_id));
create policy help_self_insert_read on public.help_requests for select to authenticated using (
  public.is_event_operator(event_id) or exists(select 1 from public.participants p where p.id = participant_id and p.user_id = auth.uid())
);
create policy help_self_insert on public.help_requests for insert to authenticated with check (
  exists(select 1 from public.participants p where p.id = participant_id and p.event_id = event_id and p.user_id = auth.uid())
);
create policy help_operator_update on public.help_requests for update to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id));
create policy results_self_or_operator_read on public.event_results for select to authenticated using (
  public.is_event_operator(event_id) or exists(select 1 from public.participants p where p.id = participant_id and p.user_id = auth.uid())
);
create policy results_operator_write on public.event_results for all to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id));
create policy photo_self_or_operator on public.photo_verifications for select to authenticated using (
  public.is_event_operator(event_id) or exists(select 1 from public.participants p where p.id = participant_id and p.user_id = auth.uid())
);
create policy photo_self_insert on public.photo_verifications for insert to authenticated with check (
  participant_id is not null and exists(select 1 from public.participants p where p.id = participant_id and p.event_id = event_id and p.user_id = auth.uid())
);
create policy roster_operator_all on public.event_roster for all to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id));
create policy stickers_member_read on public.event_stickers for select to authenticated using (
  public.is_event_operator(event_id) or exists(select 1 from public.participants p where p.event_id = event_id and p.user_id = auth.uid())
);
create policy stickers_operator_write on public.event_stickers for all to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id));
create policy course_member_read on public.event_courses for select to authenticated using (
  public.is_event_operator(event_id) or exists(select 1 from public.participants p where p.event_id = event_id and p.user_id = auth.uid())
);
create policy course_operator_write on public.event_courses for all to authenticated using (public.is_event_operator(event_id)) with check (public.is_event_operator(event_id));
create policy points_member_read on public.course_points for select to authenticated using (
  exists(select 1 from public.event_courses c where c.id = course_id and (public.is_event_operator(c.event_id) or exists(select 1 from public.participants p where p.event_id = c.event_id and p.user_id = auth.uid())))
);
create policy points_operator_write on public.course_points for all to authenticated using (
  exists(select 1 from public.event_courses c where c.id = course_id and public.is_event_operator(c.event_id))
) with check (exists(select 1 from public.event_courses c where c.id = course_id and public.is_event_operator(c.event_id)));

-- Participant creation, code verification, session recovery, and operator enrollment are intentionally
-- not exposed as direct table INSERT policies. Phase 2 must provide rate-limited server/RPC entry points
-- that compare digests and enforce unique(event_id, participant_identifier) idempotently.
