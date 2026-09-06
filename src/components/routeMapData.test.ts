import test from 'node:test'
import assert from 'node:assert/strict'
import type { ActivityPoint } from '../domain/models.ts'
import { ownLocationData, peerLocationData, routeSourceData } from './routeMapData.ts'

const point = (sequence: number, acceptedForMetrics: boolean, latitude = 35 + sequence / 1000, longitude = 129 + sequence / 1000): ActivityPoint => ({
  activityId: 'activity', sequence, timestamp: sequence * 1000, latitude, longitude,
  accuracy: 5, speed: 1, bearing: null, altitude: null, provider: 'gps', mock: false,
  storedAt: sequence * 1000, rawSegmentDistanceM: 10, filteredSegmentDistanceM: acceptedForMetrics ? 10 : 0,
  classification: 'walkingCandidate', acceptedForMetrics, filterReason: acceptedForMetrics ? null : 'teleport',
})

test('walking map uses accepted local GPS segments and omits rejected jumps', () => {
  const source = routeSourceData([point(1, true), point(2, true), point(3, false), point(4, true)])
  const lines = source.features[0].geometry.coordinates
  assert.equal(lines.length, 2)
  assert.deepEqual(lines[0], [[129.001, 35.001], [129.002, 35.002]])
  assert.deepEqual(lines[1], [[129.003, 35.003], [129.004, 35.004]])
})

test('walking map keeps own current position separate from anonymous peers', () => {
  assert.deepEqual(ownLocationData(point(2, true)).features[0].geometry.coordinates, [129.002, 35.002])
  const peers = peerLocationData([{ latitude: 35.1, longitude: 129.1, lastReceivedAt: '2026-09-05T00:00:00Z' }])
  assert.deepEqual(peers.features[0].geometry.coordinates, [129.1, 35.1])
  assert.deepEqual(peers.features[0].properties, {})
})

test('own navigation pointer retains the last reliable heading when GPS bearing is unstable', () => {
  const reliable = { ...point(2, true), bearing: 87, speed: 1.2, accuracy: 8 }
  assert.equal(ownLocationData(reliable).features[0].properties?.heading, 87)
  assert.equal(ownLocationData(point(3, true), 87).features[0].properties?.heading, 87)
})
