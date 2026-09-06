import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { generateScript } from './script'
import {
  buildVoiceTrack,
  concatScenes,
  encodeMp3,
  ensureDir,
  muxVoice,
  probeDuration,
  renderScene,
  run,
  makeThumbnails,
  synthVoice,
} from './render'
import { fetchStockClip } from './clips'
import { fetchMusicTrack } from './music'
import { fetchStockImage } from './stock'
import type { Credit, Job, JobInput, StepId } from './types'

/** Un mismo autor puede aparecer en varias escenas: la descripción solo lo cita una vez. */
const dedupeCredits = (credits: Credit[]): Credit[] => {
  const seen = new Map<string, Credit>()
  for (const credit of credits) {
    seen.set(`${credit.kind}|${credit.author}|${credit.source}`, credit)
  }
  return [...seen.values()]
}

const CREDIT_LABEL: Record<Credit['kind'], string> = {
  video: 'Vídeo',
  image: 'Imágenes',
  music: 'Música',
}

/** Añade a la descripción las atribuciones que exigen las licencias CC-BY. */
const withCredits = (description: string | undefined, credits: Credit[]): string | undefined => {
  if (credits.length === 0) return description
  const lines = (['video', 'image', 'music'] as const).flatMap((kind) => {
    const group = credits.filter((c) => c.kind === kind)
    return group.length === 0
      ? []
      : [
          `${CREDIT_LABEL[kind]}:`,
          ...group.map(
            (c) =>
              `• ${c.author} (${c.source}${c.license ? `, ${c.license}` : ''})${c.url ? ` — ${c.url}` : ''}`,
          ),
        ]
  })
  return [description ?? '', '', 'Créditos:', ...lines].join('\n').trim()
}

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'))
export const MEDIA_DIR = path.join(DATA_DIR, 'media')
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json')

export const bus = new EventEmitter()
bus.setMaxListeners(0)

const jobs = new Map<string, Job>()

const STEP_LABELS: Record<StepId, string> = {
  script: 'Generando guión',
  voice: 'Creando locución (TTS)',
  visuals: 'Buscando clips/imágenes de stock',
  render: 'Renderizando vídeo final',
}

const emptySteps = () =>
  (Object.keys(STEP_LABELS) as StepId[]).map((id) => ({
    id,
    label: STEP_LABELS[id],
    status: 'pending' as const,
    progress: 0,
  }))

const persist = async () => {
  await ensureDir(DATA_DIR)
  const list = [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  await writeFile(JOBS_FILE, JSON.stringify(list, null, 2), 'utf8')
}

export const loadJobs = async (): Promise<void> => {
  try {
    const raw = await readFile(JOBS_FILE, 'utf8')
    for (const job of JSON.parse(raw) as Job[]) {
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'error'
        job.error = 'Interrumpido al reiniciar el servidor'
      }
      jobs.set(job.id, job)
    }
  } catch {
    /* primera ejecución */
  }
}

export const listJobs = (): Job[] => [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
export const getJob = (id: string): Job | undefined => jobs.get(id)

/** Deja fija la portada elegida por el usuario entre las candidatas generadas. */
export const selectThumb = (id: string, index: number): Job | undefined => {
  const job = jobs.get(id)
  const url = job?.thumbUrls?.[index]
  if (!job || !url) return undefined
  job.thumbUrl = url
  void persist()
  bus.emit('job', job)
  return job
}

/** Guarda el id del vídeo ya publicado en YouTube para no volver a subirlo. */
export const setYoutubeId = (id: string, youtubeId: string): void => {
  const job = jobs.get(id)
  if (!job) return
  job.youtubeId = youtubeId
  void persist()
  bus.emit('job', job)
}

const update = (job: Job, stepId: StepId, patch: Partial<Job['steps'][number]>) => {
  const step = job.steps.find((s) => s.id === stepId)
  if (step) Object.assign(step, patch)
  bus.emit('job', job)
}

const finishStep = (job: Job, stepId: StepId, detail?: string) =>
  update(job, stepId, { status: 'done', progress: 100, detail })

export const createJob = (input: JobInput): Job => {
  const job: Job = {
    id: randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
    input,
    status: 'queued',
    steps: emptySteps(),
    scenes: [],
  }
  jobs.set(job.id, job)
  void persist()
  void enqueue(job)
  return job
}

/**
 * Un render a la vez: dos ffmpeg simultáneos no caben en los 512 MB de los planes gratuitos
 * y el kernel mata uno a mitad del montaje.
 */
let queue: Promise<void> = Promise.resolve()

const enqueue = (job: Job): Promise<void> => {
  queue = queue.then(() => runJob(job))
  return queue
}

const runJob = async (job: Job): Promise<void> => {
  const workDir = path.join(MEDIA_DIR, job.id)
  await ensureDir(workDir)
  job.status = 'running'
  bus.emit('job', job)

  try {
    update(job, 'script', { status: 'running', progress: 25, detail: 'Estructurando escenas...' })
    const { title, scenes, source, description, hashtags } = await generateScript(job.input)
    job.title = title
    job.scenes = scenes
    job.scriptSource = source
    job.description = description
    job.hashtags = hashtags
    const sourceLabel = source === 'local' ? 'generador local' : source === 'gemini' ? 'Gemini' : 'OpenAI'
    finishStep(job, 'script', `${scenes.length} escenas · ${sourceLabel}`)

    update(job, 'voice', { status: 'running', progress: 5, detail: 'Sintetizando voz...' })
    const audioFiles: string[] = []
    for (const scene of scenes) {
      const wav = path.join(workDir, `scene-${scene.index}.wav`)
      // La escena dura exactamente lo que su locución para que la pista continua quede sincronizada.
      scene.durationSec = await synthVoice(scene.narration, job.input.voice, wav)
      audioFiles.push(wav)
      update(job, 'voice', {
        status: 'running',
        progress: Math.round(((scene.index + 1) / scenes.length) * 100),
        detail: `Escena ${scene.index + 1}/${scenes.length}`,
      })
    }
    // Una sola pista continua evita los cortes y los saltos de volumen entre escenas.
    const voiceTrack = path.join(workDir, 'voiceover.wav')
    await buildVoiceTrack(audioFiles, workDir, voiceTrack)
    await encodeMp3(voiceTrack, path.join(workDir, 'voiceover.mp3'))
    job.audioUrl = `/media/${job.id}/voiceover.mp3`
    finishStep(job, 'voice', `Locución lista (${job.input.voice})`)

    update(job, 'visuals', { status: 'running', progress: 5, detail: 'Buscando imágenes...' })
    // En vídeos largos hay decenas de escenas: se busca por lotes para no saturar las APIs.
    const orientation = job.input.format === 'vertical' ? 'portrait' : 'landscape'
    const credits: Credit[] = []
    const take = (asset: { file: string; credit: Credit } | null): string | null => {
      if (!asset) return null
      credits.push(asset.credit)
      return asset.file
    }

    // Con clave de Pexels el fondo es vídeo real en movimiento; la foto queda como respaldo.
    // Las escenas largas usan dos clips para que el plano cambie por la mitad.
    const clips: (string | null)[] = []
    const clipsB: (string | null)[] = []
    for (const scene of scenes) {
      const long = (scene.durationSec ?? 0) >= 7
      const clip = take(
        await fetchStockClip(
          scene.keywords,
          job.input.topic,
          scene.index,
          workDir,
          orientation,
          long ? (scene.durationSec ?? 5) / 2 : (scene.durationSec ?? 5),
        ).catch(() => null),
      )
      clips.push(clip)
      clipsB.push(
        clip && long
          ? take(
              await fetchStockClip(
                scene.keywords,
                job.input.topic,
                scene.index,
                workDir,
                orientation,
                (scene.durationSec ?? 5) / 2,
                1,
              ).catch(() => null),
            )
          : null,
      )
      update(job, 'visuals', {
        status: 'running',
        progress: Math.round(((scene.index + 1) / scenes.length) * 60),
        detail: `Clip ${scene.index + 1}/${scenes.length}`,
      })
    }

    // Solo se buscan fotos para las escenas que se han quedado sin clip.
    const images: (string | null)[] = []
    const batchSize = process.env.LOW_MEMORY === '1' ? 3 : 6
    for (let i = 0; i < scenes.length; i += batchSize) {
      const batch = scenes.slice(i, i + batchSize)
      const found = await Promise.all(
        batch.map((scene) =>
          clips[scene.index]
            ? null
            : fetchStockImage(scene.keywords, job.input.topic, scene.index, workDir, orientation),
        ),
      )
      images.push(...found.map(take))
      update(job, 'visuals', {
        status: 'running',
        progress: 60 + Math.round((images.length / scenes.length) * 40),
        detail: `Imagen ${images.length}/${scenes.length}`,
      })
    }

    // Segunda imagen solo en las escenas largas sin clip: la escena cambia de plano por la mitad.
    const imagesB: (string | null)[] = []
    for (const scene of scenes) {
      imagesB.push(
        images[scene.index] && (scene.durationSec ?? 0) >= 7
          ? take(await fetchStockImage(scene.keywords, job.input.topic, scene.index, workDir, orientation, 1))
          : null,
      )
    }
    const foundClips = clips.filter(Boolean).length
    const found = images.filter(Boolean).length
    finishStep(
      job,
      'visuals',
      foundClips ? `${foundClips} clips + ${found} imágenes` : `${found}/${scenes.length} imágenes de stock`,
    )

    // Música libre acorde al tono (cacheada entre jobs); si no hay, el vídeo va solo con voz.
    const music = await fetchMusicTrack(job.input.tone, path.join(DATA_DIR, 'music')).catch(() => null)
    const musicFile = take(music)
    job.music = music?.credit.author

    update(job, 'render', { status: 'running', progress: 5, detail: 'Componiendo escenas...' })
    const sceneFiles: string[] = []
    for (const scene of scenes) {
      const file = await renderScene(scene, {
        format: job.input.format,
        duration: scene.durationSec ?? 3,
        workDir,
        title: job.title ?? job.input.topic,
        imageFile: images[scene.index],
        imageFileB: imagesB[scene.index],
        clipFile: clips[scene.index],
        clipFileB: clipsB[scene.index],
        fadeIn: scene.index === 0,
        fadeOut: scene.index === scenes.length - 1,
      })
      sceneFiles.push(file)
      update(job, 'render', {
        status: 'running',
        progress: Math.round(((scene.index + 1) / scenes.length) * 80),
        detail: `Escena ${scene.index + 1}/${scenes.length}`,
      })
    }

    update(job, 'render', { status: 'running', progress: 90, detail: 'Uniendo escenas...' })
    const finalFile = path.join(workDir, 'final.mp4')
    const silentFile = path.join(workDir, 'silent.mp4')
    await concatScenes(sceneFiles, workDir, silentFile)
    await muxVoice(silentFile, voiceTrack, finalFile, musicFile)
    const thumbs = await makeThumbnails(
      finalFile,
      job.title ?? job.input.topic,
      job.input.format,
      workDir,
    ).catch(async () => {
      await run('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', '0.8', '-i', finalFile, '-frames:v', '1',
        path.join(workDir, 'thumb-0.jpg'),
      ])
      return [path.join(workDir, 'thumb-0.jpg')]
    })

    job.credits = dedupeCredits(credits)
    job.description = withCredits(job.description, job.credits)
    job.thumbUrls = thumbs.map((file) => `/media/${job.id}/${path.basename(file)}`)
    job.thumbUrl = job.thumbUrls[0]
    job.videoUrl = `/media/${job.id}/final.mp4`
    job.durationSec = await probeDuration(finalFile)
    job.sizeBytes = (await stat(finalFile)).size
    finishStep(job, 'render', `${job.durationSec.toFixed(1)}s · ${(job.sizeBytes / 1024 / 1024).toFixed(1)} MB`)

    job.status = 'done'
    bus.emit('job', job)
  } catch (err) {
    job.status = 'error'
    job.error = (err as Error).message
    const running = job.steps.find((s) => s.status === 'running')
    if (running) Object.assign(running, { status: 'error', detail: job.error })
    bus.emit('job', job)
  } finally {
    await persist()
  }
}
