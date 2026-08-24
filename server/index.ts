import cors from 'cors'
import express from 'express'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_DIR, bus, createJob, getJob, listJobs, loadJobs } from './pipeline'
import type { JobInput, VideoFormat, VoiceId } from './types'

const PORT = Number(process.env.PORT ?? 8787)
const VOICES: VoiceId[] = ['slt', 'kal16', 'awb', 'rms']
const FORMATS: VideoFormat[] = ['vertical', 'horizontal']

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiScript: Boolean(process.env.OPENAI_API_KEY), voices: VOICES })
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
    targetDuration: Math.min(180, Math.max(20, Number(body.targetDuration) || 45)),
  }
  res.status(201).json(createJob(input))
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

await loadJobs()
app.listen(PORT, () => console.log(`[autotube] API escuchando en http://localhost:${PORT}`))
