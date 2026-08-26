import type { JobInput, Scene } from './types'

/** Palabras por segundo medidas en la locución real (Piper en español, con pausas entre frases). */
export const WORDS_PER_SECOND = 2.55

const HOOKS = [
  'Esto es lo que nadie te cuenta sobre',
  'En segundos vas a entender',
  'Atención: esto cambia todo sobre',
  'Casi todo el mundo se equivoca con',
]

/** Frases del cuerpo parametrizadas con el tema para que la narración no suene genérica. */
const BODY = [
  (t: string) => `La mayoría falla con ${t} por buscar resultados rápidos.`,
  (t: string) => `Con ${t}, lo que manda es la constancia, no la intensidad.`,
  () => 'Empieza con cinco minutos al día y sube poco a poco.',
  () => 'Anota tu progreso: lo que se mide, mejora.',
  (t: string) => `En pocas semanas notarás la diferencia de ${t}.`,
  (t: string) => `Antes de nada, aclaremos qué significa realmente ${t}.`,
  (t: string) => `Hay tres errores habituales cuando alguien empieza con ${t}.`,
  () => 'El primero es querer abarcar demasiado el primer día.',
  () => 'El segundo es no reservar un hueco fijo en la agenda.',
  () => 'El tercero es abandonar en cuanto aparece el primer bache.',
  (t: string) => `Para evitarlo, define un objetivo pequeño y concreto con ${t}.`,
  () => 'Repite la misma rutina a la misma hora durante dos semanas.',
  () => 'Si un día fallas, retoma al siguiente sin castigarte.',
  (t: string) => `Mucha gente cree que ${t} exige mucho tiempo, y no es cierto.`,
  () => 'Con quince minutos bien enfocados avanzas más que con dos horas dispersas.',
  () => 'Quita distracciones: móvil en silencio y una sola tarea delante.',
  (t: string) => `Revisa cada semana qué te está funcionando en ${t} y qué no.`,
  () => 'Ajusta solo una variable cada vez para saber qué causa la mejora.',
  () => 'Rodéate de gente que ya hace lo que tú quieres conseguir.',
  (t: string) => `Al cabo de un mes, ${t} deja de costarte y se vuelve costumbre.`,
  (t: string) => `Vamos con un ejemplo práctico aplicado a ${t}.`,
  () => 'Imagina que solo tienes veinte minutos libres al día.',
  () => 'Divide ese rato en dos bloques de diez minutos.',
  () => 'En el primero preparas, en el segundo ejecutas.',
  (t: string) => `Ese pequeño sistema es lo que sostiene ${t} a largo plazo.`,
  (t: string) => `Otro punto clave de ${t} es medir sin obsesionarse.`,
  () => 'Apunta solo dos datos: si lo hiciste y cómo te sentiste.',
  () => 'Con eso ya detectas patrones en dos semanas.',
  (t: string) => `Cuando aparezca el aburrimiento, cambia la forma, no el objetivo de ${t}.`,
  () => 'Cambia de lugar, de horario o de método, pero no abandones.',
  (t: string) => `Mucha gente compara su día uno con el año diez de otro en ${t}.`,
  () => 'Compárate solo contigo mismo hace un mes.',
  (t: string) => `Prepara el entorno para que ${t} sea la opción fácil.`,
  () => 'Deja todo listo la noche anterior y reduce decisiones.',
  () => 'Cuanto menos pienses, menos excusas encontrarás.',
  (t: string) => `Ponle un final claro a cada sesión de ${t}.`,
  () => 'Terminar con energía de sobra hace que quieras volver mañana.',
  (t: string) => `Y recuerda: ${t} no va de motivación, va de sistema.`,
  () => 'La motivación llega a ratos; el sistema aguanta los días malos.',
  (t: string) => `Resumiendo: objetivo pequeño, hora fija y revisión semanal en ${t}.`,
]

const CTA = [
  (t: string) => `Prueba hoy con ${t} y cuéntame cómo te va.`,
  () => 'Guarda el vídeo y aplícalo hoy mismo.',
  () => 'Si te sirve, sigue el canal para más.',
]

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]

/** Recorta la narración al presupuesto de palabras que cabe en la duración objetivo. */
const trimWords = (text: string, maxWords: number): string => {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text.trim()

  // Recorta por frases completas para no dejar la narración a medias.
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  const kept: string[] = []
  let count = 0
  for (const sentence of sentences) {
    const length = sentence.split(/\s+/).filter(Boolean).length
    if (kept.length > 0 && count + length > maxWords) break
    kept.push(sentence)
    count += length
  }
  if (kept.length > 1 || count <= maxWords) return kept.join(' ').trim()

  const cut = words.slice(0, Math.max(4, maxWords)).join(' ').replace(/[,;:]$/, '')
  return /[.!?]$/.test(cut) ? cut : `${cut}.`
}

/** Palabras abstractas que como consulta de imagen devuelven fotos sin relación con el tema. */
const ABSTRACT = new Set([
  'mayoria', 'mayoría', 'resultados', 'rapidos', 'rápidos', 'constancia', 'intensidad', 'progreso', 'diferencia',
  'errores', 'habituales', 'alguien', 'empieza', 'objetivo', 'concreto', 'misma', 'rutina', 'durante', 'semanas',
  'siguiente', 'castigarte', 'mucha', 'gente', 'cierto', 'quince', 'minutos', 'enfocados', 'avanzas', 'horas',
  'dispersas', 'distracciones', 'silencio', 'tarea', 'delante', 'semana', 'funcionando', 'ajusta', 'variable',
  'saber', 'causa', 'mejora', 'conseguir', 'costumbre', 'ejemplo', 'practico', 'práctico', 'aplicado', 'imagina',
  'veinte', 'libres', 'divide', 'bloques', 'primero', 'preparas', 'segundo', 'ejecutas', 'pequeño', 'sistema',
  'sostiene', 'largo', 'plazo', 'punto', 'clave', 'medir', 'obsesionarse', 'apunta', 'datos', 'hiciste', 'sentiste',
  'detectas', 'patrones', 'aparezca', 'aburrimiento', 'cambia', 'forma', 'lugar', 'horario', 'metodo', 'método',
  'abandones', 'compara', 'ano', 'año', 'comparate', 'compárate', 'contigo', 'mismo', 'prepara', 'entorno',
  'opcion', 'opción', 'facil', 'fácil', 'todo', 'listo', 'noche', 'anterior', 'reduce', 'decisiones', 'cuanto',
  'menos', 'pienses', 'excusas', 'encontraras', 'encontrarás', 'ponle', 'final', 'claro', 'cada', 'sesion',
  'sesión', 'terminar', 'energia', 'energía', 'sobra', 'quieras', 'volver', 'manana', 'mañana', 'recuerda',
  'motivacion', 'motivación', 'llega', 'ratos', 'aguanta', 'malos', 'resumiendo', 'revision', 'revisión',
  'semanal', 'prueba', 'cuentame', 'cuéntame', 'guarda', 'video', 'vídeo', 'aplicalo', 'aplícalo', 'sirve',
  'sigue', 'canal', 'nadie', 'cuenta', 'sobre', 'segundos', 'entender', 'atencion', 'atención', 'cambia todo',
  'equivoca', 'antes', 'nada', 'aclaremos', 'significa', 'realmente', 'evitarlo', 'define', 'repite', 'exige',
  'mucho', 'tiempo', 'quita', 'movil', 'móvil', 'solo', 'sola', 'rodeate', 'rodéate', 'quiere', 'cabo',
])

const keywordsFrom = (text: string): string[] =>
  Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 4 && !ABSTRACT.has(w)),
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
    heading: index === 0 ? 'Gancho' : index === chunks.length - 1 ? 'Cierre' : `Clave ${index}`,
    narration: trimWords(narration, wordsPerScene),
    keywords: keywordsFrom(narration),
  }))
}

/** Escenas de ~11 s: suficientes para leer el texto en pantalla y trocear vídeos largos. */
export const sceneCountFor = (targetDuration: number): number =>
  Math.max(3, Math.min(48, Math.round(targetDuration / (targetDuration > 120 ? 13 : 10))))

const generateLocal = (input: JobInput): { title: string; scenes: Scene[] } => {
  const sceneCount = sceneCountFor(input.targetDuration)
  const wordsPerScene = Math.max(6, Math.floor((input.targetDuration * WORDS_PER_SECOND * 0.95) / sceneCount))
  // Tope holgado: las frases ya se encadenan hasta el presupuesto, así el recorte no las mutila.
  const maxWordsPerScene = Math.round(wordsPerScene * 1.35)

  if (input.script?.trim()) {
    return {
      title: input.topic || 'Vídeo sin título',
      scenes: scenesFromScript(input.script, sceneCount, wordsPerScene),
    }
  }

  const topic = input.topic.trim()
  const subject = topic.charAt(0).toLowerCase() + topic.slice(1)
  let cursor = topic.length

  // Encadena frases sin repetirlas hasta acercarse al presupuesto de palabras de la escena.
  const expand = (start: string): string => {
    const limit = cursor + BODY.length
    let narration = start
    while (narration.split(/\s+/).length < wordsPerScene && cursor < limit) {
      narration = `${narration} ${pick(BODY, cursor++)(subject)}`
    }
    return narration
  }

  const scenes: Scene[] = [
    {
      index: 0,
      heading: 'Gancho',
      narration: trimWords(expand(`${pick(HOOKS, topic.length)} ${subject}.`), maxWordsPerScene),
      keywords: keywordsFrom(topic),
    },
  ]
  for (let i = 1; i < sceneCount - 1; i += 1) {
    const narration = expand(pick(BODY, cursor++)(subject))
    scenes.push({
      index: i,
      heading: `Clave ${i}`,
      narration: trimWords(narration, maxWordsPerScene),
      keywords: keywordsFrom(`${topic} ${narration}`),
    })
  }
  scenes.push({
    index: sceneCount - 1,
    heading: 'Cierre',
    narration: trimWords(expand(pick(CTA, topic.length)(subject)), maxWordsPerScene),
    keywords: keywordsFrom(topic),
  })
  return { title: topic, scenes }
}

type AiScript = { title: string; scenes: { heading: string; narration: string; keywords?: string[] }[] }

const promptFor = (input: JobInput): string =>
  [
    `Eres guionista de vídeos cortos "faceless" para YouTube.`,
    `Tema: ${input.topic}`,
    input.script?.trim() ? `Guion base del usuario (respétalo): ${input.script}` : '',
    `Tono: ${input.tone}. Formato: ${input.format === 'vertical' ? 'Shorts vertical' : 'horizontal 16:9'}.`,
    `Duración objetivo: ${input.targetDuration} segundos leídos en voz alta,`,
    `así que el guion completo debe tener como máximo ${Math.round(input.targetDuration * WORDS_PER_SECOND * 0.95)} palabras`,
    `repartidas en ${sceneCountFor(input.targetDuration)} escenas. Frases cortas y directas, en español.`,
    `Incluye en "keywords" 3 términos EN INGLÉS para buscar imágenes de stock que ilustren la escena.`,
    `Devuelve SOLO JSON con la forma {"title": string, "scenes": [{"heading": string, "narration": string, "keywords": string[]}]}.`,
    `La narración debe sonar natural leída en voz alta, sin emojis ni markdown.`,
  ]
    .filter(Boolean)
    .join('\n')

/** Normaliza la respuesta del modelo al formato de escenas del pipeline. */
const scenesFromAi = (parsed: AiScript, input: JobInput): { title: string; scenes: Scene[] } => ({
  title: parsed.title,
  scenes: parsed.scenes.map((s, index) => ({
    index,
    heading: s.heading,
    narration: trimWords(
      s.narration,
      Math.floor((input.targetDuration * WORDS_PER_SECOND * 0.95) / Math.max(1, parsed.scenes.length)),
    ),
    keywords: s.keywords ?? keywordsFrom(s.narration),
  })),
})

const generateWithOpenAI = async (input: JobInput, apiKey: string): Promise<{ title: string; scenes: Scene[] }> => {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: promptFor(input) }],
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}`)
  const payload = (await res.json()) as { choices: { message: { content: string } }[] }
  return scenesFromAi(JSON.parse(payload.choices[0].message.content) as AiScript, input)
}

/** Gemini: alternativa con nivel gratuito, útil cuando la cuenta de OpenAI no tiene saldo. */
const generateWithGemini = async (input: JobInput, apiKey: string): Promise<{ title: string; scenes: Scene[] }> => {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptFor(input) }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
  )
  if (!res.ok) throw new Error(`gemini ${res.status}`)
  const payload = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('gemini sin respuesta')
  return scenesFromAi(JSON.parse(text) as AiScript, input)
}

export const generateScript = async (
  input: JobInput,
): Promise<{ title: string; scenes: Scene[]; source: 'openai' | 'gemini' | 'local' }> => {
  const providers = [
    { source: 'openai' as const, key: process.env.OPENAI_API_KEY?.trim(), run: generateWithOpenAI },
    { source: 'gemini' as const, key: process.env.GEMINI_API_KEY?.trim(), run: generateWithGemini },
  ]

  for (const { source, key, run } of providers) {
    if (!key) continue
    try {
      return { ...(await run(input, key)), source }
    } catch (err) {
      console.warn(`[script] ${source} no disponible, pruebo el siguiente:`, (err as Error).message)
    }
  }
  return { ...generateLocal(input), source: 'local' }
}
