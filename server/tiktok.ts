import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const API = 'https://open.tiktokapis.com/v2'
const SCOPE = 'user.info.basic,video.upload,video.publish'
/** TikTok acepta el vídeo entero en una sola parte hasta 64 MB. */
const MAX_SINGLE_CHUNK = 64 * 1024 * 1024

type Tokens = { refreshToken: string; accessToken?: string; expiresAt?: number; user?: string }

let tokens: Tokens | null = null
let tokenFile = ''

const clientKey = (): string | undefined => process.env.TIKTOK_CLIENT_KEY
const clientSecret = (): string | undefined => process.env.TIKTOK_CLIENT_SECRET

/** TikTok exige que el redirect coincida exactamente con el registrado en la app. */
export const redirectUri = (): string =>
  `${(process.env.PUBLIC_URL ?? 'http://localhost:5174').replace(/\/$/, '')}/api/tiktok/callback`

export const loadTokens = async (dataDir: string): Promise<void> => {
  tokenFile = path.join(dataDir, 'tiktok.json')
  try {
    const saved = JSON.parse(await readFile(tokenFile, 'utf8')) as Tokens | null
    tokens = saved?.refreshToken ? saved : null
  } catch {
    tokens = null
  }
  /** El disco del hosting es temporal: el permiso también se guarda como variable de entorno. */
  const fromEnv = process.env.TIKTOK_REFRESH_TOKEN
  if (!tokens?.refreshToken && fromEnv) tokens = { refreshToken: fromEnv }
}

const saveTokens = async (): Promise<void> => {
  if (tokenFile) await writeFile(tokenFile, JSON.stringify(tokens, null, 2), 'utf8')
}

/** Guarda el permiso en el propio servicio de Render para que sobreviva a los reinicios. */
const rememberRefreshToken = async (refreshToken: string): Promise<void> => {
  const key = process.env.RENDER_API_KEY
  const service = process.env.RENDER_SERVICE_ID
  if (!key || !service || (process.env.TIKTOK_REFRESH_TOKEN ?? '') === refreshToken) return
  await fetch(`https://api.render.com/v1/services/${service}/env-vars/TIKTOK_REFRESH_TOKEN`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ value: refreshToken }),
  })
}

export const status = (): { configured: boolean; connected: boolean; user?: string } => ({
  configured: Boolean(clientKey() && clientSecret()),
  connected: Boolean(tokens?.refreshToken),
  user: tokens?.user,
})

export const authUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_key: clientKey() ?? '',
    scope: SCOPE,
    response_type: 'code',
    redirect_uri: redirectUri(),
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

const postForm = async (body: Record<string, string>): Promise<Record<string, unknown>> => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
    body: new URLSearchParams(body).toString(),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok || json.error) {
    throw new Error(String(json.error_description ?? json.error ?? `TikTok ${res.status}`))
  }
  return json
}

export const exchangeCode = async (code: string): Promise<void> => {
  const json = await postForm({
    client_key: clientKey() ?? '',
    client_secret: clientSecret() ?? '',
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  })
  const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : undefined
  if (!refreshToken) throw new Error('TikTok no devolvió refresh_token')
  const token = String(json.access_token)
  tokens = {
    refreshToken,
    accessToken: token,
    expiresAt: Date.now() + Number(json.expires_in ?? 86_000) * 1000,
  }
  tokens.user = (await creatorInfo(token).catch((): CreatorInfo => ({}))).creator_username
  await saveTokens()
  await rememberRefreshToken(refreshToken).catch(() => undefined)
}

const accessToken = async (): Promise<string> => {
  if (!tokens?.refreshToken) throw new Error('Conecta tu cuenta de TikTok primero')
  if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt > Date.now() + 60_000) {
    return tokens.accessToken
  }
  const json = await postForm({
    client_key: clientKey() ?? '',
    client_secret: clientSecret() ?? '',
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  })
  tokens.accessToken = String(json.access_token)
  tokens.expiresAt = Date.now() + Number(json.expires_in ?? 86_000) * 1000
  if (typeof json.refresh_token === 'string') tokens.refreshToken = json.refresh_token
  await saveTokens()
  await rememberRefreshToken(tokens.refreshToken).catch(() => undefined)
  return tokens.accessToken
}

export const disconnect = async (): Promise<void> => {
  tokens = null
  await saveTokens()
  await rememberRefreshToken('').catch(() => undefined)
}

type CreatorInfo = {
  creator_username?: string
  privacy_level_options?: string[]
  max_video_post_duration_sec?: number
}

const creatorInfo = async (token: string): Promise<CreatorInfo> => {
  const res = await fetch(`${API}/post/publish/creator_info/query/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
  })
  const json = (await res.json()) as { data?: CreatorInfo; error?: { code?: string; message?: string } }
  if (json.error && json.error.code !== 'ok') {
    throw new Error(json.error.message || json.error.code || 'TikTok rechazó la consulta')
  }
  return json.data ?? {}
}

/** Sin auditar, TikTok solo permite publicar en privado; si está disponible se publica en público. */
const pickPrivacy = (options: string[] | undefined, wanted: 'public' | 'private'): string => {
  const available = options ?? []
  if (wanted === 'public' && available.includes('PUBLIC_TO_EVERYONE')) return 'PUBLIC_TO_EVERYONE'
  if (available.includes('SELF_ONLY')) return 'SELF_ONLY'
  return available[0] ?? 'SELF_ONLY'
}

export type TikTokUpload = {
  videoFile: string
  title: string
  privacy: 'public' | 'private'
}

/** Publica el MP4 en TikTok y devuelve el `publish_id` con el que se puede seguir el estado. */
export const uploadVideo = async ({ videoFile, title, privacy }: TikTokUpload): Promise<string> => {
  const token = await accessToken()
  const info = await creatorInfo(token)
  const size = (await stat(videoFile)).size
  if (size > MAX_SINGLE_CHUNK) throw new Error('El vídeo supera los 64 MB que admite TikTok en una parte')

  const init = await fetch(`${API}/post/publish/video/init/`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({
      post_info: {
        title: title.slice(0, 2200),
        privacy_level: pickPrivacy(info.privacy_level_options, privacy),
        disable_duet: false,
        disable_stitch: false,
        disable_comment: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: size,
        chunk_size: size,
        total_chunk_count: 1,
      },
    }),
  })
  const json = (await init.json()) as {
    data?: { publish_id?: string; upload_url?: string }
    error?: { code?: string; message?: string }
  }
  if (!init.ok || !json.data?.upload_url || !json.data.publish_id) {
    throw new Error(json.error?.message || json.error?.code || `TikTok rechazó la subida (${init.status})`)
  }

  const put = await fetch(json.data.upload_url, {
    method: 'PUT',
    headers: {
      'content-type': 'video/mp4',
      'content-length': String(size),
      'content-range': `bytes 0-${size - 1}/${size}`,
    },
    body: Readable.toWeb(createReadStream(videoFile)) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  if (!put.ok) throw new Error(`TikTok no aceptó el archivo (${put.status})`)
  return json.data.publish_id
}
