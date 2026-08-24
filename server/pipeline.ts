import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { generateScript } from './script'
import { concatAudio, concatScenes, ensureDir, probeDuration, renderScene, run, synthVoice } from './render'
import { fetchStockImage } from './stock'
import type { Job, JobInput, StepId } from './types'

export const DATA_DIR = path.resolve(process.cwd(), 'data')
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
  void runJob(job)
  return job
}

const runJob = async (job: Job): Promise<void> => {
  const workDir = path.join(MEDIA_DIR, job.id)
  await ensureDir(workDir)
  job.status = 'running'
  bus.emit('job', job)

  try {
    update(job, 'script', { status: 'running', progress: 25, detail: 'Estructurando escenas...' })
    const { title, scenes, source } = await generateScript(job.input)
    job.title = title
    job.scenes = scenes
    job.scriptSource = source
    finishStep(job, 'script', `${scenes.length} escenas · ${source === 'openai' ? 'OpenAI' : 'generador local'}`)

    update(job, 'voice', { status: 'running', progress: 5, detail: 'Sintetizando voz...' })
    const audioFiles: string[] = []
    for (const scene of scenes) {
      const wav = path.join(workDir, `scene-${scene.index}.wav`)
      scene.durationSec = Math.max(1.6, (await synthVoice(scene.narration, job.input.voice, wav)) + 0.1)
      audioFiles.push(wav)
      update(job, 'voice', {
        status: 'running',
        progress: Math.round(((scene.index + 1) / scenes.length) * 100),
        detail: `Escena ${scene.index + 1}/${scenes.length}`,
      })
    }
    const previewAudio = path.join(workDir, 'voiceover.mp3')
    await concatAudio(audioFiles, workDir, previewAudio)
    job.audioUrl = `/media/${job.id}/voiceover.mp3`
    finishStep(job, 'voice', `Locución lista (${job.input.voice})`)

    update(job, 'visuals', { status: 'running', progress: 5, detail: 'Buscando imágenes...' })
    const images = await Promise.all(
      scenes.map((scene) =>
        fetchStockImage(
          scene.keywords,
          job.input.topic,
          scene.index,
          workDir,
          job.input.format === 'vertical' ? 'portrait' : 'landscape',
        ),
      ),
    )
    const found = images.filter(Boolean).length
    finishStep(job, 'visuals', `${found}/${scenes.length} imágenes de stock encontradas`)

    update(job, 'render', { status: 'running', progress: 5, detail: 'Componiendo escenas...' })
    const sceneFiles: string[] = []
    for (const scene of scenes) {
      const file = await renderScene(scene, {
        format: job.input.format,
        audioFile: audioFiles[scene.index],
        duration: scene.durationSec ?? 3,
        workDir,
        title: job.title ?? job.input.topic,
        imageFile: images[scene.index],
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
    await concatScenes(sceneFiles, workDir, finalFile)
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', '0.8', '-i', finalFile, '-frames:v', '1',
      path.join(workDir, 'thumb.jpg'),
    ])

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
