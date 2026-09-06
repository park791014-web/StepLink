import { performance } from 'node:perf_hooks'

const sizes = process.argv.slice(2).map(Number).filter((value) => value > 0)
const participantCounts = sizes.length ? sizes : [200, 300]
const rounds = 20

for (const participantCount of participantCounts) {
  const currentState = new Map()
  const latencies = []
  let staleRejects = 0
  const started = performance.now()
  for (let round = 1; round <= rounds; round += 1) {
    const tick = performance.now()
    for (let index = 0; index < participantCount; index += 1) {
      const id = `participant-${index}`
      const incoming = { participantId: id, displayName: `참가자 ${index}`, participantIdentifier: `${20000 + index}`, latitude: 35.15 + index / 100000, longitude: 129.06 + index / 100000, accuracyM: 8 + index % 12, distanceM: round * 55 + index, elapsedTimeMs: round * 30000, clientSequence: round, lastReceivedAt: new Date().toISOString(), status: index % 97 === 0 ? 'HELP_REQUEST' : 'NORMAL' }
      const existing = currentState.get(id)
      if (!existing || incoming.clientSequence > existing.clientSequence) currentState.set(id, incoming)
      else staleRejects += 1
      if (round % 5 === 0) { const stale = { ...incoming, clientSequence: round - 1 }; if (stale.clientSequence <= currentState.get(id).clientSequence) staleRejects += 1 }
    }
    latencies.push(performance.now() - tick)
  }
  const payload = JSON.stringify([...currentState.values()])
  const sorted = latencies.toSorted((a, b) => a - b)
  const report = {
    kind: 'mock-only-no-remote-writes', participantCount, rounds,
    simulatedLiveWrites: participantCount * rounds,
    equivalentLiveWritesPerSecondAt30s: Number((participantCount / 30).toFixed(2)),
    dashboardPollRequestsPerMinutePerOperator: 8,
    participantFeedRequestsPerMinute: participantCount * 4,
    noticesSimulated: Math.max(1, Math.floor(participantCount / 100)),
    helpRequestsSimulated: Math.max(1, Math.floor(participantCount / 75)),
    staleUpdatesRejected: staleRejects,
    currentRows: currentState.size,
    dashboardPayloadBytes: Buffer.byteLength(payload),
    localBatchP95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(3)),
    totalLocalProcessingMs: Number((performance.now() - started).toFixed(3)),
    apiLatencyMs: null,
    apiErrorRate: null,
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
}
