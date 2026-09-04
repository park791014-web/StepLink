# Supabase 역할·정책 검증 행렬

갱신일: 2026-09-04

remote와 local migration은 `0001_phase0_schema.sql` → `0002_phase2_event_sessions.sql` → `0003_phase2_function_execute_hardening.sql` 순서로 일치한다. remote project `umiszktzbthuqjcuegkz`에는 세 migration과 Edge Function 4개가 적용됐다. 0003은 remote Advisor 확인 중 추가된 hardening을 local history에 반영한 것이므로 이번 작업에서 재적용하지 않는다.

| 행위 | Anonymous / 미가입 | Participant | Operator | Owner | 강제 지점 |
| --- | --- | --- | --- | --- | --- |
| code 검증 | Edge endpoint만 | Edge endpoint만 | Edge endpoint만 | Edge endpoint만 | JWT + user/IP rate limit + server HMAC |
| secret/rate table 조회 | 금지 | 금지 | 금지 | 금지 | RLS, no client policy, privilege revoke |
| event 조회 | 금지 | 가입 event만 | 운영 event만 | 소유 event | member RLS + helper |
| participant 조회 | 금지 | 자기 row만 | 운영 event rows | 소유 event rows | participant RLS |
| 다른 참가자 live 위치 | 금지 | 금지 | 운영 event만 | 소유 event만 | live-state RLS |
| event 생성 | Edge를 통해 새 Owner | Edge를 통해 새 Owner | Edge를 통해 새 Owner | Edge Function | service-only internal function |
| lifecycle 변경 | 금지 | 금지 | 금지 | 자기 소유 event만 | `transition_event` owner 검사 |
| join/recovery | Edge endpoint | 같은 endpoint | 같은 endpoint | 같은 endpoint | atomic function + unique key |
| session digest 조회 | 금지 | 금지 | 금지 | 금지 | column-level privilege |

행사 참가 code는 `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`의 5문자, 운영 code는 동일 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ` suffix다. 입력은 trim/uppercase하며 DB에는 purpose별 digest만 둔다.

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

## 후속 negative/load 검증

1. Participant가 다른 participant row/live state를 읽지 못하는지 자동화한다.
2. Participant/Operator가 lifecycle RPC를 실행하지 못하고 Owner만 가능한지 반복 검증한다.
3. 폐기 Operator가 즉시 RLS/session restore 권한을 잃는지 확인한다.
4. 잘못된 code 반복 시 user/IP rate limit과 학교 공유망 false positive를 측정한다.
5. 200~300명 foreground 5초 polling의 약 40~60 GET/s와 Edge join burst를 simulation한다.
6. Security Advisor와 catalog grant를 release 전 다시 기록한다.
