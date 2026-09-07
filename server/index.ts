import cors from 'cors'
import express from 'express'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { authEnabled, authorized, guard, login } from './auth'
import { loadEnv } from './env'
import { DATA_DIR, MEDIA_DIR, bus, createJob, getJob, listJobs, loadJobs, selectThumb, setYoutubeId } from './pipeline'
import { piperModelFor } from './render'
import type { JobInput, VideoFormat, VoiceId } from './types'
import {
  authUrl,
  disconnect,
  exchangeCode,
  loadTokens,
  status as youtubeStatus,
  uploadVideo,
  type Privacy,
} from './youtube'

loadEnv()

const PORT = Number(process.env.PORT ?? 8787)
const VOICES: VoiceId[] = ['slt', 'kal16', 'awb', 'rms']
const FORMATS: VideoFormat[] = ['vertical', 'horizontal']
const PRIVACIES: Privacy[] = ['private', 'unlisted', 'public']
const APP_URL = (process.env.PUBLIC_URL ?? 'http://localhost:5174').replace(/\/$/, '')

const app = express()
app.use(cors({ credentials: true }))
app.use(express.json({ limit: '1mb' }))

app.get('/api/session', (req, res) => {
  res.json({ required: authEnabled(), authorized: authorized(req) })
})

app.post('/api/login', (req, res) => {
  if (!login(req, res)) return res.status(401).json({ error: 'Contraseña incorrecta' })
  res.json({ ok: true })
})

app.use('/api', guard)
app.use('/media', guard, express.static(MEDIA_DIR, { maxAge: '1h' }))

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    aiScript: Boolean(process.env.OPENAI_API_KEY ?? process.env.GEMINI_API_KEY),
    tts: (await piperModelFor('slt')) ? 'piper' : 'espeak-ng',
    stock: process.env.PEXELS_API_KEY ? 'pexels' : process.env.OPENVERSE_CLIENT_ID ? 'openverse' : 'commons',
    voices: VOICES,
  })
})

app.get('/api/jobs', (_req, res) => {
  res.json(listJobs())
})

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'not found' })
  res.json(job)
})

app.post('/api/jobs', (req, res) => {
  const body = req.body as Partial<JobInput>
  const topic = (body.topic ?? '').trim()
  if (!topic && !body.script?.trim()) {
    return res.status(400).json({ error: 'Indica una temática o pega un guión' })
  }
  const input: JobInput = {
    topic: topic || 'Vídeo sin título',
    script: body.script?.trim() || undefined,
    format: FORMATS.includes(body.format as VideoFormat) ? (body.format as VideoFormat) : 'vertical',
    voice: VOICES.includes(body.voice as VoiceId) ? (body.voice as VoiceId) : 'slt',
    tone: body.tone?.trim() || 'divulgativo',
    targetDuration: Math.min(600, Math.max(20, Number(body.targetDuration) || 45)),
  }
  res.status(201).json(createJob(input))
})

/** Descarga con nombre y `attachment`: el atributo `download` del navegador móvil no basta. */
app.get('/api/jobs/:id/download', (req, res) => {
  const job = getJob(req.params.id)
  if (!job?.videoUrl) return res.status(404).json({ error: 'not found' })
  const slug = (job.title ?? job.input.topic)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  res.download(path.join(MEDIA_DIR, job.id, 'final.mp4'), `${slug || job.id}.mp4`)
})

app.post('/api/jobs/:id/thumb', (req, res) => {
  const body = req.body as { index?: number }
  const job = selectThumb(req.params.id, Number(body.index))
  if (!job) return res.status(404).json({ error: 'not found' })
  res.json(job)
})

app.get('/api/youtube/status', (_req, res) => {
  res.json(youtubeStatus())
})

app.get('/api/youtube/auth', (_req, res) => {
  if (!youtubeStatus().configured) return res.status(400).json({ error: 'Faltan las credenciales de Google' })
  res.redirect(authUrl())
})

app.get('/api/youtube/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) return res.redirect(`${APP_URL}/?youtube=error`)
  try {
    await exchangeCode(code)
    res.redirect(`${APP_URL}/?youtube=ok`)
  } catch {
    res.redirect(`${APP_URL}/?youtube=error`)
  }
})

app.post('/api/youtube/disconnect', async (_req, res) => {
  await disconnect()
  res.json(youtubeStatus())
})

app.post('/api/jobs/:id/publish', async (req, res) => {
  const job = getJob(req.params.id)
  if (!job?.videoUrl) return res.status(404).json({ error: 'Vídeo no disponible' })
  const body = req.body as { privacy?: Privacy }
  const privacy = PRIVACIES.includes(body.privacy as Privacy) ? (body.privacy as Privacy) : 'private'
  try {
    const youtubeId = await uploadVideo({
      videoFile: path.join(MEDIA_DIR, job.id, 'final.mp4'),
      thumbFile: job.thumbUrl ? path.join(MEDIA_DIR, job.id, path.basename(job.thumbUrl)) : undefined,
      title: job.title ?? job.input.topic,
      description: job.description ?? '',
      tags: (job.hashtags ?? []).map((tag) => tag.replace(/^#/, '')),
      privacy,
    })
    setYoutubeId(job.id, youtubeId)
    res.json({ youtubeId, url: `https://youtu.be/${youtubeId}` })
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
})

app.delete('/api/jobs/:id', async (req, res) => {
  const job = getJob(req.params.id)
  if (!job) return res.status(404).json({ error: 'not found' })
  await rm(path.join(MEDIA_DIR, job.id), { recursive: true, force: true })
  res.json({ ok: true })
})

app.get('/api/stream', (_req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write(`event: snapshot\ndata: ${JSON.stringify(listJobs())}\n\n`)

  const onJob = (job: unknown) => res.write(`event: job\ndata: ${JSON.stringify(job)}\n\n`)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000)
  bus.on('job', onJob)

  res.on('close', () => {
    clearInterval(keepAlive)
    bus.off('job', onJob)
    res.end()
  })
})

const DIST_DIR = path.resolve(process.cwd(), 'dist')
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }))
  app.get(/.*/, (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
}

await loadJobs()
await loadTokens(DATA_DIR)
app.listen(PORT, '0.0.0.0', () => console.log(`[autotube] API escuchando en el puerto ${PORT}`))
