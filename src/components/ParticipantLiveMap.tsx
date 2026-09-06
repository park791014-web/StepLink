import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import { activeMapProvider } from '../infrastructure/map/mapProvider'

interface Location { latitude: number; longitude: number; accuracyM: number | null }
interface Props { location: Location | null }

const ownLocationData = (location: Location | null): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: location ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [location.longitude, location.latitude] }, properties: {} }] : [],
})

export function ParticipantLiveMap({ location }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const latest = useRef(location); latest.current = location
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!container.current || mapRef.current) return
    let map: maplibregl.Map
    try {
      const initial = latest.current
      map = new maplibregl.Map({
        container: container.current,
        style: activeMapProvider.styleUrl,
        center: initial ? [initial.longitude, initial.latitude] : [129.0684, 35.1507],
        zoom: initial ? 15 : 11,
        attributionControl: false,
      })
    } catch { setFailed(true); return }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: activeMapProvider.id === 'openfreemap' ? undefined : activeMapProvider.attribution }), 'top-left')
    map.on('error', () => setFailed(true))
    map.on('load', () => {
      map.addSource('own-location', { type: 'geojson', data: ownLocationData(latest.current) })
      map.addLayer({ id: 'own-location-point', type: 'circle', source: 'own-location', paint: { 'circle-color': '#f07f62', 'circle-radius': 9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    ;(map.getSource('own-location') as maplibregl.GeoJSONSource | undefined)?.setData(ownLocationData(location))
    if (location) map.easeTo({ center: [location.longitude, location.latitude], zoom: Math.max(map.getZoom(), 14) })
  }, [location])

  return <div className="participant-live-map">
    <div ref={container} className="map-canvas" />
    {!location && !failed && <div className="map-empty"><strong>GPS 신호를 찾는 중입니다.</strong><span>위치가 확인되면 이 지도에 표시됩니다.</span></div>}
    {failed && <div className="map-empty"><strong>지도를 불러오지 못했습니다.</strong><span>위치 공유는 지도 표시와 별개로 계속 시도합니다.</span></div>}
    {!activeMapProvider.productionReady && <span className="map-dev-badge">개발용 지도 · 운영 provider 미설정</span>}
  </div>
}
