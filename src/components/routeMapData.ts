import type { FeatureCollection, MultiLineString, Point } from 'geojson'
import type { ActivityPoint } from '../domain/models'
import type { PeerLocation } from '../domain/live/liveTypes'

export const routeSourceData = (points: ActivityPoint[]): FeatureCollection<MultiLineString> => {
  const segments = points.slice(1).flatMap((point, index) => point.acceptedForMetrics
    ? [[[points[index].longitude, points[index].latitude], [point.longitude, point.latitude]]]
    : [])

  return {
    type: 'FeatureCollection',
    features: segments.length > 0 ? [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiLineString',
        coordinates: segments,
      },
    }] : [],
  }
}

export const reliablePointBearing = (point: ActivityPoint | undefined): number | null => point?.acceptedForMetrics
  && point.bearing !== null && Number.isFinite(point.bearing)
  && point.speed !== null && point.speed >= 0.8
  && point.accuracy !== null && point.accuracy <= 25
  ? ((point.bearing % 360) + 360) % 360 : null

export const ownLocationData = (point: ActivityPoint | undefined, fallbackHeading = 0): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: point ? [{
    type: 'Feature',
    properties: {
      heading: reliablePointBearing(point) ?? fallbackHeading,
    },
    geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
  }] : [],
})

export const peerLocationData = (locations: PeerLocation[]): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: locations.map((location) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] } })),
})
