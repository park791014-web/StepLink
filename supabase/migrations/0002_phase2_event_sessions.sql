-- StepLink Phase 2: event lifecycle, atomic membership operations, session digests, and rate-limit state.
-- This migration preserves 0001 history and is intentionally not applied by the client.

alter table public.event_operators
  add column session_token_digest text,
  add column revoked_at timestamptz;

alter table public.participants
  add column last_recovered_at timestamptz;

-- Both short codes must be unique so the Edge boundary can resolve exactly one event.
create unique index event_access_operator_code_digest_unique
  on public.event_access_secrets(operator_code_digest);
comment on table public.event_access_secrets is
  'Stores only HMAC digests. Participant code is five uppercase alphanumeric characters excluding I, L, and O; operator code is that prefix plus one server-generated confusion-safe uppercase letter.';

-- 0001 did not have revocation state. Keep all existing RLS policies using this helper,
-- but make a revoked operator stop satisfying them immediately.
create or replace function public.is_event_operator(target_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.events e where e.id = target_event and e.owner_user_id = auth.uid())
    or exists(
      select 1 from public.event_operators eo
      where eo.event_id = target_event and eo.user_id = auth.uid() and eo.revoked_at is null
    );
$$;
revoke all on function public.is_event_operator(uuid) from public;
grant execute on function public.is_event_operator(uuid) to authenticated;

create table public.code_verification_attempts (
  actor_fingerprint text not null,
  purpose text not null check (purpose in ('CREATE_EVENT','JOIN_EVENT','JOIN_OPERATOR','VALIDATE_SESSION')),
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  updated_at timestamptz not null default now(),
  primary key (actor_fingerprint, purpose, window_started_at)
);
alter table public.code_verification_attempts enable row level security;
revoke all on public.event_access_secrets from anon, authenticated;
revoke all on public.code_verification_attempts from anon, authenticated;

-- 0001 allowed owners to update any events column directly. Replace that broad policy;
-- reads remain available through events_member_read and writes go through controlled functions.
drop policy if exists events_owner_all on public.events;
drop policy if exists participants_self_update on public.participants;

-- Qualify correlated outer columns from 0001. Without qualification PostgreSQL can
-- bind names such as event_id/id to the inner participant row instead of the
-- protected row, producing either false negatives or cross-event reads.
drop policy if exists events_member_read on public.events;
create policy events_member_read on public.events for select to authenticated using (
  public.is_event_operator(events.id) or exists(
    select 1 from public.participants p where p.event_id = events.id and p.user_id = auth.uid()
  )
);

drop policy if exists live_self_write on public.participant_live_state;
create policy live_self_write on public.participant_live_state for all to authenticated using (
  exists(select 1 from public.participants p where p.id = participant_live_state.participant_id and p.user_id = auth.uid())
) with check (
  exists(select 1 from public.participants p where p.id = participant_live_state.participant_id
    and p.event_id = participant_live_state.event_id and p.user_id = auth.uid())
);

drop policy if exists messages_participant_read on public.event_messages;
create policy messages_participant_read on public.event_messages for select to authenticated using (
  exists(select 1 from public.participants p where p.event_id = event_messages.event_id and p.user_id = auth.uid() and (
    event_messages.target_type = 'ALL' or
    (event_messages.target_type = 'PARTICIPANT' and event_messages.target_value = p.id::text) or
    (event_messages.target_type = 'GRADE' and event_messages.target_value = p.grade) or
    (event_messages.target_type = 'CLASS' and event_messages.target_value = p.class_name) or
    (event_messages.target_type = 'SELECTION' and exists(
      select 1 from public.event_message_recipients r
      where r.message_id = event_messages.id and r.participant_id = p.id
    ))
  ))
);

drop policy if exists recipients_self_or_operator_read on public.event_message_recipients;
create policy recipients_self_or_operator_read on public.event_message_recipients for select to authenticated using (
  exists(select 1 from public.participants p where p.id = event_message_recipients.participant_id and p.user_id = auth.uid())
  or public.is_message_operator(event_message_recipients.message_id)
);

drop policy if exists help_self_insert_read on public.help_requests;
create policy help_self_insert_read on public.help_requests for select to authenticated using (
  public.is_event_operator(help_requests.event_id) or exists(
    select 1 from public.participants p where p.id = help_requests.participant_id and p.user_id = auth.uid()
  )
);
drop policy if exists help_self_insert on public.help_requests;
create policy help_self_insert on public.help_requests for insert to authenticated with check (
  exists(select 1 from public.participants p where p.id = help_requests.participant_id
    and p.event_id = help_requests.event_id and p.user_id = auth.uid())
);

drop policy if exists results_self_or_operator_read on public.event_results;
create policy results_self_or_operator_read on public.event_results for select to authenticated using (
  public.is_event_operator(event_results.event_id) or exists(
    select 1 from public.participants p where p.id = event_results.participant_id and p.user_id = auth.uid()
  )
);

drop policy if exists photo_self_or_operator on public.photo_verifications;
create policy photo_self_or_operator on public.photo_verifications for select to authenticated using (
  public.is_event_operator(photo_verifications.event_id) or exists(
    select 1 from public.participants p where p.id = photo_verifications.participant_id and p.user_id = auth.uid()
  )
);
drop policy if exists photo_self_insert on public.photo_verifications;
create policy photo_self_insert on public.photo_verifications for insert to authenticated with check (
  photo_verifications.participant_id is not null and exists(
    select 1 from public.participants p where p.id = photo_verifications.participant_id
      and p.event_id = photo_verifications.event_id and p.user_id = auth.uid()
  )
);

drop policy if exists stickers_member_read on public.event_stickers;
create policy stickers_member_read on public.event_stickers for select to authenticated using (
  public.is_event_operator(event_stickers.event_id) or exists(
    select 1 from public.participants p where p.event_id = event_stickers.event_id and p.user_id = auth.uid()
  )
);

drop policy if exists course_member_read on public.event_courses;
create policy course_member_read on public.event_courses for select to authenticated using (
  public.is_event_operator(event_courses.event_id) or exists(
    select 1 from public.participants p where p.event_id = event_courses.event_id and p.user_id = auth.uid()
  )
);

create or replace function public.transition_event(target_event uuid, target_status public.event_status)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_event public.events%rowtype;
  updated_event public.events%rowtype;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;

  select * into current_event from public.events where id = target_event for update;
  if not found then raise exception using errcode = 'P0002', message = 'EVENT_NOT_FOUND'; end if;
  if current_event.owner_user_id <> auth.uid() then raise exception using errcode = '42501', message = 'OWNER_REQUIRED'; end if;
  if current_event.status = target_status then return current_event; end if;

  if not (
    (current_event.status = 'DRAFT' and target_status = 'OPEN') or
    (current_event.status = 'OPEN' and target_status = 'ACTIVE') or
    (current_event.status = 'ACTIVE' and target_status = 'ENDED')
  ) then raise exception using errcode = '22023', message = 'INVALID_EVENT_TRANSITION'; end if;

  update public.events
  set status = target_status,
      started_at = case when target_status = 'ACTIVE' then now() else started_at end,
      ended_at = case when target_status = 'ENDED' then now() else ended_at end,
      updated_at = now()
  where id = target_event
  returning * into updated_event;
  return updated_event;
end;
$$;
revoke all on function public.transition_event(uuid, public.event_status) from public;
grant execute on function public.transition_event(uuid, public.event_status) to authenticated;

create or replace function public.consume_code_rate_limit_internal(
  target_fingerprint text,
  target_purpose text,
  target_window timestamptz,
  maximum_attempts integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare current_attempts integer;
begin
  if maximum_attempts < 1 or maximum_attempts > 100 then raise exception 'INVALID_RATE_LIMIT'; end if;
  insert into public.code_verification_attempts(actor_fingerprint, purpose, window_started_at, attempt_count)
  values(target_fingerprint, target_purpose, target_window, 1)
  on conflict(actor_fingerprint, purpose, window_started_at)
  do update set attempt_count = public.code_verification_attempts.attempt_count + 1, updated_at = now()
  returning attempt_count into current_attempts;
  return current_attempts <= maximum_attempts;
end;
$$;
revoke all on function public.consume_code_rate_limit_internal(text, text, timestamptz, integer) from public;
grant execute on function public.consume_code_rate_limit_internal(text, text, timestamptz, integer) to service_role;

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
  if char_length(trim(target_name)) not between 1 and 120 then raise exception 'INVALID_EVENT_NAME'; end if;
  if target_expected_participants not between 1 and 10000 then raise exception 'INVALID_EXPECTED_PARTICIPANTS'; end if;
  if target_scheduled_start_at is not null and target_scheduled_end_at is not null and target_scheduled_end_at <= target_scheduled_start_at then
    raise exception 'INVALID_SCHEDULE';
  end if;

  insert into public.events(owner_user_id, name, event_date, expected_participants, scheduled_start_at, scheduled_end_at, end_message, status)
  values(target_owner_user_id, trim(target_name), target_event_date, target_expected_participants, target_scheduled_start_at, target_scheduled_end_at, nullif(trim(target_end_message), ''), 'DRAFT')
  returning * into created_event;

  insert into public.event_access_secrets(event_id, join_code_digest, operator_code_digest)
  values(created_event.id, target_join_code_digest, target_operator_code_digest);
  insert into public.event_operators(event_id, user_id, role, session_token_digest)
  values(created_event.id, target_owner_user_id, 'OWNER', target_session_token_digest);
  return created_event;
end;
$$;
revoke all on function public.create_event_internal(uuid, text, date, integer, timestamptz, timestamptz, text, text, text, text) from public;
grant execute on function public.create_event_internal(uuid, text, date, integer, timestamptz, timestamptz, text, text, text, text) to service_role;

create or replace function public.join_event_internal(
  target_event_id uuid,
  target_user_id uuid,
  target_identifier text,
  target_display_name text,
  target_session_token_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_event public.events%rowtype;
  current_participant public.participants%rowtype;
  normalized_name text := lower(regexp_replace(trim(target_display_name), '\s+', ' ', 'g'));
  was_recovered boolean := false;
begin
  if target_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if char_length(trim(target_identifier)) not between 1 and 80 then raise exception 'INVALID_IDENTIFIER'; end if;
  if char_length(trim(target_display_name)) not between 1 and 80 then raise exception 'INVALID_NAME'; end if;

  select * into current_event from public.events where id = target_event_id for update;
  if not found then raise exception 'EVENT_NOT_FOUND'; end if;
  if current_event.status not in ('OPEN','ACTIVE') then raise exception 'EVENT_NOT_JOINABLE'; end if;

  select * into current_participant from public.participants
  where event_id = target_event_id and participant_identifier = trim(target_identifier)
  for update;

  if found then
    if lower(regexp_replace(trim(current_participant.display_name), '\s+', ' ', 'g')) <> normalized_name then
      raise exception using errcode = 'P0001', message = 'PARTICIPANT_NAME_MISMATCH';
    end if;
    if current_participant.approval_status = 'BLOCKED' then raise exception 'PARTICIPANT_BLOCKED'; end if;
    if exists(select 1 from public.participants p where p.event_id = target_event_id and p.user_id = target_user_id and p.id <> current_participant.id) then
      raise exception 'DEVICE_ALREADY_JOINED_AS_ANOTHER_PARTICIPANT';
    end if;
    update public.participants
    set user_id = target_user_id, session_token_digest = target_session_token_digest,
        recovery_token_digest = target_session_token_digest, last_recovered_at = now(), updated_at = now()
    where id = current_participant.id returning * into current_participant;
    was_recovered := true;
  else
    insert into public.participants(event_id, user_id, participant_identifier, display_name, session_token_digest, recovery_token_digest)
    values(target_event_id, target_user_id, trim(target_identifier), trim(target_display_name), target_session_token_digest, target_session_token_digest)
    returning * into current_participant;
  end if;

  insert into public.participant_live_state(participant_id, event_id, status)
  values(current_participant.id, target_event_id, 'NORMAL') on conflict(participant_id) do nothing;

  return jsonb_build_object(
    'id', current_participant.id,
    'participantIdentifier', current_participant.participant_identifier,
    'displayName', current_participant.display_name,
    'recovered', was_recovered
  );
end;
$$;
revoke all on function public.join_event_internal(uuid, uuid, text, text, text) from public;
grant execute on function public.join_event_internal(uuid, uuid, text, text, text) to service_role;

create or replace function public.join_operator_internal(
  target_event_id uuid,
  target_user_id uuid,
  target_session_token_digest text
)
returns public.event_operators
language plpgsql
security definer
set search_path = ''
as $$
declare membership public.event_operators%rowtype;
begin
  if target_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists(select 1 from public.events e where e.id = target_event_id and e.status <> 'ENDED') then raise exception 'EVENT_NOT_AVAILABLE'; end if;
  insert into public.event_operators(event_id, user_id, role, session_token_digest, revoked_at)
  values(target_event_id, target_user_id, 'OPERATOR', target_session_token_digest, null)
  on conflict(event_id, user_id) do update
    set role = case when public.event_operators.role = 'OWNER' then 'OWNER'::public.event_role else 'OPERATOR'::public.event_role end,
        session_token_digest = excluded.session_token_digest, revoked_at = null, updated_at = now()
  returning * into membership;
  return membership;
end;
$$;
revoke all on function public.join_operator_internal(uuid, uuid, text) from public;
grant execute on function public.join_operator_internal(uuid, uuid, text) to service_role;

-- Data API grants are explicit; RLS still restricts rows. Secret/rate-limit tables remain server-only.
grant usage on schema public to authenticated;
-- Supabase projects may have broad default table privileges. Clear these two tables
-- before rebuilding column-scoped grants so token digests cannot leak via SELECT *.
revoke all on public.event_operators, public.participants from authenticated;
grant select on public.events, public.participant_live_state,
  public.event_messages, public.event_message_recipients, public.help_requests, public.event_results,
  public.photo_verifications, public.event_roster, public.event_stickers, public.event_courses, public.course_points to authenticated;
-- Never expose session/recovery digests through PostgREST, even to an event operator.
grant select (event_id, user_id, role, created_at, updated_at, revoked_at)
  on public.event_operators to authenticated;
grant select (id, event_id, user_id, participant_identifier, display_name, grade, class_name,
  approval_status, joined_at, created_at, updated_at, last_recovered_at)
  on public.participants to authenticated;
grant insert, update on public.participant_live_state to authenticated;
grant insert on public.help_requests, public.photo_verifications to authenticated;
grant update on public.help_requests to authenticated;
grant insert (event_id, user_id, role) on public.event_operators to authenticated;
grant update (role, revoked_at, updated_at) on public.event_operators to authenticated;
grant delete on public.event_operators to authenticated;
grant update (display_name, grade, class_name, approval_status, updated_at) on public.participants to authenticated;
grant insert, update, delete on public.event_messages, public.event_message_recipients,
  public.event_results, public.event_roster, public.event_stickers, public.event_courses, public.course_points to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Anonymous users receive only Auth API access through the public key. No public table is directly readable.
revoke all on all tables in schema public from anon;
