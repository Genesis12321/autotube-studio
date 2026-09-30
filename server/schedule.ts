import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { notify } from './notify'
import {
  DATA_DIR,
  bus,
  createJob,
  listJobs,
  purgeOldJobs,
  setTiktokError,
  setTiktokId,
  setUploadError,
  slotTaken,
  setYoutubeId,
} from './pipeline'
import { status as tiktokStatus, uploadVideo as uploadTiktok } from './tiktok'
import { ensureDir } from './render'
import { suggestTopic } from './script'
import { isUsedTopic, markTopicUsed, usedTopics } from './topics'
import type { Job, Schedule, ScheduleSlot } from './types'
import { checkConnection, status as youtubeStatus, uploadVideo } from './youtube'

const FILE = path.join(DATA_DIR, 'schedule.json')

/** El disco del hosting es temporal: tras un reinicio se vuelve a estos valores, los de uso diario. */
const DEFAULT: Schedule = {
  enabled: true,
  timezone: 'Europe/Madrid',
  autoPublish: true,
  privacy: 'public',
  tiktok: false,
  slots: [
    { id: 'short-tarde', time: '14:30', format: 'vertical', targetDuration: 60, enabled: true },
    { id: 'largo-noche', time: '20:00', format: 'horizontal', targetDuration: 480, enabled: true },
    { id: 'short-noche', time: '21:30', format: 'vertical', targetDuration: 60, enabled: true },
    /** Shorts propios de TikTok: se suben a las 17:55 solo para no perderlos; se borran a mano. */
    { id: 'tiktok-1', time: '17:55', format: 'vertical', targetDuration: 60, enabled: true },
    { id: 'tiktok-2', time: '17:55', format: 'vertical', targetDuration: 60, enabled: true },
  ],
}

let schedule: Schedule = DEFAULT
/** Marcas `slotId@AAAA-MM-DD` ya lanzadas, para no repetir si el minuto se comprueba dos veces. */
const fired = new Set<string>()
/** Un despliegue estrena disco: se pierde el rastro de la tanda del día. */
let freshDisk = false

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
    freshDisk = true
  }
}

export const getSchedule = (): Schedule => schedule

const sanitizeSlot = (slot: Partial<ScheduleSlot>, index: number): ScheduleSlot => ({
  id: slot.id ?? `slot-${index}-${randomUUID().slice(0, 4)}`,
  time: /^\d{2}:\d{2}$/.test(slot.time ?? '') ? (slot.time as string) : '12:00',
  format: slot.format === 'horizontal' ? 'horizontal' : 'vertical',
  targetDuration: Math.min(600, Math.max(20, Number(slot.targetDuration) || 45)),
  enabled: slot.enabled !== false,
  youtube: slot.youtube !== false,
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

/** Día local (`AAAA-MM-DD`) al que pertenece un instante. */
const localDay = (date: Date): string => formatter().format(date).slice(0, 10)

/** Próxima publicación del slot: hoy si aún no ha pasado, si no mañana. */
const nextPublish = (slot: ScheduleSlot, now: Date): Date => {
  const { day } = localNow()
  const today = zonedTime(day, slot.time)
  if (today.getTime() > now.getTime()) return today
  const tomorrow = new Date(`${day}T12:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return zonedTime(tomorrow.toISOString().slice(0, 10), slot.time)
}

const slotKeyFor = (slot: ScheduleSlot, publishAt: Date): string =>
  `${slot.id}@${localDay(publishAt)}`

const launch = async (slot: ScheduleSlot, publishAt: Date): Promise<void> => {
  const slotKey = slotKeyFor(slot, publishAt)
  if (slotTaken(slotKey)) return
  const toYoutube = schedule.autoPublish && slot.youtube !== false
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
      publish: toYoutube ? schedule.privacy : undefined,
      publishAt: publishAt.toISOString(),
      slotKey,
    },
  )
  console.log(`[schedule] "${topic}" → ${toYoutube ? 'publicación' : 'solo biblioteca'} ${publishAt.toISOString()}`)
}

/** Los vídeos del día se encolan de uno en uno y en orden de publicación. */
let chain: Promise<void> = Promise.resolve()

const slotsOfDay = (now: Date): { slot: ScheduleSlot; publishAt: Date }[] => {
  const today = localDay(now)
  return schedule.slots
    .filter((slot) => slot.enabled)
    .map((slot) => ({ slot, publishAt: nextPublish(slot, now) }))
    /** Desde las 00:00 se preparan todos los vídeos del día, así hay margen si alguno falla. */
    .filter(({ publishAt }) => localDay(publishAt) === today)
    .sort((a, b) => a.publishAt.getTime() - b.publishAt.getTime())
}

/**
 * Franjas ya subidas a YouTube (`slotId@AAAA-MM-DD`). Se guardan en una variable de entorno
 * del propio servicio de Render porque el disco se borra en cada reinicio.
 */
const UPLOADED_VAR = 'AUTOTUBE_UPLOADED_SLOTS'

const uploadedSlots = (): string[] =>
  (process.env[UPLOADED_VAR] ?? '').split(',').filter(Boolean)

const rememberUploaded = async (slotKey: string): Promise<void> => {
  const yesterday = localDay(new Date(Date.now() - 86_400_000))
  const keys = [...new Set([...uploadedSlots(), slotKey])].filter((key) => key.split('@')[1] >= yesterday)
  process.env[UPLOADED_VAR] = keys.join(',')
  const apiKey = process.env.RENDER_API_KEY
  const service = process.env.RENDER_SERVICE_ID
  if (!apiKey || !service) return
  const res = await fetch(`https://api.render.com/v1/services/${service}/env-vars/${UPLOADED_VAR}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ value: process.env[UPLOADED_VAR] }),
  })
  if (!res.ok) console.warn('[schedule] no se pudo guardar la franja subida', res.status)
}

/**
 * Tras un reinicio la biblioteca aparece vacía: solo se da por hecha la franja que ya está
 * subida a YouTube; las demás del día se vuelven a crear si aún llegan a su hora.
 */
const restoreTodayAfterRestart = (): void => {
  if (!freshDisk) return
  const uploaded = new Set(uploadedSlots())
  const missing: string[] = []
  for (const { slot, publishAt } of slotsOfDay(new Date())) {
    const key = slotKeyFor(slot, publishAt)
    if (uploaded.has(key)) fired.add(key)
    else if (localNow().time >= '00:30') missing.push(slot.time)
  }
  void save()
  if (missing.length > 0) {
    void notify(`AutoTube: el servidor se reinició y se vuelven a crear los vídeos de hoy que faltaban (${missing.join(', ')}).`)
  }
}

const tick = (): void => {
  if (!schedule.enabled) return
  const now = new Date()
  const pending = slotsOfDay(now)

  let first = true
  for (const { slot, publishAt } of pending) {
    const key = slotKeyFor(slot, publishAt)
    if (fired.has(key)) continue
    fired.add(key)
    void save()
    if (first) {
      first = false
      /** Al empezar la tanda del día se vacía la biblioteca de la anterior. */
      chain = chain.then(() => purgeOldJobs(0).then(() => undefined).catch(() => undefined))
    }
    chain = chain.then(() =>
      launch(slot, publishAt).catch((err) => console.warn('[schedule]', (err as Error).message)),
    )
  }
  tiktokDue()
}

/** Los shorts (vertical) se publican también en TikTok; el vídeo largo no. */
const autoTiktok = async (job: Job): Promise<void> => {
  if (!tiktokStatus().connected) {
    setTiktokError(job.id, 'Conecta tu cuenta de TikTok para publicar los shorts')
    void notify(
      'AutoTube: tu cuenta de TikTok no está conectada y los shorts no se están publicando allí. Entra en https://autotube-studio.onrender.com → Auto → "Conectar TikTok".',
      'tiktok-disconnected',
    )
    return
  }
  try {
    const id = await uploadTiktok({
      videoFile: path.join(DATA_DIR, 'media', job.id, 'final.mp4'),
      title: [job.title ?? job.input.topic, ...(job.hashtags ?? [])].join(' '),
      privacy: schedule.privacy === 'public' ? 'public' : 'private',
    })
    setTiktokId(job.id, id)
  } catch (err) {
    const message = (err as Error).message
    setTiktokError(job.id, message)
    void notify(`AutoTube: falló la subida de "${job.title ?? job.input.topic}" a TikTok.\n${message}`)
  }
}

/** TikTok no admite publicación programada: el short se sube a su hora, ya renderizado. */
const postingToTiktok = new Set<string>()

const tiktokDue = (): void => {
  if (!schedule.tiktok) return
  for (const job of listJobs()) {
    if (!job.auto || job.status !== 'done' || job.input.format !== 'vertical') continue
    if (job.tiktokId || postingToTiktok.has(job.id) || !job.videoUrl) continue
    if (job.publishAt && Date.parse(job.publishAt) > Date.now()) continue
    postingToTiktok.add(job.id)
    void autoTiktok(job).finally(() => postingToTiktok.delete(job.id))
  }
}

/** Sube a YouTube los vídeos automáticos en cuanto terminan de renderizarse. */
const autoUpload = async (job: Job): Promise<void> => {
  if (!job.publish || job.status !== 'done' || job.youtubeId || !job.videoUrl) return
  if (!youtubeStatus().connected) {
    setUploadError(job.id, 'Conecta tu cuenta de YouTube para publicar automáticamente')
    void notify(
      'AutoTube: tu canal de YouTube está desconectado y no se pueden publicar los vídeos. Entra en https://autotube-studio.onrender.com → Auto → "Conectar mi canal".',
      'youtube-disconnected',
    )
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
    if (job.slotKey) await rememberUploaded(job.slotKey).catch((err) => console.warn('[schedule]', (err as Error).message))
  } catch (err) {
    const message = (err as Error).message
    setUploadError(job.id, message)
    void notify(`AutoTube: falló la subida de "${job.title ?? job.input.topic}" a YouTube.\n${message}`)
  }
}

/** Google caduca el permiso cuando la app OAuth sigue en pruebas: avisar antes de perder una subida. */
const watchYoutube = async (): Promise<void> => {
  if (await checkConnection()) return
  void notify(
    'AutoTube: el permiso de YouTube ha caducado y los vídeos no se pueden subir. Entra en https://autotube-studio.onrender.com → Auto → "Conectar mi canal".',
    'youtube-disconnected',
  )
}

export const startScheduler = (): void => {
  const uploading = new Set<string>()
  bus.on('job', (job: Job) => {
    if (!job.publish || job.status !== 'done' || job.youtubeId || uploading.has(job.id)) return
    uploading.add(job.id)
    void autoUpload(job).finally(() => uploading.delete(job.id))
  })
  restoreTodayAfterRestart()
  setInterval(tick, 30_000).unref()
  setInterval(() => void watchYoutube(), 3_600_000).unref()
  tick()
  void watchYoutube()
}
