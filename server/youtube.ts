import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

type Tokens = { refreshToken: string; accessToken?: string; expiresAt?: number; channel?: string }

let tokens: Tokens | null = null
let tokenFile = ''

export type Privacy = 'private' | 'unlisted' | 'public'

export const clientId = (): string | undefined => process.env.YOUTUBE_CLIENT_ID
const clientSecret = (): string | undefined => process.env.YOUTUBE_CLIENT_SECRET

/** URL pública de la app; Google exige que el redirect coincida con el registrado en la consola. */
export const redirectUri = (): string =>
  `${(process.env.PUBLIC_URL ?? 'http://localhost:5174').replace(/\/$/, '')}/api/youtube/callback`

export const loadTokens = async (dataDir: string): Promise<void> => {
  tokenFile = path.join(dataDir, 'youtube.json')
  try {
    tokens = JSON.parse(await readFile(tokenFile, 'utf8')) as Tokens
  } catch {
    tokens = null
  }
}

const saveTokens = async (): Promise<void> => {
  if (tokenFile) await writeFile(tokenFile, JSON.stringify(tokens, null, 2), 'utf8')
}

export const status = (): { configured: boolean; connected: boolean; channel?: string } => ({
  configured: Boolean(clientId() && clientSecret()),
  connected: Boolean(tokens?.refreshToken),
  channel: tokens?.channel,
})

export const authUrl = (): string => {
  const params = new URLSearchParams({
    client_id: clientId() ?? '',
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

const postForm = async (body: Record<string, string>): Promise<Record<string, unknown>> => {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(String(json.error_description ?? json.error ?? 'OAuth error'))
  return json
}

export const exchangeCode = async (code: string): Promise<void> => {
  const json = await postForm({
    code,
    client_id: clientId() ?? '',
    client_secret: clientSecret() ?? '',
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  })
  const refreshToken = typeof json.refresh_token === 'string' ? json.refresh_token : tokens?.refreshToken
  if (!refreshToken) throw new Error('Google no devolvió refresh_token')
  tokens = {
    refreshToken,
    accessToken: String(json.access_token),
    expiresAt: Date.now() + Number(json.expires_in ?? 3500) * 1000,
  }
  tokens.channel = await fetchChannelTitle(tokens.accessToken ?? '')
  await saveTokens()
}

const accessToken = async (): Promise<string> => {
  if (!tokens?.refreshToken) throw new Error('Conecta tu cuenta de YouTube primero')
  if (tokens.accessToken && tokens.expiresAt && tokens.expiresAt > Date.now() + 30_000) return tokens.accessToken
  const json = await postForm({
    refresh_token: tokens.refreshToken,
    client_id: clientId() ?? '',
    client_secret: clientSecret() ?? '',
    grant_type: 'refresh_token',
  })
  tokens.accessToken = String(json.access_token)
  tokens.expiresAt = Date.now() + Number(json.expires_in ?? 3500) * 1000
  await saveTokens()
  return tokens.accessToken
}

const fetchChannelTitle = async (token: string): Promise<string | undefined> => {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) return undefined
  const json = (await res.json()) as { items?: { snippet?: { title?: string } }[] }
  return json.items?.[0]?.snippet?.title
}

export const disconnect = async (): Promise<void> => {
  tokens = null
  await saveTokens()
}

type UploadOptions = {
  videoFile: string
  thumbFile?: string
  title: string
  description: string
  tags: string[]
  privacy: Privacy
}

/** Sube el MP4 con el protocolo reanudable y, si hay portada, la fija como miniatura. */
export const uploadVideo = async ({
  videoFile,
  thumbFile,
  title,
  description,
  tags,
  privacy,
}: UploadOptions): Promise<string> => {
  const token = await accessToken()
  const size = (await stat(videoFile)).size
  const start = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: { title: title.slice(0, 100), description: description.slice(0, 4900), tags },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    },
  )
  if (!start.ok) throw new Error(`YouTube rechazó la subida: ${await start.text()}`)
  const location = start.headers.get('location')
  if (!location) throw new Error('YouTube no devolvió URL de subida')

  const upload = await fetch(location, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4', 'content-length': String(size) },
    body: Readable.toWeb(createReadStream(videoFile)) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  const result = (await upload.json()) as { id?: string; error?: { message?: string } }
  if (!upload.ok || !result.id) throw new Error(result.error?.message ?? 'Error subiendo el vídeo')

  if (thumbFile) {
    await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${result.id}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'image/jpeg' },
      body: await readFile(thumbFile),
    }).catch(() => undefined)
  }
  return result.id
}
