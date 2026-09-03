import { lazy, Suspense } from 'react'
import type { ActivityPoint } from '../domain/models'

const RouteMap = lazy(() => import('./RouteMap').then((module) => ({ default: module.RouteMap })))

export function LazyRouteMap({ points, compact = false }: { points: ActivityPoint[]; compact?: boolean }) {
  return (
    <Suspense fallback={<div className={`route-map ${compact ? 'compact' : ''}`}><div className="map-empty"><span>지도를 준비하는 중</span></div></div>}>
      <RouteMap points={points} compact={compact} />
    </Suspense>
  )
}
