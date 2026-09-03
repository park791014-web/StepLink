import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { ActivityPoint } from '../domain/models'
import { activeMapProvider } from '../infrastructure/map/mapProvider'

interface Props { points: ActivityPoint[]; compact?: boolean }

const sourceData = (points: ActivityPoint[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features: points.length > 0 ? [{
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((point) => [point.longitude, point.latitude]) },
  }] : [],
})

export function RouteMap({ points, compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const initialPoints = useRef(points)

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const latest = initialPoints.current.at(-1)
    const map = new maplibregl.Map({
      container: container.current,
      style: activeMapProvider.styleUrl,
      center: latest ? [latest.longitude, latest.latitude] : [129.0684, 35.1507],
      zoom: latest ? 15 : 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: activeMapProvider.attribution }))
    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: sourceData(initialPoints.current) })
      map.addLayer({ id: 'route-shadow', type: 'line', source: 'route', paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.8 } })
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#d8ed62', 'line-width': 5 } })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(sourceData(points))
    const latest = points.at(-1)
    if (latest) map.easeTo({ center: [latest.longitude, latest.latitude], duration: 450 })
  }, [points])

  return (
    <div className={`route-map ${compact ? 'compact' : ''}`}>
      <div ref={container} className="map-canvas" />
      {points.length === 0 && <div className="map-empty"><span>GPS 연결 대기 중</span><small>첫 위치가 잡히면 경로가 표시됩니다</small></div>}
      {!activeMapProvider.productionReady && <span className="map-dev-badge">개발용 지도</span>}
    </div>
  )
}
