-- Phase 3 participant map: expose only recent, de-identified peer locations.
-- Direct participant_live_state SELECT remains self-only; this RPC is the sole peer read path.

create or replace function public.get_participant_peer_locations_v1(
  target_event uuid,
  target_participant uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'latitude', round(live.latitude::numeric, 4)::double precision,
      'longitude', round(live.longitude::numeric, 4)::double precision,
      'lastReceivedAt', live.last_received_at
    ) order by live.last_received_at desc
  ), '[]'::jsonb)
  from public.participants caller
  join public.events event on event.id = caller.event_id
  join public.participant_live_state live on live.event_id = caller.event_id
  where caller.id = target_participant
    and caller.event_id = target_event
    and caller.user_id = (select auth.uid())
    and event.status = 'ACTIVE'
    and live.participant_id <> caller.id
    and live.latitude is not null
    and live.longitude is not null
    and live.last_received_at > now() - interval '5 minutes';
$$;

revoke all on function public.get_participant_peer_locations_v1(uuid,uuid) from public, anon;
grant execute on function public.get_participant_peer_locations_v1(uuid,uuid) to authenticated;

comment on function public.get_participant_peer_locations_v1(uuid,uuid)
  is 'Returns only rounded current coordinates and receipt time for other ACTIVE-event participants; no identity or trail.';
