export type VideoFormat = 'vertical' | 'horizontal'

export type VoiceId = 'slt' | 'kal16' | 'awb' | 'rms'

export type StepId = 'script' | 'voice' | 'visuals' | 'render'

export type StepStatus = 'pending' | 'running' | 'done' | 'error'

export type Step = {
  id: StepId
  label: string
  status: StepStatus
  progress: number
  detail?: string
}

export type Scene = {
  index: number
  heading: string
  narration: string
  keywords: string[]
  durationSec?: number
}

/** Atribución de un recurso externo (clip, foto o música) para la descripción del vídeo. */
export type Credit = {
  kind: 'video' | 'image' | 'music'
  author: string
  source: string
  license?: string
  url?: string
}

export type JobInput = {
  topic: string
  script?: string
  format: VideoFormat
  voice: VoiceId
  tone: string
  targetDuration: number
}

export type Privacy = 'private' | 'unlisted' | 'public'

/** Franja del programador: a esa hora local se crea un vídeo con tema generado por la IA. */
export type ScheduleSlot = {
  id: string
  time: string
  format: VideoFormat
  targetDuration: number
  enabled: boolean
}

export type Schedule = {
  enabled: boolean
  timezone: string
  autoPublish: boolean
  privacy: Privacy
  slots: ScheduleSlot[]
}

export type Job = {
  id: string
  createdAt: string
  input: JobInput
  status: 'queued' | 'running' | 'done' | 'error' | 'canceled'
  /** Posición en la cola de espera (0 = siguiente); solo en los trabajos en cola. */
  queueIndex?: number
  steps: Step[]
  scenes: Scene[]
  title?: string
  error?: string
  videoUrl?: string
  audioUrl?: string
  durationSec?: number
  sizeBytes?: number
  scriptSource?: 'openai' | 'gemini' | 'local'
  description?: string
  hashtags?: string[]
  music?: string
  thumbUrl?: string
  thumbUrls?: string[]
  credits?: Credit[]
  youtubeId?: string
  /** Creado por el programador; al terminar puede subirse solo a YouTube. */
  auto?: boolean
  publish?: Privacy
  /** Momento ISO en que YouTube debe hacerlo público (publicación programada). */
  publishAt?: string
  uploadError?: string
}
