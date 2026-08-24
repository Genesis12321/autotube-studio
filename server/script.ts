import type { JobInput, Scene } from './types'

const HOOKS = [
  'Esto es lo que nadie te cuenta sobre',
  'En 60 segundos vas a entender',
  'Presta atención, porque esto cambia todo sobre',
  'La mayoría se equivoca cuando habla de',
]

const BODY = [
  'El primer punto clave es entender de dónde viene todo. Sin ese contexto, cualquier consejo se queda en la superficie.',
  'Aquí está el detalle que marca la diferencia: no se trata de hacer más, sino de hacer lo correcto en el momento correcto.',
  'Un error muy común es copiar lo que funciona a otros sin adaptarlo. Los resultados dependen del contexto, no de la fórmula.',
  'Los datos son claros: quienes aplican esto de forma constante durante unas semanas ven un cambio real y medible.',
  'Y si crees que es demasiado complejo, empieza por lo mínimo viable. La constancia siempre gana a la intensidad.',
]

const CTA = [
  'Si te ha servido, sigue el canal: cada semana subimos algo nuevo.',
  'Guarda este vídeo, porque vas a querer volver a verlo.',
  'Cuéntame en comentarios qué parte vas a aplicar primero.',
]

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]

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
const scenesFromScript = (script: string, sceneCount: number): Scene[] => {
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
    narration,
    keywords: keywordsFrom(narration),
  }))
}

const generateLocal = (input: JobInput): { title: string; scenes: Scene[] } => {
  const sceneCount = Math.max(3, Math.min(8, Math.round(input.targetDuration / 12)))
  if (input.script?.trim()) {
    return { title: input.topic || 'Vídeo sin título', scenes: scenesFromScript(input.script, sceneCount) }
  }
  const topic = input.topic.trim()
  const scenes: Scene[] = []
  scenes.push({
    index: 0,
    heading: 'Gancho',
    narration: `${pick(HOOKS, topic.length)} ${topic}.`,
    keywords: keywordsFrom(topic),
  })
  for (let i = 1; i < sceneCount - 1; i += 1) {
    const narration = `${pick(BODY, i + topic.length)} Aplicado a ${topic}, esto significa dar un paso concreto hoy mismo.`
    scenes.push({ index: i, heading: `Punto ${i}`, narration, keywords: keywordsFrom(narration) })
  }
  scenes.push({
    index: sceneCount - 1,
    heading: 'Cierre',
    narration: pick(CTA, topic.length),
    keywords: keywordsFrom(topic),
  })
  return { title: `${topic} — explicado en ${input.targetDuration}s`, scenes }
}

const generateWithOpenAI = async (input: JobInput, apiKey: string): Promise<{ title: string; scenes: Scene[] }> => {
  const prompt = [
    `Eres guionista de vídeos cortos "faceless" para YouTube.`,
    `Tema: ${input.topic}`,
    input.script?.trim() ? `Guion base del usuario (respétalo): ${input.script}` : '',
    `Tono: ${input.tone}. Formato: ${input.format === 'vertical' ? 'Shorts vertical' : 'horizontal 16:9'}.`,
    `Duración objetivo: ${input.targetDuration} segundos.`,
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
      narration: s.narration,
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
