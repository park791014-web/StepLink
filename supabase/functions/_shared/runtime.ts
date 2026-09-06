import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.114.0'
import { isParticipantEventCode, randomOperatorCodeSuffix, randomParticipantEventCode } from './eventCodePolicy.ts'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
})

function environmentKey(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new HttpError(503, `SERVER_MISSING_${name}`)
  return value
}

function keyFromMap(name: string, legacyName: string) {
  const encoded = Deno.env.get(name)
  if (encoded) {
    try {
      const keys = JSON.parse(encoded) as Record<string, string>
      if (keys.default) return keys.default
    } catch { throw new HttpError(503, `SERVER_INVALID_${name}`) }
  }
  return environmentKey(legacyName)
}

export function adminClient() {
  return createClient(environmentKey('SUPABASE_URL'), keyFromMap('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function authenticate(req: Request, admin: SupabaseClient): Promise<User> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new HttpError(401, 'AUTH_REQUIRED')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'AUTH_INVALID')
  return data.user
}

export function codePepper() {
  const pepper = environmentKey('STEPLINK_CODE_PEPPER')
  if (pepper.length < 32) throw new HttpError(503, 'SERVER_WEAK_CODE_PEPPER')
  return pepper
}

export async function hmacDigest(pepper: string, purpose: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${purpose}:${value}`))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function randomToken(bytes = 32) {
  const value = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function participantCode() {
  return randomParticipantEventCode()
}

export function operatorCode(participantEventCode: string) {
  if (!isParticipantEventCode(participantEventCode)) throw new Error('INVALID_PARTICIPANT_CODE_FORMAT')
  return `${participantEventCode}${randomOperatorCodeSuffix()}`
}

export function currentServiceDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export async function enforceRateLimit(admin: SupabaseClient, pepper: string, req: Request, userId: string, purpose: string, maximum: number) {
  const ip = (req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? 'unknown').split(',')[0].trim()
  const userFingerprint = await hmacDigest(pepper, 'rate-user', userId)
  const ipFingerprint = await hmacDigest(pepper, 'rate-ip', ip)
  const now = new Date(); now.setUTCSeconds(0, 0)
  const consume = (fingerprint: string, limit: number) => admin.rpc('consume_code_rate_limit_internal', {
    target_fingerprint: fingerprint, target_purpose: purpose, target_window: now.toISOString(), maximum_attempts: limit,
  })
  const [userLimit, ipLimit] = await Promise.all([consume(userFingerprint, maximum), consume(ipFingerprint, Math.min(maximum * 25, 100))])
  if (userLimit.error || ipLimit.error) throw new HttpError(500, 'RATE_LIMIT_CHECK_FAILED')
  if (!userLimit.data || !ipLimit.data) throw new HttpError(429, 'TOO_MANY_ATTEMPTS')
}

export async function parseBody(req: Request) {
  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > 16_384) throw new HttpError(413, 'REQUEST_TOO_LARGE')
  try { return await req.json() as Record<string, unknown> }
  catch { throw new HttpError(400, 'INVALID_JSON') }
}

export async function endpoint(req: Request, handler: (context: { req: Request; admin: SupabaseClient; user: User; pepper: string; body: Record<string, unknown> }) => Promise<unknown>) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const admin = adminClient()
    const user = await authenticate(req, admin)
    const pepper = codePepper()
    const body = await parseBody(req)
    return json(await handler({ req, admin, user, pepper, body }))
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR'
    return json({ error: message }, status)
  }
}
