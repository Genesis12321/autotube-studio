import type { JobInput, Scene } from './types'

/** Palabras por segundo del locutor TTS en español (espeak-ng a 150 ppm). */
export const WORDS_PER_SECOND = 2.4

const HOOKS = [
  'Esto es lo que nadie te cuenta sobre',
  'En segundos vas a entender',
  'Atención: esto cambia todo sobre',
  'Casi todo el mundo se equivoca con',
]

const BODY = [
  'La clave no es hacer más, sino hacer lo correcto.',
  'El error típico es copiar fórmulas sin adaptarlas.',
  'Con constancia, el cambio se nota en pocas semanas.',
  'Empieza por lo mínimo: un paso pequeño hoy.',
  'Mide el resultado y ajusta sobre la marcha.',
]

const CTA = [
  'Si te sirve, sigue el canal.',
  'Guarda el vídeo y aplícalo hoy.',
  'Cuéntame en comentarios por dónde empiezas.',
]

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]

/** Recorta la narración al presupuesto de palabras que cabe en la duración objetivo. */
const trimWords = (text: string, maxWords: number): string => {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text.trim()
  const cut = words.slice(0, Math.max(4, maxWords)).join(' ').replace(/[,;:]$/, '')
  return /[.!?]$/.test(cut) ? cut : `${cut}.`
}

const keywordsFrom = (text: string): string[] =>
  Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 4),
    ),
  ).slice(0, 4)

/** Splits a user-provided script into scenes of roughly equal narration length. */
const scenesFromScript = (script: string, sceneCount: number, wordsPerScene: number): Scene[] => {
  const sentences = script
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const perScene = Math.max(1, Math.ceil(sentences.length / sceneCount))
  const chunks: string[] = []
  for (let i = 0; i < sentences.length; i += perScene) {
    chunks.push(sentences.slice(i, i + perScene).join(' '))
  }
  return chunks.slice(0, sceneCount).map((narration, index) => ({
    index,
    heading: index === 0 ? 'Gancho' : index === chunks.length - 1 ? 'Cierre' : `Punto ${index}`,
    narration: trimWords(narration, wordsPerScene),
    keywords: keywordsFrom(narration),
  }))
}

const generateLocal = (input: JobInput): { title: string; scenes: Scene[] } => {
  const sceneCount = Math.max(3, Math.min(6, Math.round(input.targetDuration / 10)))
  // Deja margen para las transiciones: ~88% del tiempo objetivo es locución.
  const wordsPerScene = Math.max(6, Math.floor((input.targetDuration * WORDS_PER_SECOND * 0.88) / sceneCount))

  if (input.script?.trim()) {
    return {
      title: input.topic || 'Vídeo sin título',
      scenes: scenesFromScript(input.script, sceneCount, wordsPerScene),
    }
  }

  const topic = input.topic.trim()
  const scenes: Scene[] = [
    {
      index: 0,
      heading: 'Gancho',
      narration: trimWords(`${pick(HOOKS, topic.length)} ${topic}.`, wordsPerScene),
      keywords: keywordsFrom(topic),
    },
  ]
  let cursor = topic.length
  for (let i = 1; i < sceneCount - 1; i += 1) {
    // Encadena frases sin repetirlas hasta acercarse al presupuesto de palabras.
    let narration = pick(BODY, cursor++)
    while (narration.split(/\s+/).length < wordsPerScene * 0.7 && cursor < topic.length + BODY.length) {
      narration = `${narration} ${pick(BODY, cursor++)}`
    }
    scenes.push({
      index: i,
      heading: `Punto ${i}`,
      narration: trimWords(narration, wordsPerScene),
      keywords: keywordsFrom(`${topic} ${narration}`),
    })
  }
  scenes.push({
    index: sceneCount - 1,
    heading: 'Cierre',
    narration: trimWords(pick(CTA, topic.length), wordsPerScene),
    keywords: keywordsFrom(topic),
  })
  return { title: topic, scenes }
}

const generateWithOpenAI = async (input: JobInput, apiKey: string): Promise<{ title: string; scenes: Scene[] }> => {
  const prompt = [
    `Eres guionista de vídeos cortos "faceless" para YouTube.`,
    `Tema: ${input.topic}`,
    input.script?.trim() ? `Guion base del usuario (respétalo): ${input.script}` : '',
    `Tono: ${input.tone}. Formato: ${input.format === 'vertical' ? 'Shorts vertical' : 'horizontal 16:9'}.`,
    `Duración objetivo: ${input.targetDuration} segundos leídos en voz alta,`,
    `así que el guion completo debe tener como máximo ${Math.round(input.targetDuration * WORDS_PER_SECOND * 0.88)} palabras`,
    `repartidas en ${Math.max(3, Math.min(6, Math.round(input.targetDuration / 10)))} escenas. Frases cortas y directas, en español.`,
    `Incluye en "keywords" 3 términos EN INGLÉS para buscar imágenes de stock que ilustren la escena.`,
    `Devuelve SOLO JSON con la forma {"title": string, "scenes": [{"heading": string, "narration": string, "keywords": string[]}]}.`,
    `La narración debe sonar natural leída en voz alta, sin emojis ni markdown.`,
  ]
    .filter(Boolean)
    .join('\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}`)
  const payload = (await res.json()) as { choices: { message: { content: string } }[] }
  const parsed = JSON.parse(payload.choices[0].message.content) as {
    title: string
    scenes: { heading: string; narration: string; keywords?: string[] }[]
  }
  return {
    title: parsed.title,
    scenes: parsed.scenes.map((s, index) => ({
      index,
      heading: s.heading,
      narration: trimWords(
        s.narration,
        Math.floor((input.targetDuration * WORDS_PER_SECOND * 0.88) / Math.max(1, parsed.scenes.length)),
      ),
      keywords: s.keywords ?? keywordsFrom(s.narration),
    })),
  }
}

export const generateScript = async (
  input: JobInput,
): Promise<{ title: string; scenes: Scene[]; source: 'openai' | 'local' }> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (apiKey) {
    try {
      const result = await generateWithOpenAI(input, apiKey)
      return { ...result, source: 'openai' }
    } catch (err) {
      console.warn('[script] OpenAI no disponible, uso generador local:', (err as Error).message)
    }
  }
  return { ...generateLocal(input), source: 'local' }
}
