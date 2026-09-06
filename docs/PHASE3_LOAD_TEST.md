# Phase 3 load simulation

`npm run load:phase3`는 remote를 변경하지 않는 deterministic mock simulation이다. participant current-state latest-wins, stale sequence reject, dashboard payload 크기와 30초 등가 write rate를 계산한다.

2026-09-05 재실행 결과:

| 참가자 | current rows | simulated writes | 30초 등가 writes/s | dashboard JSON | local batch p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 200 | 200 | 4,000 | 6.67 | 55,658 bytes | 6.421 ms |
| 300 | 300 | 6,000 | 10.00 | 83,629 bytes | 4.116 ms |

각 경우 stale update 800/1,200건을 거부했고 최종 row 수는 participant 수와 같았다. dashboard는 operator당 분당 8회다. Participant message/help를 단일 feed RPC로 합쳐 15초 feed는 200명에서 분당 800회, 300명에서 1,200회다. 기존 두 query였다면 1,600/2,400회였다. 5초 lifecycle을 포함한 총 participant GET 예상은 4,000→3,200 req/min, 6,000→4,800 req/min으로 20% 감소한다.

이 수치는 in-memory 처리 성능이지 Supabase DB/API 성능이 아니다. `apiLatencyMs`와 `apiErrorRate`는 `null`; Free tier 적합성, 실제 request volume, DB write throughput은 미측정이다. 0004 적용 뒤 별도 test event에서 작은 규모부터 올리고, production/test 식별과 cleanup을 확인해야 한다. 기존 행사나 row를 삭제하지 않는다.
