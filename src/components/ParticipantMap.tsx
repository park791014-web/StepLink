import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { FeatureCollection, Point } from 'geojson'
import type { DashboardParticipant } from '../domain/live/liveTypes'
import { participantStatusLabel } from '../domain/live/livePolicy'
import { activeMapProvider } from '../infrastructure/map/mapProvider'
import { relativeTime } from '../shared/format'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

interface Props { participants: DashboardParticipant[]; selectedId: string | null; focusVersion: number; select: (id: string) => void }
const dataFor = (participants: DashboardParticipant[]): FeatureCollection<Point> => ({ type: 'FeatureCollection', features: participants.filter((item) => item.latitude != null && item.longitude != null).map((item) => ({ type: 'Feature', id: item.id, geometry: { type: 'Point', coordinates: [item.longitude!, item.latitude!] }, properties: { id: item.id, status: item.status } })) })

export function ParticipantMap({ participants, selectedId, focusVersion, select }: Props) {
  const container = useRef<HTMLDivElement>(null); const mapRef = useRef<maplibregl.Map | null>(null)
  const latest = useRef(participants); latest.current = participants
  const [mapError, setMapError] = useState<string | null>(null)
  useEffect(() => {
    if (!container.current || mapRef.current) return
    let map: maplibregl.Map
    try { map = new maplibregl.Map({ container: container.current, style: activeMapProvider.styleUrl, center: [129.0684, 35.1507], zoom: 11, attributionControl: false }) }
    catch (error) { setMapError(error instanceof Error ? error.message : 'WebGL 지도를 시작하지 못했습니다.'); return }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: activeMapProvider.id === 'openfreemap' ? undefined : activeMapProvider.attribution }), 'top-left')
    map.on('error', (event) => setMapError(event.error?.message || '지도 리소스를 불러오지 못했습니다.'))
    map.on('load', () => {
      map.addSource('participants', { type: 'geojson', data: dataFor(latest.current), cluster: true, clusterMaxZoom: 14, clusterRadius: 48 })
      map.addLayer({ id: 'participant-clusters', type: 'circle', source: 'participants', filter: ['has', 'point_count'], paint: { 'circle-color': '#173d35', 'circle-radius': ['step', ['get', 'point_count'], 18, 25, 23, 100, 29], 'circle-stroke-color': '#dced6d', 'circle-stroke-width': 3 } })
      map.addLayer({ id: 'participant-cluster-count', type: 'symbol', source: 'participants', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 }, paint: { 'text-color': '#ffffff' } })
      map.addLayer({ id: 'participant-points', type: 'circle', source: 'participants', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': ['match', ['get', 'status'], 'HELP_REQUEST', '#d94c35', 'OFFLINE', '#7a8581', 'STALE_LOCATION', '#e3a33b', '#55a481'], 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } })
      map.on('click', 'participant-clusters', async (event) => {
        const feature = event.features?.[0]; const source = map.getSource('participants') as maplibregl.GeoJSONSource
        const zoom = await source.getClusterExpansionZoom(Number(feature?.properties?.cluster_id))
        if (feature?.geometry.type === 'Point') map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom })
      })
      map.on('click', 'participant-points', (event) => {
        const id = String(event.features?.[0]?.properties?.id ?? ''); const item = latest.current.find((candidate) => candidate.id === id)
        if (!item || item.longitude == null || item.latitude == null) return
        select(id)
        const body = document.createElement('div'); body.className = 'participant-popup'
        const title = document.createElement('strong'); title.textContent = `${item.displayName} · ${item.participantIdentifier}`
        const detail = document.createElement('span'); detail.textContent = `${participantStatusLabel[item.status]} · ${relativeTime(item.lastReceivedAt)} · 정확도 ${item.accuracyM == null ? '-' : `${Math.round(item.accuracyM)}m`} · ${(item.distanceM / 1000).toFixed(2)}km`
        body.append(title, detail); new maplibregl.Popup().setLngLat([item.longitude, item.latitude]).setDOMContent(body).addTo(map)
      })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [select])
  useEffect(() => { const map = mapRef.current; if (map?.isStyleLoaded()) (map.getSource('participants') as maplibregl.GeoJSONSource | undefined)?.setData(dataFor(participants)) }, [participants])
  useEffect(() => { const item = participants.find((candidate) => candidate.id === selectedId); if (item?.longitude != null && item.latitude != null) mapRef.current?.easeTo({ center: [item.longitude, item.latitude], zoom: Math.max(mapRef.current.getZoom(), 15) }) }, [participants, selectedId, focusVersion])
  const hasLocations = participants.some((item) => item.latitude != null && item.longitude != null)
  return <div className="participant-map"><div ref={container} className="map-canvas" />{mapError && <div className="map-error"><strong>지도 표시 실패</strong><span>{mapError}</span></div>}{!mapError && !hasLocations && <div className="map-empty"><strong>아직 수신된 참가자 위치가 없습니다.</strong><span>참가자 위치가 수신되면 지도에 표시됩니다.</span></div>}{!activeMapProvider.productionReady && <span className="map-dev-badge">개발용 지도 · 운영 provider 미설정</span>}</div>
}
