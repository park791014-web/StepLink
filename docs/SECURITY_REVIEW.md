# Dependency and security review

검토일: 2026-09-04

## 배포된 경계와 credential

`@supabase/supabase-js` 2.114.0을 lockfile에 고정했다. client가 읽는 변수는 public `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`뿐이다. 실제 project `umiszktzbthuqjcuegkz`에는 Anonymous Sign-In과 server-only `STEPLINK_CODE_PEPPER`가 설정됐고 Edge Function 4개는 `verify_jwt=true`로 배포됐다. service-role key, pepper 값, 실제 `.env.local`은 source·문서·bundle에 넣지 않는다.

## 행사 코드

- 참가 코드: `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`의 정확히 5문자. 숫자 0~9 허용, I/L/O 제외, trim/uppercase.
- 운영 코드: 같은 5문자 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ`의 server random suffix.
- random은 Web Crypto와 rejection sampling을 사용한다.
- Owner 지정/random 모두 server-side HMAC과 digest unique constraint로 충돌을 판정한다.
- DB에는 `join-code`, `operator-code`, `event-session` purpose별 HMAC-SHA-256 digest만 저장한다.
- user/IP rate limit을 함께 적용하고 secret table의 client SELECT를 금지한다.

실제 E2E에서 생성, participant/operator join, recovery, lifecycle, ENDED 차단을 확인했다. 짧은 human-entry code는 여전히 낮은 보증 인증이므로 rate limit과 pepper 경계를 제거하지 않는다.

## session storage

Android는 Keystore AES-256-GCM key와 SQLite ciphertext를 사용한다. access/refresh/event token과 Owner code는 암호화 object 안에 있고 Keystore key나 plain token/code를 SQLite에 저장하지 않는다.

Web은 Supabase auth custom storage와 StepLink event snapshot에 encrypted IndexedDB를 사용한다.

- non-extractable AES-256-GCM CryptoKey를 IndexedDB에 structured clone으로 저장
- write마다 12-byte random IV
- record는 version/IV/ciphertext 중심
- access token, refresh token, event session token, Owner code의 plaintext localStorage 저장 금지
- corrupt/decryption/JSON failure 시 record 삭제와 재연결 안내
- storage unavailable이면 persistent하지 않은 memory-only 동작; localStorage fallback 금지

브라우저 저장소는 Android Keystore와 같은 하드웨어·OS 격리 수준이 아니다. 같은 origin에서 XSS가 실행되면 앱과 같은 권한으로 CryptoKey와 암호문을 사용할 수 있다. 따라서 CSP, dependency pinning, XSS 예방이 필수이며 암호화는 디스크·단순 storage inspection 위험을 줄이는 방어층으로만 본다. private/incognito와 browser 정책에서는 persistence가 실패할 수 있다.

Owner가 local encrypted state/Keystore를 완전히 잃으면 서버는 digest에서 plain code를 되돌릴 수 없고 anonymous Owner credential도 자동 복구할 수 없다. code rotation 또는 Owner account/recovery는 후속 설계다.

## RLS, stale session, SECURITY DEFINER

Participant recovery는 기존 row의 `user_id`를 새 Auth user로 옮긴다. 이전 session이 event SELECT에서 0행을 받는 것은 정상 stale 상태다. client는 `.maybeSingle()`과 domain error를 사용해 PostgREST 406 원문을 숨기고, 해당 client의 local event/auth session만 정리한다. 새 session의 remote 상태는 변경하지 않는다.

remote migration `phase2_function_execute_hardening`과 동일한 `0003_phase2_function_execute_hardening.sql`을 local에 추가했다.

- Edge-only internal 함수 4개는 anon/authenticated execute를 revoke하고 service role만 grant한다.
- `is_event_operator`, `is_message_operator`는 RLS helper라 authenticated execute가 의도됐다.
- `transition_event`는 authenticated callable이지만 함수 내부에서 `owner_user_id = auth.uid()`를 검사한다.
- SECURITY DEFINER 함수는 빈 `search_path`와 schema-qualified object를 유지한다.
- `event_access_secrets`, `code_verification_attempts`는 RLS enabled + client policy 없음 + privilege revoke가 의도된 server-only table이다. Advisor INFO를 없애려고 client policy를 추가하지 않는다.

0003 전 Advisor의 internal function execute 경고는 해소됐다. 위 helper 경고와 server-only no-policy INFO는 설계상 남을 수 있으며, 경고 수를 0으로 만들기 위해 권한 경계를 약화하지 않는다.

## lifecycle polling과 부하

종료 전 foreground session은 5초 polling, focus/visibility 복귀 즉시 fetch, hidden skip, ENDED 뒤 stop이다. 200~300명이 모두 foreground면 평균 약 40~60 GET/s가 될 수 있다. 현재 Phase에서는 Realtime으로 무조건 전환하지 않으며 load simulation 뒤 polling/Realtime/Broadcast를 결정한다.

## Android backup과 변경 금지

Manifest `allowBackup=false`와 Android 11 이하/12+ backup exclusion rule을 유지한다. 이번 0.2.1에서 Android Keystore Java와 GPS core는 수정하지 않았다. `NativeGpsPlugin`, `StepLinkLocationService`, FusedLocationProviderClient, raw GPS/SQLite canonical path와 sampling profile은 변경 금지다.

## 남은 위험

- recovery는 code + participant identifier + 이름을 아는 사용자를 신뢰하는 낮은 보증 방식이다.
- 200~300명 load와 reverse-proxy IP/shared-network rate limit 튜닝 미실시.
- 수정 후 browser refresh/완전 재시작, private mode, 다양한 browser compatibility 실검증 필요.
- Android Keystore/DB upgrade와 소형화면 일정 overflow 재확인 필요.
- production 지도 공급자, live upload retention, 사진 검증은 후속 security gate다.
- 최근 알려진 audit은 moderate 3건, high/critical 0건이며 moderate는 개발용 Capacitor CLI 하위 의존성 경로다. `npm audit fix --force`는 실행하지 않는다.
