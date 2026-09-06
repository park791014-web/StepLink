-- StepLink Phase 3: current-state live operations, notices, and help workflow.
-- This migration intentionally stores one live row per participant, never a GPS trail.

create index if not exists participants_user_event_idx
  on public.participants (user_id, event_id);
create index if not exists event_operators_active_user_event_idx
  on public.event_operators (user_id, event_id)
  where revoked_at is null;

drop policy if exists live_self_write on public.participant_live_state;
create policy live_self_read on public.participant_live_state
  for select to authenticated
  using (participant_id in (
    select p.id from public.participants p where p.user_id = (select auth.uid())
  ));

-- RPCs below are the only authenticated write path for these operational tables.
revoke insert, update on public.participant_live_state from authenticated;
revoke insert, update, delete on public.event_messages from authenticated;
revoke insert, update, delete on public.event_message_recipients from authenticated;
revoke insert, update on public.help_requests from authenticated;

drop policy if exists messages_operator_write on public.event_messages;
drop policy if exists recipients_operator_write on public.event_message_recipients;
drop policy if exists help_self_insert on public.help_requests;
drop policy if exists help_operator_update on public.help_requests;

create or replace function public.upsert_participant_live_state_v1(
  target_event uuid,
  target_participant uuid,
  target_latitude double precision,
  target_longitude double precision,
  target_accuracy_m double precision,
  target_distance_m double precision,
  target_elapsed_time_ms bigint,
  target_client_sequence bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user uuid := auth.uid();
  participant_event uuid;
  event_status public.event_status;
  current_row public.participant_live_state%rowtype;
begin
  if caller_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if target_latitude not between -90 and 90 or target_longitude not between -180 and 180 then
    raise exception 'INVALID_LOCATION';
  end if;
  if target_accuracy_m is not null and (target_accuracy_m < 0 or target_accuracy_m > 10000) then raise exception 'INVALID_ACCURACY'; end if;
  if target_distance_m < 0 or target_elapsed_time_ms < 0 or target_client_sequence <= 0 then raise exception 'INVALID_LIVE_STATE'; end if;

  select p.event_id, e.status into participant_event, event_status
  from public.participants p join public.events e on e.id = p.event_id
  where p.id = target_participant and p.user_id = caller_user
  for share of p, e;
  if not found or participant_event <> target_event then raise exception 'PARTICIPANT_SCOPE_DENIED'; end if;
  if event_status <> 'ACTIVE' then raise exception 'EVENT_NOT_ACTIVE'; end if;

  insert into public.participant_live_state (
    participant_id, event_id, latitude, longitude, accuracy_m, status,
    distance_m, elapsed_time_ms, client_sequence, last_received_at, updated_at
  ) values (
    target_participant, target_event, target_latitude, target_longitude, target_accuracy_m, 'NORMAL',
    target_distance_m, target_elapsed_time_ms, target_client_sequence, now(), now()
  )
  on conflict (participant_id) do update set
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    accuracy_m = excluded.accuracy_m,
    status = case when public.participant_live_state.status = 'HELP_REQUEST' then 'HELP_REQUEST'::public.participant_status else 'NORMAL'::public.participant_status end,
    distance_m = excluded.distance_m,
    elapsed_time_ms = excluded.elapsed_time_ms,
    client_sequence = excluded.client_sequence,
    last_received_at = excluded.last_received_at,
    updated_at = excluded.updated_at
  where public.participant_live_state.event_id = excluded.event_id
    and public.participant_live_state.client_sequence < excluded.client_sequence
  returning * into current_row;

  if found then
    return jsonb_build_object('accepted', true, 'clientSequence', current_row.client_sequence, 'lastReceivedAt', current_row.last_received_at);
  end if;
  select * into current_row from public.participant_live_state where participant_id = target_participant;
  return jsonb_build_object('accepted', false, 'clientSequence', current_row.client_sequence, 'lastReceivedAt', current_row.last_received_at);
end;
$$;

create or replace function public.send_event_message_v1(
  target_event uuid,
  target_type text,
  target_value text,
  target_body text,
  target_participant_ids uuid[] default array[]::uuid[]
) returns public.event_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user uuid := auth.uid();
  normalized_type text := upper(trim(target_type));
  normalized_value text := nullif(trim(target_value), '');
  result public.event_messages%rowtype;
begin
  if caller_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_event_operator(target_event) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if not exists (select 1 from public.events e where e.id = target_event and e.status = 'ACTIVE') then raise exception 'EVENT_NOT_ACTIVE'; end if;
  if normalized_type not in ('ALL','GRADE','CLASS','PARTICIPANT','SELECTION') then raise exception 'INVALID_MESSAGE_TARGET'; end if;
  if char_length(trim(target_body)) not between 1 and 1000 then raise exception 'INVALID_MESSAGE_BODY'; end if;
  if normalized_type in ('GRADE','CLASS','PARTICIPANT') and normalized_value is null then raise exception 'MESSAGE_TARGET_REQUIRED'; end if;
  if normalized_type = 'PARTICIPANT' and not exists (
    select 1 from public.participants p where p.event_id = target_event and p.id::text = normalized_value
  ) then raise exception 'PARTICIPANT_SCOPE_DENIED'; end if;
  if normalized_type = 'SELECTION' then
    if coalesce(cardinality(target_participant_ids), 0) not between 1 and 300 then raise exception 'INVALID_MESSAGE_SELECTION'; end if;
    if exists (
      select 1 from unnest(target_participant_ids) selected(id)
      where not exists (select 1 from public.participants p where p.event_id = target_event and p.id = selected.id)
    ) then raise exception 'PARTICIPANT_SCOPE_DENIED'; end if;
  end if;

  insert into public.event_messages(event_id, sender_user_id, body, target_type, target_value)
  values (target_event, caller_user, trim(target_body), normalized_type, case when normalized_type in ('GRADE','CLASS','PARTICIPANT') then normalized_value else null end)
  returning * into result;
  if normalized_type = 'SELECTION' then
    insert into public.event_message_recipients(message_id, participant_id)
    select result.id, selected.id from (select distinct unnest(target_participant_ids) id) selected;
  end if;
  return result;
end;
$$;

create or replace function public.create_help_request_v1(
  target_event uuid,
  target_participant uuid,
  target_request_type text,
  target_latitude double precision,
  target_longitude double precision,
  target_accuracy_m double precision,
  target_idempotency_key uuid
) returns public.help_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user uuid := auth.uid();
  normalized_type text := upper(trim(target_request_type));
  current_event_status public.event_status;
  result public.help_requests%rowtype;
begin
  if caller_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select e.status into current_event_status
  from public.participants p join public.events e on e.id = p.event_id
  where p.id = target_participant and p.event_id = target_event and p.user_id = caller_user;
  if not found then raise exception 'PARTICIPANT_SCOPE_DENIED'; end if;
  select * into result from public.help_requests where idempotency_key = target_idempotency_key;
  if found then
    if result.participant_id <> target_participant then raise exception 'IDEMPOTENCY_SCOPE_DENIED'; end if;
    return result;
  end if;
  if normalized_type not in ('INJURY','LOST','COMPANION','OTHER') then raise exception 'INVALID_HELP_TYPE'; end if;
  if target_latitude is not null and target_latitude not between -90 and 90 then raise exception 'INVALID_LOCATION'; end if;
  if target_longitude is not null and target_longitude not between -180 and 180 then raise exception 'INVALID_LOCATION'; end if;
  if target_accuracy_m is not null and (target_accuracy_m < 0 or target_accuracy_m > 10000) then raise exception 'INVALID_ACCURACY'; end if;
  if current_event_status <> 'ACTIVE' then raise exception 'EVENT_NOT_ACTIVE'; end if;
  if exists (
    select 1 from public.help_requests h
    where h.participant_id = target_participant and h.created_at > now() - interval '60 seconds'
  ) then raise exception 'HELP_REQUEST_COOLDOWN'; end if;

  insert into public.help_requests(event_id, participant_id, request_type, status, latitude, longitude, accuracy_m, location_received_at, idempotency_key)
  values (target_event, target_participant, normalized_type, 'OPEN', target_latitude, target_longitude, target_accuracy_m, case when target_latitude is null then null else now() end, target_idempotency_key)
  returning * into result;
  update public.participant_live_state set status = 'HELP_REQUEST', updated_at = now()
  where participant_id = target_participant and event_id = target_event;
  return result;
end;
$$;

create or replace function public.transition_help_request_v1(
  target_request uuid,
  target_status text
) returns public.help_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user uuid := auth.uid();
  normalized_status text := upper(trim(target_status));
  current_row public.help_requests%rowtype;
begin
  if caller_user is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into current_row from public.help_requests where id = target_request for update;
  if not found or not public.is_event_operator(current_row.event_id) then raise exception 'OPERATOR_SCOPE_DENIED'; end if;
  if normalized_status = current_row.status::text then return current_row; end if;
  if not ((current_row.status = 'OPEN' and normalized_status = 'ACKNOWLEDGED') or
          (current_row.status = 'ACKNOWLEDGED' and normalized_status = 'RESOLVED')) then
    raise exception 'INVALID_HELP_TRANSITION';
  end if;
  update public.help_requests set
    status = normalized_status,
    acknowledged_by = case when normalized_status = 'ACKNOWLEDGED' then caller_user else acknowledged_by end,
    acknowledged_at = case when normalized_status = 'ACKNOWLEDGED' then now() else acknowledged_at end,
    resolved_at = case when normalized_status = 'RESOLVED' then now() else resolved_at end,
    updated_at = now()
  where id = target_request returning * into current_row;
  if normalized_status = 'RESOLVED' then
    update public.participant_live_state set status = 'NORMAL', updated_at = now()
    where participant_id = current_row.participant_id and status = 'HELP_REQUEST';
  end if;
  return current_row;
end;
$$;

create or replace function public.get_participant_feed_v1(
  target_event uuid,
  target_participant uuid
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(to_jsonb(message_row) order by message_row.created_at desc)
      from (
        select m.id, m.body, m.sender_user_id, m.target_type, m.target_value, m.created_at
        from public.event_messages m
        where m.event_id = target_event
        order by m.created_at desc
        limit 20
      ) message_row
    ), '[]'::jsonb),
    'helpRequests', coalesce((
      select jsonb_agg(to_jsonb(help_row) order by help_row.created_at desc)
      from (
        select h.id, h.participant_id, h.request_type, h.status, h.latitude, h.longitude,
          h.accuracy_m, h.created_at, h.acknowledged_at, h.resolved_at
        from public.help_requests h
        where h.event_id = target_event and h.participant_id = target_participant
        order by h.created_at desc
        limit 10
      ) help_row
    ), '[]'::jsonb)
  )
  from public.participants p
  where p.id = target_participant and p.event_id = target_event and p.user_id = (select auth.uid());
$$;

revoke all on function public.upsert_participant_live_state_v1(uuid,uuid,double precision,double precision,double precision,double precision,bigint,bigint) from public, anon;
revoke all on function public.send_event_message_v1(uuid,text,text,text,uuid[]) from public, anon;
revoke all on function public.create_help_request_v1(uuid,uuid,text,double precision,double precision,double precision,uuid) from public, anon;
revoke all on function public.transition_help_request_v1(uuid,text) from public, anon;
revoke all on function public.get_participant_feed_v1(uuid,uuid) from public, anon;
grant execute on function public.upsert_participant_live_state_v1(uuid,uuid,double precision,double precision,double precision,double precision,bigint,bigint) to authenticated;
grant execute on function public.send_event_message_v1(uuid,text,text,text,uuid[]) to authenticated;
grant execute on function public.create_help_request_v1(uuid,uuid,text,double precision,double precision,double precision,uuid) to authenticated;
grant execute on function public.transition_help_request_v1(uuid,text) to authenticated;
grant execute on function public.get_participant_feed_v1(uuid,uuid) to authenticated;

comment on function public.upsert_participant_live_state_v1(uuid,uuid,double precision,double precision,double precision,double precision,bigint,bigint)
  is 'Phase 3 authenticated latest-current-state upsert; rejects stale client_sequence and non-ACTIVE events.';
comment on table public.participant_live_state
  is 'One current operational row per participant. Never use this table as a detailed GPS trail.';
