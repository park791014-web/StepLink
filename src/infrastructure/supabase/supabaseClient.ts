import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { supabaseEncryptedStorageAdapter } from '../secure-session/webEncryptedStorage'

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

function configurationError() {
  if (!url || !anonKey) return 'Supabase URL과 공개 키 설정이 필요합니다.'
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return 'Supabase URL은 HTTPS여야 합니다.'
  } catch { return 'Supabase URL 형식이 올바르지 않습니다.' }
  return null
}

export const supabaseConfiguration = {
  configured: configurationError() === null,
  message: configurationError(),
}

let singleton: SupabaseClient | null = null

export function getSupabaseClient() {
  if (!supabaseConfiguration.configured) throw new Error(supabaseConfiguration.message ?? 'Supabase 설정을 확인하세요.')
  const web = Capacitor.getPlatform() === 'web'
  singleton ??= createClient(url, anonKey, {
    auth: {
      persistSession: web,
      storage: web ? supabaseEncryptedStorageAdapter : undefined,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return singleton
}
