# Vercel Owner/Operator 웹 배포

## 배포 대상

StepLink는 Vite SPA이며 production output은 `dist/`다. Vercel은 저장소 루트에서 `npm run build`를 실행하고 `dist/`를 정적 배포한다. `/operator` 또는 `/owner`를 직접 열면 행사 생성·운영 진입 화면이 표시되며, 브라우저에 암호화해 저장한 유효한 Owner/Operator 세션이 있으면 기존 행사 운영 화면으로 복원된다.

`vercel.json`은 실제 SPA 진입 경로인 `/operator`와 `/owner`만 `/index.html`로 rewrite한다. 이는 주소를 바꾸는 redirect가 아니며 직접 접속과 새로고침을 지원한다. `/assets/*`와 존재하지 않는 정적 파일은 rewrite하지 않으므로 잘못된 JavaScript MIME type을 성공 응답으로 숨기지 않는다. Supabase 요청은 기존 hosted HTTPS project로 브라우저에서 직접 전송하며 Vercel proxy나 serverless function을 추가하지 않는다.

모든 MapLibre 화면은 Vite의 `?worker&url` import로 생성한 hashed worker asset을 명시적으로 사용한다. package가 추론하는 `maplibre-gl-worker.mjs` 상대 경로에 의존하지 않는다.

## Production 환경변수

Vercel Project Settings의 Production 환경에 다음 public client 변수를 등록한다.

- 필수 `VITE_SUPABASE_URL`: hosted Supabase project HTTPS URL
- 필수 `VITE_SUPABASE_ANON_KEY`: Supabase public anon key
- 선택 `VITE_MAP_STYLE_URL`: 기본 OpenFreeMap style을 교체할 때만 설정
- 선택 `VITE_MAP_ATTRIBUTION`: 선택한 지도 provider의 attribution

`VITE_` 변수는 build 결과와 브라우저에 공개된다. `SUPABASE_SERVICE_ROLE_KEY`, secret key, `STEPLINK_CODE_PEPPER`, 데이터베이스 비밀번호를 Vercel frontend 환경변수로 등록하지 않는다. Preview와 Production이 같은 backend를 사용해야 한다면 두 환경에 명시적으로 같은 public 값만 등록하고, preview 접근 권한도 production과 동일한 RLS/RPC 경계를 따른다.

현재 프로젝트의 legacy anon key는 계속 지원되므로 이번 배포를 막지 않는다. Supabase가 legacy `anon`/`service_role` key를 2026년 말 폐기할 예정이므로, 공개 후 `VITE_SUPABASE_ANON_KEY` 소비 코드와 native live uploader를 함께 검증하면서 publishable key로 전환한다. secret key를 브라우저나 APK에 넣는 방식으로 대체하지 않는다.

`VITE_LIVE_UPLOAD_INTERVAL_MS`는 테스트용 participant upload cadence override다. Owner/Operator production 웹 배포에는 설정하지 않고 코드의 기본값을 유지한다.

## Native 경계

Owner/Operator 운영 흐름은 Supabase Auth/Edge Function/RPC와 MapLibre만 사용한다. Android `NativeGps`, foreground location service, SQLite activity history, native sync queue 및 `AppUi`는 플랫폼 guard 뒤에 있으며 웹 운영 화면에서 호출되지 않는다. Participant의 canonical GPS 기록과 background live upload는 계속 Android 전용이다.

개인운동은 웹에서 화면 미리보기 수준의 in-memory fallback이 있으므로 production 웹의 지원 기능으로 간주하지 않는다. 완료 활동 기록 화면은 웹에서 Android 전용이라는 안내를 표시한다.

## 배포 전 확인

1. `npm run test`
2. `npm run lint`
3. `npm run build`
4. Vercel 환경변수의 필수 두 값과 HTTPS URL 확인
5. Preview에서 `/operator` 직접 접속 및 새로고침 확인
6. Owner 생성 또는 기존 운영 코드 연결 후 dashboard polling, 지도, 공지, 도움 요청 처리 확인
7. 브라우저 개발자 도구에 service-role/pepper가 없고 Supabase 오류가 없는지 확인

실제 production deploy는 별도 승인 후 수행한다.
