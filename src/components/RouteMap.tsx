import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { ActivityPoint } from '../domain/models'
import type { PeerLocation } from '../domain/live/liveTypes'
import { activeMapProvider } from '../infrastructure/map/mapProvider'
import { ownLocationData, peerLocationData, reliablePointBearing, routeSourceData } from './routeMapData'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

interface Props { points: ActivityPoint[]; peerLocations?: PeerLocation[]; compact?: boolean }

type MapMode = 'FREE' | 'NORTH_UP' | 'NAVIGATION'

const nextMapMode = (mode: MapMode): MapMode => mode === 'FREE' ? 'NORTH_UP' : mode === 'NORTH_UP' ? 'NAVIGATION' : 'FREE'
const modeLabel: Record<MapMode, string> = { FREE: '자유 모드', NORTH_UP: '정북 모드', NAVIGATION: '네비 모드' }

const navigationBearing = (point: ActivityPoint | undefined) => {
  if (!point?.acceptedForMetrics || point.bearing === null || !Number.isFinite(point.bearing)) return 0
  if (point.speed === null || point.speed < 0.8 || point.accuracy === null || point.accuracy > 25) return 0
  return ((point.bearing % 360) + 360) % 360
}

const MapModeIcon = ({ mode }: { mode: MapMode }) => mode === 'FREE' ? (
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9 3.9-1.7Z"/></svg>
) : mode === 'NORTH_UP' ? (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V8M8 12l4-9 4 9-4-2-4 2Z"/><path d="M7 21v-5l4 5v-5"/></svg>
) : (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 7 17-7-3-7 3 7-17Z"/></svg>
)

const MyLocationIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>

const navigationPointerImage = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 48; canvas.height = 48
  const context = canvas.getContext('2d')
  if (!context) return null
  context.beginPath()
  context.moveTo(24, 3); context.lineTo(43, 42); context.lineTo(24, 34); context.lineTo(5, 42); context.closePath()
  context.fillStyle = '#ee3f34'; context.fill()
  context.lineWidth = 3; context.lineJoin = 'round'; context.strokeStyle = '#ffffff'; context.stroke()
  return context.getImageData(0, 0, 48, 48)
}

export function RouteMap({ points, peerLocations, compact = false }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>('FREE')
  const modeRef = useRef<MapMode>('FREE')
  const followRef = useRef(true)
  const followTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReliableBearing = useRef([...points].reverse().map(reliablePointBearing).find((value) => value !== null) ?? 0)
  const latestPoints = useRef(points)
  const latestPeers = useRef(peerLocations)
  latestPoints.current = points
  latestPeers.current = peerLocations

  useEffect(() => {
    if (!container.current || mapRef.current) return
    const latest = latestPoints.current.at(-1)
    const map = new maplibregl.Map({
      container: container.current,
      style: activeMapProvider.styleUrl,
      center: latest ? [latest.longitude, latest.latitude] : [129.0684, 35.1507],
      zoom: latest ? 15 : 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: activeMapProvider.id === 'openfreemap' ? undefined : activeMapProvider.attribution }), 'top-left')
    const pauseFollow = () => {
      followRef.current = false
      if (followTimer.current) clearTimeout(followTimer.current)
      followTimer.current = setTimeout(() => { followRef.current = true }, 4000)
    }
    const canvasContainer = map.getCanvasContainer()
    canvasContainer.addEventListener('pointerdown', pauseFollow, { passive: true })
    canvasContainer.addEventListener('wheel', pauseFollow, { passive: true })
    map.on('load', () => {
      map.addSource('peer-locations', { type: 'geojson', data: peerLocationData(latestPeers.current ?? []) })
      map.addLayer({ id: 'peer-locations', type: 'circle', source: 'peer-locations', paint: { 'circle-color': '#3788e8', 'circle-radius': 3.5, 'circle-opacity': 0.82, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } })
      map.addSource('route', { type: 'geojson', data: routeSourceData(latestPoints.current) })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#e45143', 'line-width': 2.5, 'line-opacity': 0.92, 'line-dasharray': [0, 2.4] },
      })
      map.addSource('own-location', { type: 'geojson', data: ownLocationData(latestPoints.current.at(-1), lastReliableBearing.current) })
      const pointer = navigationPointerImage()
      if (pointer) map.addImage('own-navigation-pointer', pointer, { pixelRatio: 2 })
      map.addLayer({ id: 'own-location', type: 'symbol', source: 'own-location', layout: { 'icon-image': 'own-navigation-pointer', 'icon-size': 0.82, 'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
    })
    mapRef.current = map
    return () => {
      canvasContainer.removeEventListener('pointerdown', pauseFollow)
      canvasContainer.removeEventListener('wheel', pauseFollow)
      if (followTimer.current) clearTimeout(followTimer.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.isStyleLoaded()) return
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(routeSourceData(points))
    const latest = points.at(-1)
    const bearing = reliablePointBearing(latest)
    if (bearing !== null) lastReliableBearing.current = bearing
    ;(map.getSource('own-location') as maplibregl.GeoJSONSource | undefined)?.setData(ownLocationData(latest, lastReliableBearing.current))
    if (latest && followRef.current) {
      const camera: maplibregl.EaseToOptions = { center: [latest.longitude, latest.latitude], duration: 450 }
      if (modeRef.current === 'NORTH_UP') camera.bearing = 0
      if (modeRef.current === 'NAVIGATION') camera.bearing = navigationBearing(latest)
      map.easeTo(camera)
    }
  }, [points])

  useEffect(() => {
    const source = mapRef.current?.getSource('peer-locations') as maplibregl.GeoJSONSource | undefined
    if (source) source.setData(peerLocationData(peerLocations ?? []))
  }, [peerLocations])

  const changeMapMode = () => {
    const next = nextMapMode(mapMode)
    modeRef.current = next
    setMapMode(next)
    followRef.current = true
    const map = mapRef.current
    const latest = latestPoints.current.at(-1)
    if (map && latest) map.easeTo({
      center: [latest.longitude, latest.latitude],
      ...(next === 'FREE' ? {} : { bearing: next === 'NAVIGATION' ? navigationBearing(latest) : 0 }),
      duration: 350,
    })
  }

  const centerOnCurrentLocation = () => {
    const map = mapRef.current
    const latest = latestPoints.current.at(-1)
    followRef.current = true
    if (followTimer.current) clearTimeout(followTimer.current)
    if (map && latest) map.easeTo({ center: [latest.longitude, latest.latitude], duration: 350 })
  }

  return (
    <div className={`route-map ${compact ? 'compact' : ''}`}>
      <div ref={container} className="map-canvas" />
      {points.length === 0 && <div className="map-empty"><span>GPS 연결 대기 중</span><small>첫 위치가 잡히면 경로가 표시됩니다</small></div>}
      {!activeMapProvider.productionReady && <span className="map-dev-badge">지도 설정 확인 필요</span>}
      <div className="map-action-controls">
        <button type="button" className={`map-action-button mode-${mapMode.toLowerCase()}`} onClick={changeMapMode} aria-label={`${modeLabel[mapMode]}: 지도 모드 변경`} title={modeLabel[mapMode]}><MapModeIcon mode={mapMode}/></button>
        <button type="button" className="map-action-button" onClick={centerOnCurrentLocation} aria-label="내 위치로 이동" title="내 위치"><MyLocationIcon/></button>
        <button type="button" className="map-action-button map-zoom-button" onClick={() => mapRef.current?.zoomIn()} aria-label="지도 확대" title="확대">+</button>
        <button type="button" className="map-action-button map-zoom-button" onClick={() => mapRef.current?.zoomOut()} aria-label="지도 축소" title="축소">−</button>
      </div>
    </div>
  )
}
