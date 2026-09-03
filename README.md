# StepLink 0.1.0

Android 중심 GPS 활동 앱의 Phase 0/1 구현이다. 개인 걷기·달리기 기록은 Android Foreground Location Service가 WebView와 독립적으로 수집하고, 각 raw point를 앱 전용 SQLite에 즉시 저장한다.

## 실행

```powershell
npm install --ignore-scripts
npm run test
npm run lint
npm run build
npm run cap:sync
```

Android Studio에서 `android/`를 열어 실제 기기에 설치한다. CLI 빌드는 다음과 같다.

```powershell
cd android
.\gradlew.bat assembleDebug
```

## 현재 범위

- 첫 화면: 개인 운동 / 행사 참가 / 행사 운영
- 개인 운동: 걷기, 달리기, 자유 활동, AUTO
- start / pause / resume / end 및 앱 재실행 시 진행 중 활동 복원
- Android native FGS + Fused Location + native SQLite
- sequence 기반 UI reconciliation, raw/filtered 거리 분리
- MapLibre route, 교체 가능한 style provider
- GPS·배터리 진단, 로컬 설정, 활동 요약
- 후속 행사를 위한 domain model 및 Supabase/RLS migration 초안

행사 인증·실시간 위치·카메라·리포트는 Phase 2 이후 연결 지점만 준비했다.

## 개인정보와 환경변수

상세 GPS와 사진은 기본적으로 휴대폰에 남긴다. Supabase에는 행사 운영에 필요한 current state와 결과 요약만 전송하는 것이 원칙이다. `.env.example`에는 public anon 설정만 있으며 service-role key를 앱에 넣으면 안 된다.

기본 지도는 개발 확인용 MapLibre demo style이다. 배포 전 `VITE_MAP_STYLE_URL`을 운영 승인을 받은 공급자로 교체하며, OSM public tile을 production 트래픽에 직접 사용하지 않는다.

설계 문서는 [Phase 0/1 아키텍처](docs/architecture/PHASE_0_1.md), [native 이식 기록](docs/NATIVE_GPS_PORT.md), [보안 검토](docs/SECURITY_REVIEW.md)를 참고한다.
