# StepLink 0.2.1

StepLink는 개인 걷기·달리기 기록과 학교·단체 행사 운영을 결합한 Android 중심 GPS 활동 앱이다. 제품 원칙은 **Rich on the phone, minimal on the server**다. 상세 GPS와 개인 활동 기록은 Android native SQLite에 남기고 Supabase에는 행사 운영에 필요한 최소 데이터만 둔다.

## 현재 구현·검증 상태

Phase 1 개인 운동 핵심 흐름은 Android Studio build, APK 설치, 야외 약 0.41km 보행으로 확인했다. 화면 OFF 중에도 native GPS/SQLite 기록이 이어졌고 화면 복귀 뒤 거리·pace·예상 1km 시간·평균속도·diagnostics가 정상 반영됐다.

Phase 2의 Supabase 핵심 E2E도 실제 Android, PC browser, DB와 Edge Function 로그로 확인했다. 실제 project는 `umiszktzbthuqjcuegkz`(`ap-northeast-2`)이며 Anonymous Sign-In, server-only `STEPLINK_CODE_PEPPER`, migration `0001`~`0003`, JWT 검증을 사용하는 Edge Function 4개가 적용됐다. 실제 secret 값은 저장소와 문서에 없다.

확인한 핵심 흐름:

- Owner 행사 생성과 `event_access_secrets` digest/OWNER membership 생성
- `DRAFT → OPEN → ACTIVE → ENDED`, `started_at`/`ended_at` 기록
- Participant 다중 join과 `participant_live_state` 자동 생성
- 같은 식별번호/이름 recovery 시 participant row 중복 없이 새 Auth user로 재연결
- 운영 코드로 추가 Operator 연결
- `OPEN`과 `ACTIVE` 참가 허용, `DRAFT`와 `ENDED` 참가 차단
- 종료 상태와 종료 메시지 표시

이번 `0.2.1 / Build 3` source에는 실제 E2E에서 발견한 두 문제의 수정이 포함된다.

- Web Supabase auth와 event-session envelope를 non-extractable WebCrypto AES-GCM key + 랜덤 IV로 암호화해 IndexedDB에 저장한다. Participant, Operator, Owner와 Owner가 받은 행사 코드를 일반 browser refresh/restart 뒤 복원할 수 있는 코드 경로를 제공한다. 평문 token을 localStorage에 저장하지 않으며 IndexedDB가 막히면 탭 메모리만 사용한다.
- recovery로 이전 Auth user가 RLS 권한을 잃어 event 조회가 0행이 되면 `.maybeSingle()`로 처리한다. PostgREST 406 원문 대신 재연결 안내를 표시하고 해당 browser의 stale local event/auth session만 정리한다.
- lifecycle polling은 foreground에서 5초, visibility/focus 복귀 시 즉시 조회, hidden 상태에서는 건너뛰고 `ENDED`에서 종료한다.

위 수정은 unit test와 production build까지 확인했지만, 수정 후 browser 완전 종료/재시작 및 Android 소형화면 overflow는 다음 APK/browser smoke test가 남아 있다. 200~300명 load simulation, 장시간 행사, 다제조사·다브라우저 검증은 후속 항목이다.

## 행사 코드와 상태 정책

- 참가 코드: `0123456789ABCDEFGHJKMNPQRSTUVWXYZ`의 정확히 5문자. 숫자 0~9 허용, 영문 I/L/O 제외, trim + uppercase.
- 운영 코드: 참가 코드의 동일한 5문자 prefix + `ABCDEFGHJKMNPQRSTUVWXYZ`의 server-generated suffix 1문자.
- Owner가 참가 코드를 직접 지정할 수 있고 미입력 시 server가 Web Crypto rejection sampling으로 생성한다. 충돌의 최종 권위는 digest unique constraint다.
- DB에는 plain code가 아니라 목적별 HMAC-SHA-256 digest만 저장한다.
- 내부 상태는 `DRAFT`, `OPEN`, `ACTIVE`, `ENDED`; 사용자 화면은 준비중, 참가 접수중, 진행중, 종료로 표시한다.

## 실행 및 검증

```powershell
npm install --ignore-scripts
npm run test
npm run lint
npm run build
npm run cap:sync
```

Android Studio에서는 `android/`를 연다. CLI native build는 다음과 같다.

```powershell
cd android
.\gradlew.bat assembleDebug
```

## 환경 설정과 Windows BOM 주의

client `.env.local`에는 public 값만 둔다.

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Windows PowerShell 5.1의 `Set-Content -Encoding UTF8`은 BOM을 붙여 첫 번째 Vite 환경변수가 인식되지 않을 수 있다. ASCII 범위 값만 쓸 때는 `Set-Content -Encoding ASCII`, UTF-8이 필요하면 다음처럼 BOM 없이 작성한다.

```powershell
$text = "VITE_SUPABASE_URL=...`r`nVITE_SUPABASE_ANON_KEY=...`r`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path (Get-Location) '.env.local'), $text, $utf8NoBom)
```

`.env.local`은 gitignore 대상이다. publishable/anon key 외의 service-role key와 `STEPLINK_CODE_PEPPER`는 client, APK, 문서에 넣지 않는다.

기본 지도 배경 미표시 문제는 원인이 확정되지 않았다. GPS 저장과는 별개이며 production 지도 공급자와 선택형 offline map은 Phase 2 이후 항목이다.

상세 문서:

- [HANDOFF](HANDOFF.md)
- [Phase 0/1 아키텍처](docs/architecture/PHASE_0_1.md)
- [Phase 2 아키텍처와 배포](docs/architecture/PHASE_2.md)
- [Supabase 역할·검증 행렬](docs/SUPABASE_ROLE_MATRIX.md)
- [보안 검토](docs/SECURITY_REVIEW.md)
- [실기기·E2E 검증](docs/DEVICE_SMOKE_TEST.md)
