export type NetworkDirection = 'SEND' | 'RECEIVE'

export interface NetworkDiagnosticsSnapshot {
  apiBaseUrl: string
  lastDirection: NetworkDirection | null
  lastMethod: string | null
  lastEndpoint: string | null
  lastSendSuccessAt: string | null
  lastReceiveSuccessAt: string | null
  lastHttpStatus: number | null
  lastError: string | null
  failedEndpoint: string | null
}

const state: NetworkDiagnosticsSnapshot = {
  apiBaseUrl: '',
  lastDirection: null,
  lastMethod: null,
  lastEndpoint: null,
  lastSendSuccessAt: null,
  lastReceiveSuccessAt: null,
  lastHttpStatus: null,
  lastError: null,
  failedEndpoint: null,
}

const platformFetch = globalThis.fetch.bind(globalThis)

export function diagnosticEndpointFor(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : input.toString()
  try {
    const parsed = new URL(raw)
    const queryKeys = [...parsed.searchParams.keys()]
    return `${parsed.origin}${parsed.pathname}${queryKeys.length ? `?${queryKeys.join('&')}` : ''}`
  } catch {
    return raw.split('?')[0]
  }
}

export function networkDirectionFor(method: string, endpoint: string): NetworkDirection {
  if (method === 'GET' || method === 'HEAD' || endpoint.includes('/rpc/get_')) return 'RECEIVE'
  return 'SEND'
}

function errorDetail(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `; cause=${error.cause.name}: ${error.cause.message}` : ''
  return `${error.name}: ${error.message}${cause}`
}

export function configureNetworkDiagnostics(apiBaseUrl: string) {
  state.apiBaseUrl = apiBaseUrl
  console.info('StepLink network configuration', { apiBaseUrl })
}

export function getNetworkDiagnostics(): Readonly<NetworkDiagnosticsSnapshot> {
  return { ...state }
}

export function createDiagnosticFetch(transport: typeof fetch): typeof fetch {
  return async (input, init) => {
    const endpoint = diagnosticEndpointFor(input)
    const requestMethod = input instanceof Request ? input.method : 'GET'
    const method = (init?.method ?? requestMethod).toUpperCase()
    const direction = networkDirectionFor(method, endpoint)
    const startedAt = Date.now()
    state.lastDirection = direction
    state.lastMethod = method
    state.lastEndpoint = endpoint
    console.debug('StepLink network request', { direction, method, endpoint })

    try {
      const response = await transport(input, init)
      const completedAt = new Date().toISOString()
      state.lastHttpStatus = response.status
      state.lastError = response.ok ? null : `HTTP ${response.status}`
      state.failedEndpoint = response.ok ? null : endpoint
      if (response.ok) {
        if (direction === 'SEND') state.lastSendSuccessAt = completedAt
        else state.lastReceiveSuccessAt = completedAt
      }
      const detail = { direction, method, endpoint, status: response.status, elapsedMs: Date.now() - startedAt }
      if (response.ok) console.debug('StepLink network response', detail)
      else console.warn('StepLink network HTTP failure', detail)
      return response
    } catch (error) {
      const detail = errorDetail(error)
      state.lastHttpStatus = null
      state.lastError = detail
      state.failedEndpoint = endpoint
      console.warn('StepLink network transport failure', { direction, method, endpoint, elapsedMs: Date.now() - startedAt, error: detail })
      throw error
    }
  }
}

export const diagnosticFetch = createDiagnosticFetch(platformFetch)
