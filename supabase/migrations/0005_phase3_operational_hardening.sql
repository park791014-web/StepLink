-- StepLink Phase 3 hardening: daily code reservation and server-owned auto-close.
-- 0004 is already deployed. Apply this file only after review and explicit approval.

alter table public.events add column auto_close_at timestamptz;
alter table public.event_access_secrets add column event_date date;
alter table public.event_access_secrets add column lookup_active boolean not null default true;

update public.event_access_secrets secret
set event_date = event.event_date,
    lookup_active = event.status <> 'ENDED'
from public.events event
where event.id = secret.event_id;

alter table public.event_access_secrets alter column event_date set not null;

alter table public.event_access_secrets drop constraint if exists event_access_secrets_join_code_digest_key;
drop index if exists public.event_access_operator_code_digest_unique;

create unique index event_access_join_code_event_date_unique
  on public.event_access_secrets(event_date, join_code_digest);
create unique index event_access_operator_code_event_date_unique
  on public.event_access_secrets(event_date, operator_code_digest);

-- Code-only lookup selects the latest event_date not later than the current
-- Asia/Seoul service date. These indexes are intentionally non-unique: daily
-- reservation, not global active reservation, is the product rule.
create index event_access_join_code_active_lookup
  on public.event_access_secrets(join_code_digest, event_date desc) where lookup_active;
create index event_access_operator_code_active_lookup
  on public.event_access_secrets(operator_code_digest, event_date desc) where lookup_active;

create unique index events_id_event_date_unique on public.events(id, event_date);
alter table public.event_access_secrets
  add constraint event_access_secret_event_date_matches
  foreign key (event_id, event_date) references public.events(id, event_date) on update cascade on delete cascade;

create or replace function public.set_event_auto_close_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.auto_close_at := case
    when new.scheduled_end_at is not null then new.scheduled_end_at + interval '30 minutes'
    else ((new.event_date + 1) + time '01:00') at time zone 'Asia/Seoul'
  end;
  return new;
end;
$$;

create trigger set_event_auto_close_at
before insert or update of event_date, scheduled_end_at on public.events
for each row execute function public.set_event_auto_close_at();

update public.events
set auto_close_at = case
  when scheduled_end_at is not null then scheduled_end_at + interval '30 minutes'
  else ((event_date + 1) + time '01:00') at time zone 'Asia/Seoul'
end;

alter table public.events alter column auto_close_at set not null;
create index events_auto_close_due on public.events(auto_close_at) where status <> 'ENDED';

create or replace function public.sync_event_code_lookup_state() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_access_secrets
  set lookup_active = new.status <> 'ENDED', updated_at = now()
  where event_id = new.id;
  return new;
end;
$$;

create trigger sync_event_code_lookup_state
after update of status on public.events
for each row when (old.status is distinct from new.status)
execute function public.sync_event_code_lookup_state();

create or replace function public.close_due_events_v1()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare closed_count integer;
begin
  update public.events
  set status = 'ENDED', ended_at = coalesce(ended_at, now()), updated_at = now()
  where status in ('DRAFT','OPEN','ACTIVE') and auto_close_at <= now();
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$$;

create or replace function public.create_event_internal(
  target_owner_user_id uuid,
  target_name text,
  target_event_date date,
  target_expected_participants integer,
  target_scheduled_start_at timestamptz,
  target_scheduled_end_at timestamptz,
  target_end_message text,
  target_join_code_digest text,
  target_operator_code_digest text,
  target_session_token_digest text
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare created_event public.events%rowtype;
begin
  if target_owner_user_id is null then raise exception 'OWNER_REQUIRED'; end if;
  if target_event_date is null then raise exception 'INVALID_EVENT_DATE'; end if;
  if char_length(trim(target_name)) not between 1 and 120 then raise exception 'INVALID_EVENT_NAME'; end if;
  if target_expected_participants not between 1 and 10000 then raise exception 'INVALID_EXPECTED_PARTICIPANTS'; end if;
  if target_scheduled_start_at is not null and target_scheduled_end_at is not null and target_scheduled_end_at <= target_scheduled_start_at then
    raise exception 'INVALID_SCHEDULE';
  end if;

  insert into public.events(owner_user_id, name, event_date, expected_participants, scheduled_start_at, scheduled_end_at, end_message, status)
  values(target_owner_user_id, trim(target_name), target_event_date, target_expected_participants, target_scheduled_start_at, target_scheduled_end_at, nullif(trim(target_end_message), ''), 'DRAFT')
  returning * into created_event;

  insert into public.event_access_secrets(event_id, event_date, join_code_digest, operator_code_digest, lookup_active)
  values(created_event.id, created_event.event_date, target_join_code_digest, target_operator_code_digest, true);
  insert into public.event_operators(event_id, user_id, role, session_token_digest)
  values(created_event.id, target_owner_user_id, 'OWNER', target_session_token_digest);
  return created_event;
end;
$$;

revoke all on function public.set_event_auto_close_at() from public, anon, authenticated;
revoke all on function public.sync_event_code_lookup_state() from public, anon, authenticated;
revoke all on function public.close_due_events_v1() from public, anon, authenticated;
revoke all on function public.create_event_internal(uuid,text,date,integer,timestamptz,timestamptz,text,text,text,text) from public, anon, authenticated;
grant execute on function public.close_due_events_v1() to service_role;
grant execute on function public.create_event_internal(uuid,text,date,integer,timestamptz,timestamptz,text,text,text,text) to service_role;

comment on column public.events.auto_close_at is
  'Server-owned deadline: scheduled_end_at + 30 minutes, otherwise 01:00 Asia/Seoul on the day after event_date.';
comment on column public.event_access_secrets.event_date is
  'Digest reservation date. Plain participant/operator codes are never stored.';
comment on function public.close_due_events_v1() is
  'Idempotently closes DRAFT, OPEN, or ACTIVE events whose server-owned deadline has passed. Intended for a reviewed Supabase Cron job.';
