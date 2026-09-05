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

export type Job = {
  id: string
  createdAt: string
  input: JobInput
  status: 'queued' | 'running' | 'done' | 'error'
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
}
