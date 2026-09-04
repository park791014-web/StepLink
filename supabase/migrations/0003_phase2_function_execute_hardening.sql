-- StepLink Phase 2 remote hardening discovered by Supabase Security Advisor.
-- Supabase grants EXECUTE on newly-created public functions explicitly to anon/authenticated by default,
-- so revoke those role grants in addition to PUBLIC.

revoke execute on function public.consume_code_rate_limit_internal(text, text, timestamptz, integer) from anon, authenticated;
revoke execute on function public.create_event_internal(uuid, text, date, integer, timestamptz, timestamptz, text, text, text, text) from anon, authenticated;
revoke execute on function public.join_event_internal(uuid, uuid, text, text, text) from anon, authenticated;
revoke execute on function public.join_operator_internal(uuid, uuid, text) from anon, authenticated;

revoke execute on function public.is_event_operator(uuid) from anon;
revoke execute on function public.is_message_operator(uuid) from anon;
revoke execute on function public.transition_event(uuid, public.event_status) from anon;

-- Authenticated execution remains intentional for RLS helper functions and owner lifecycle transition.
grant execute on function public.is_event_operator(uuid) to authenticated;
grant execute on function public.is_message_operator(uuid) to authenticated;
grant execute on function public.transition_event(uuid, public.event_status) to authenticated;

-- Edge Functions call the internal functions through the service role.
grant execute on function public.consume_code_rate_limit_internal(text, text, timestamptz, integer) to service_role;
grant execute on function public.create_event_internal(uuid, text, date, integer, timestamptz, timestamptz, text, text, text, text) to service_role;
grant execute on function public.join_event_internal(uuid, uuid, text, text, text) to service_role;
grant execute on function public.join_operator_internal(uuid, uuid, text) to service_role;
