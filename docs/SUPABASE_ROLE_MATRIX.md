# Supabase 역할·정책 검증 행렬

갱신일: 2026-09-05

remote project `umiszktzbthuqjcuegkz`에는 `0001`~`0004`, `phase3_anonymous_peer_locations`와 기존 Edge Function이 적용됐다. local의 `0005_phase3_operational_hardening.sql`, cron activation, 수정된 event/operator join Function은 **remote 미적용**이다. 적용된 migration history는 수정하지 않는다.

| 행위 | Anonymous / 미가입 | Participant | Operator | Owner | 강제 지점 |
| --- | --- | --- | --- | --- | --- |
| code 검증 | Edge endpoint만 | Edge endpoint만 | Edge endpoint만 | Edge endpoint만 | JWT + user/IP rate limit + server HMAC |
| secret/rate table 조회 | 금지 | 금지 | 금지 | 금지 | RLS, no client policy, privilege revoke |
| event 조회 | 금지 | 가입 event만 | 운영 event만 | 소유 event | member RLS + helper |
| participant 조회 | 금지 | 자기 row만 | 운영 event rows | 소유 event rows | participant RLS |
| 다른 참가자 raw live row | 금지 | 금지 | 운영 event만 | 소유 event만 | live-state RLS |
| 익명 peer current 좌표 | 금지 | ACTIVE 가입 event의 self 제외·rounded recent point | 운영 화면은 raw event scope 사용 | 운영 화면은 raw event scope 사용 | `get_participant_peer_locations_v1` 내부 auth/scope 검사 |
| event 생성 | Edge를 통해 새 Owner | Edge를 통해 새 Owner | Edge를 통해 새 Owner | Edge Function | service-only internal function |
| lifecycle 변경 | 금지 | 금지 | 금지 | 자기 소유 event만 | `transition_event` owner 검사 |
| join/recovery | Edge endpoint | 같은 endpoint | 같은 endpoint | 같은 endpoint | atomic function + unique key |
| session digest 조회 | 금지 | 금지 | 금지 | 금지 | column-level privilege |
| live current-state 쓰기 | 금지 | 자기 participant + ACTIVE + 증가 sequence | 금지 | 금지 | `upsert_participant_live_state_v1` |
| live current-state 읽기 | 금지 | 자기 row만 | 운영 event만 | 소유 event만 | live RLS |
| 공지 발송 | 금지 | 금지 | 운영 event 대상만 | 소유 event 대상만 | `send_event_message_v1` |
| 공지 읽기 | 금지 | 자기 대상만 | 운영 event | 소유 event | message/recipient RLS |
| 도움 요청 | 금지 | 자기 participant + ACTIVE | 금지 | 금지 | `create_help_request_v1`, 60초 cooldown |
| 도움 상태 변경 | 금지 | 금지 | 운영 event, 순방향 전이 | 소유 event, 순방향 전이 | `transition_help_request_v1` |
| participant feed | 금지 | 자기 대상 message/help만 | 사용 안 함 | 사용 안 함 | `get_participant_feed_v1`, SECURITY INVOKER + RLS |
| 행사 자동 종료 실행 | 금지 | 금지 | 금지 | 직접 실행 금지 | scheduler/service role의 `close_due_events_v1` |

행사 참가 code는 `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`의 5문자, 운영 code는 동일 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ` suffix다. 입력은 trim/uppercase하며 DB에는 purpose별 digest만 둔다.

Participant location visibility의 현재 정책은 `ANONYMOUS_CURRENT`다. participant direct table SELECT는 자기 row만 허용한 채 별도 RPC가 ACTIVE event의 다른 참가자 중 5분 이내 current 좌표만 소수점 4자리로 낮춰 반환한다. 이름·학번·participant id·상태·거리·trail은 반환하지 않고 자기 자신을 제외한다. ENDED 시 빈 배열이 된다.

## 실제 E2E에서 확인한 항목

- Owner 1명, Operator 2명, Participant 5명 연결
- event/access-secret/OWNER membership/live-state 생성
- `DRAFT → OPEN → ACTIVE → ENDED`와 timestamp
- OPEN 및 ACTIVE 참가 허용, ENDED 참가 차단
- 같은 code/id/name recovery 시 row 중복 없이 `user_id` 재연결과 `last_recovered_at` 갱신
- 별도 Auth user의 Operator join
- 종료 메시지 노출

이 결과는 실제 Android/PC browser, DB와 Edge 로그로 확인됐다. 200~300명 load 및 모든 negative matrix 조합을 자동화한 결과는 아니다.

## Advisor와 execute 권한

0003 적용 전 internal SECURITY DEFINER 함수가 anon/authenticated에 직접 실행 가능하다는 경고가 있었다. 0003 이후 다음 함수는 anon/authenticated execute를 명시적으로 revoke하고 service role만 실행한다.

- `consume_code_rate_limit_internal`
- `create_event_internal`
- `join_event_internal`
- `join_operator_internal`

다음 authenticated execute는 의도됐다.

- `is_event_operator`: RLS helper
- `is_message_operator`: RLS helper
- `transition_event`: 함수 내부에서 실제 Owner 확인

`event_access_secrets`, `code_verification_attempts`의 RLS enabled + no policy INFO도 client 접근을 전부 차단하는 server-only 설계다. Advisor 숫자를 줄이기 위해 허용 policy를 만들지 않는다.

## Phase 3 source contract와 후속 negative/load 검증

0004는 operational table의 authenticated 직접 write privilege를 revoke하고 write RPC에 explicit grant한다. Write 함수는 `SECURITY DEFINER`, 빈 `search_path`, `auth.uid()`와 event/participant/operator scope 검사를 사용한다. Read-only participant feed는 `SECURITY INVOKER`로 기존 RLS를 그대로 적용한다. 익명 peer 함수도 public/anon revoke와 authenticated explicit grant를 사용하고 함수 내부에서 caller participant/event/ACTIVE를 확인한다. Remote catalog와 rollback-only authenticated-role/claim fixture에서 비참가·타 행사·self·stale 차단과 최소 반환 필드를 확인했다. Advisor의 authenticated SECURITY DEFINER WARN은 의도된 client RPC 경계로 기록한다.

0005는 code digest를 event date 단위로 예약하고 active lookup을 분리한다. 종료된 행사도 같은 날짜 예약은 유지하며 다른 날짜에는 같은 digest를 재사용할 수 있다. code-only join은 Asia/Seoul 기준 현재까지의 가장 최근 event date를 선택한다. auto-close 함수는 DRAFT/OPEN/ACTIVE만 ENDED로 idempotent 전환하고 public/anon/authenticated execute를 revoke한다. 이 변경과 cron은 아직 remote 미적용이며 local contract test만 통과했다.

1. 실제 Participant JWT로 다른 participant raw row 직접 읽기 거부와 익명 peer RPC 반환을 Android/HTTP E2E에서 재확인한다.
2. Participant/Operator가 lifecycle RPC를 실행하지 못하고 Owner만 가능한지 반복 검증한다.
3. 폐기 Operator가 즉시 RLS/session restore 권한을 잃는지 확인한다.
4. 잘못된 code 반복 시 user/IP rate limit과 학교 공유망 false positive를 측정한다.
5. 200/300 mock simulation은 완료했다. 실제 DB/API latency/error/request volume은 0004 적용 뒤 별도 test data로 측정한다.
6. Security Advisor와 catalog grant를 release 전 다시 기록한다.
