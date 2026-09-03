import assert from 'node:assert/strict'
import test from 'node:test'
import { averageKph, estimatedCalories, formatDuration, haversineMeters, paceMinutesPerKm } from './activityMath.ts'

test('activity metrics stay deterministic', () => {
  const distance = haversineMeters({ latitude: 35.1507, longitude: 129.0684 }, { latitude: 35.1516, longitude: 129.0684 })
  assert.ok(distance > 99 && distance < 102)
  assert.equal(formatDuration(3_661_000), '01:01:01')
  assert.equal(paceMinutesPerKm(1000, 360_000), 6)
  assert.equal(averageKph(1000, 360_000), 10)
  assert.equal(estimatedCalories(1000, 65, 'WALK'), 34)
})
