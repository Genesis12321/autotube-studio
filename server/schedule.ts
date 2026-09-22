import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR, bus, createJob, setUploadError, setYoutubeId } from './pipeline'
import { ensureDir } from './render'
import { suggestTopic } from './script'
import { isUsedTopic, markTopicUsed, usedTopics } from './topics'
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

const formatter = (): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

/** Hora local (`HH:MM`) y día (`AAAA-MM-DD`) en la zona configurada, sin dependencias externas. */
const localNow = (): { day: string; time: string } => {
  const [day, time] = formatter().format(new Date()).split(' ')
  return { day, time: time.slice(0, 5) }
}

/** Instante UTC que corresponde a `AAAA-MM-DD HH:MM` en la zona configurada. */
const zonedTime = (day: string, time: string): Date => {
  const target = Date.parse(`${day}T${time}:00Z`)
  let guess = new Date(target)
  for (let i = 0; i < 2; i++) {
    const [seenDay, seenTime] = formatter().format(guess).split(' ')
    const offset = Date.parse(`${seenDay}T${seenTime}Z`) - guess.getTime()
    guess = new Date(target - offset)
  }
  return guess
}

/** Horas de renderizado que se reservan antes de la publicación: el plan gratis es lento. */
const leadMs = (slot: ScheduleSlot): number => (slot.targetDuration > 120 ? 10 : 3) * 3_600_000

/** Próxima publicación del slot: hoy si aún no ha pasado, si no mañana. */
const nextPublish = (slot: ScheduleSlot, now: Date): Date => {
  const { day } = localNow()
  const today = zonedTime(day, slot.time)
  if (today.getTime() > now.getTime()) return today
  const tomorrow = new Date(`${day}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return zonedTime(tomorrow.toISOString().slice(0, 10), slot.time)
}

const launch = async (slot: ScheduleSlot, publishAt: Date): Promise<void> => {
  const topic = await suggestTopic(usedTopics(), isUsedTopic)
  await markTopicUsed(topic)
  createJob(
    {
      topic,
      format: slot.format,
      voice: 'slt',
      tone: 'misterioso',
      targetDuration: slot.targetDuration,
    },
    {
      auto: true,
      publish: schedule.autoPublish ? schedule.privacy : undefined,
      publishAt: schedule.autoPublish ? publishAt.toISOString() : undefined,
    },
  )
  console.log(`[schedule] "${topic}" → publicación ${publishAt.toISOString()}`)
}

const tick = (): void => {
  if (!schedule.enabled) return
  const now = new Date()
  for (const slot of schedule.slots) {
    if (!slot.enabled) continue
    const publishAt = nextPublish(slot, now)
    if (publishAt.getTime() - now.getTime() > leadMs(slot)) continue
    const key = `${slot.id}@${publishAt.toISOString().slice(0, 13)}`
    if (fired.has(key)) continue
    fired.add(key)
    void save()
    void launch(slot, publishAt).catch((err) => console.warn('[schedule]', (err as Error).message))
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
      publishAt:
        job.publish === 'public' && job.publishAt && new Date(job.publishAt).getTime() > Date.now() + 120_000
          ? job.publishAt
          : undefined,
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
