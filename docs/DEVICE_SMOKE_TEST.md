# Android Phase 1 smoke test

Native GPS core를 변경한 이번 빌드에서만 아래 회귀 확인을 수행한다.

1. 야외에서 Balanced로 활동 시작 후 위치·알림 권한을 허용한다.
2. foreground notification과 진단 화면의 `ACTIVE`를 확인한다.
3. 화면 ON 1분, OFF 10분 이동 후 앱으로 복귀한다.
4. native point가 화면 OFF 구간에도 증가했고 UI/recovered point가 reconciliation되는지 확인한다.
5. 일시정지 중 point가 추가되지 않고, 재개 후 새 point가 추가되는지 확인한다.
6. 앱을 background로 보낸 뒤 복귀하고 동일 activity id와 경로가 유지되는지 확인한다.
7. 종료 후 요약이 표시되고 로컬 activity가 삭제되지 않는지 확인한다.

강제 종료/제조사 절전/재부팅은 Android 정책과 기기별 변수가 있으므로 별도 장기 검증 항목이다. UI만 바꾼 후에는 이 장시간 테스트를 반복하지 않는다.
