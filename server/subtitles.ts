import { writeFile } from 'node:fs/promises'

/** Trozos cortos: es el ritmo con el que se leen los subtítulos de Shorts/TikTok. */
const chunkWords = (text: string, maxChars: number): string[] => {
  const chunks: string[] = []
  let current = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      chunks.push(current)
      current = word
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks
}

const timecode = (seconds: number): string => {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`
}

const escape = (text: string): string => text.replace(/[\\{}]/g, '').replace(/\n/g, ' ')

/** Reparte el tiempo del trozo entre sus palabras y lo expresa en etiquetas \k (centisegundos). */
const karaoke = (chunk: string, seconds: number): string => {
  const words = chunk.split(/\s+/).filter(Boolean)
  const weight = words.reduce((sum, word) => sum + word.length + 1, 0) || 1
  const total = Math.max(1, Math.round(seconds * 100))
  let used = 0
  return words
    .map((word, i) => {
      const cs =
        i === words.length - 1
          ? Math.max(1, total - used)
          : Math.max(1, Math.round(((word.length + 1) / weight) * total))
      used += cs
      return `{\\k${cs}}${escape(word)}`
    })
    .join(' ')
}

/**
 * Subtítulos tipo karaoke sincronizados con la locución de la escena: cada trozo aparece
 * durante el tiempo proporcional a su longitud, con un pequeño rebote al entrar.
 */
export const writeSceneSubtitles = async (
  narration: string,
  duration: number,
  size: { w: number; h: number },
  file: string,
): Promise<void> => {
  const { w, h } = size
  const chunks = chunkWords(narration, w > h ? 34 : 22)
  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0) || 1
  // La locución lleva una cola de silencio: los subtítulos terminan antes que la escena.
  const speech = Math.max(0.6, duration - 0.45)

  const fontSize = Math.round(h * (w > h ? 0.062 : 0.032))
  const events: string[] = []
  let start = 0
  for (const chunk of chunks) {
    const end = Math.min(speech, start + (chunk.length / totalChars) * speech)
    events.push(
      `Dialogue: 0,${timecode(start)},${timecode(end)},Karaoke,,0,0,0,,` +
        `{\\fad(60,60)\\fscx88\\fscy88\\t(0,110,\\fscx100\\fscy100)}${karaoke(chunk, end - start)}`,
    )
    start = end
  }

  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic,' +
      ' Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment,' +
      ' MarginL, MarginR, MarginV, Encoding',
    `Style: Karaoke,DejaVu Sans,${fontSize},&H0000D7FF,&H00FFFFFF,&H00101010,&H80000000,-1,0,0,0,100,100,1,0,1,` +
      `${Math.round(fontSize * 0.12)},${Math.round(fontSize * 0.08)},2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${Math.round(h * 0.16)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
  ].join('\n')

  await writeFile(file, ass, 'utf8')
}
