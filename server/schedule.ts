import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, bus, createJob, listJobs, setUploadError, setYoutubeId } from './pipeline'
import { ensureDir } from './render'
import { suggestTopic } from './script'
import type { Job, Schedule, ScheduleSlot } from './types'
import { status as youtubeStatus, uploadVideo } from './youtube'

const FILE = path.join(DATA_DIR, 'schedule.json')

const DEFAULT: Schedule = {
  enabled: false,
  timezone: 'Europe/Madrid',
  autoPublish: false,
  privacy: 'private',
  slots: [
    { id: 'short-tarde', time: '14:30', format: 'vertical', targetDuration: 45, enabled: true },
    { id: 'largo-noche', time: '20:00', format: 'horizontal', targetDuration: 480, enabled: true },
    { id: 'short-noche', time: '21:30', format: 'vertical', targetDuration: 45, enabled: true },
  ],
}

let schedule: Schedule = DEFAULT
/** Marcas `slotId@AAAA-MM-DD` ya lanzadas, para no repetir si el minuto se comprueba dos veces. */
const fired = new Set<string>()

const save = async (): Promise<void> => {
  await ensureDir(DATA_DIR)
  await writeFile(FILE, JSON.stringify({ schedule, fired: [...fired] }, null, 2), 'utf8')
}

export const loadSchedule = async (): Promise<void> => {
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8')) as { schedule: Schedule; fired?: string[] }
    schedule = { ...DEFAULT, ...raw.schedule }
    for (const key of raw.fired ?? []) fired.add(key)
  } catch {
    schedule = DEFAULT
  }
}

export const getSchedule = (): Schedule => schedule

const sanitizeSlot = (slot: Partial<ScheduleSlot>, index: number): ScheduleSlot => ({
  id: slot.id ?? `slot-${index}-${randomUUID().slice(0, 4)}`,
  time: /^\d{2}:\d{2}$/.test(slot.time ?? '') ? (slot.time as string) : '12:00',
  format: slot.format === 'horizontal' ? 'horizontal' : 'vertical',
  targetDuration: Math.min(600, Math.max(20, Number(slot.targetDuration) || 45)),
  enabled: slot.enabled !== false,
})

export const setSchedule = async (patch: Partial<Schedule>): Promise<Schedule> => {
  schedule = {
    ...schedule,
    ...patch,
    timezone: patch.timezone?.trim() || schedule.timezone,
    privacy: patch.privacy ?? schedule.privacy,
    slots: patch.slots ? patch.slots.map(sanitizeSlot) : schedule.slots,
  }
  await save()
  return schedule
}

/** Hora local (`HH:MM`) y día (`AAAA-MM-DD`) en la zona configurada, sin dependencias externas. */
const localNow = (): { day: string; time: string } => {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
  const [day, time] = parts.split(' ')
  return { day, time: time.slice(0, 5) }
}

const launch = async (slot: ScheduleSlot): Promise<void> => {
  const recent = listJobs()
    .slice(0, 20)
    .map((j) => j.input.topic)
  const topic = await suggestTopic(recent)
  createJob(
    {
      topic,
      format: slot.format,
      voice: 'slt',
      tone: 'divulgativo',
      targetDuration: slot.targetDuration,
    },
    { auto: true, publish: schedule.autoPublish ? schedule.privacy : undefined },
  )
  console.log(`[schedule] ${slot.time} → "${topic}"`)
}

const tick = (): void => {
  if (!schedule.enabled) return
  const { day, time } = localNow()
  for (const slot of schedule.slots) {
    if (!slot.enabled || slot.time !== time) continue
    const key = `${slot.id}@${day}`
    if (fired.has(key)) continue
    fired.add(key)
    void save()
    void launch(slot).catch((err) => console.warn('[schedule]', (err as Error).message))
  }
}

/** Sube a YouTube los vídeos automáticos en cuanto terminan de renderizarse. */
const autoUpload = async (job: Job): Promise<void> => {
  if (!job.publish || job.status !== 'done' || job.youtubeId || !job.videoUrl) return
  if (!youtubeStatus().connected) {
    setUploadError(job.id, 'Conecta tu cuenta de YouTube para publicar automáticamente')
    return
  }
  try {
    const dir = path.join(DATA_DIR, 'media', job.id)
    const id = await uploadVideo({
      videoFile: path.join(dir, 'final.mp4'),
      thumbFile: job.thumbUrl ? path.join(DATA_DIR, job.thumbUrl.replace(/^\/media\//, 'media/')) : undefined,
      title: job.title ?? job.input.topic,
      description: job.description ?? '',
      tags: job.hashtags?.map((h) => h.replace(/^#/, '')) ?? [],
      privacy: job.publish,
    })
    setYoutubeId(job.id, id)
  } catch (err) {
    setUploadError(job.id, (err as Error).message)
  }
}

export const startScheduler = (): void => {
  const uploading = new Set<string>()
  bus.on('job', (job: Job) => {
    if (!job.publish || job.status !== 'done' || job.youtubeId || uploading.has(job.id)) return
    uploading.add(job.id)
    void autoUpload(job).finally(() => uploading.delete(job.id))
  })
  setInterval(tick, 30_000).unref()
  tick()
}
