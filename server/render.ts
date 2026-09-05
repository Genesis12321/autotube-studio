import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { writeSceneSubtitles } from './subtitles'
import type { Scene, VideoFormat, VoiceId } from './types'

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

const PALETTES: [string, string][] = [
  ['0x7c3aed', '0x0ea5e9'],
  ['0xef4444', '0xf59e0b'],
  ['0x059669', '0x0ea5e9'],
  ['0xdb2777', '0x7c3aed'],
  ['0x0f172a', '0x2563eb'],
  ['0xf97316', '0xdb2777'],
  ['0x14b8a6', '0x1e293b'],
  ['0x6366f1', '0x22d3ee'],
]

export const run = (bin: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args)
    let stderr = ''
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`${bin} exited ${code}: ${stderr.slice(-600)}`)),
    )
  })

export const probeDuration = async (file: string): Promise<number> => {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    file,
  ])
  return Number.parseFloat(out) || 0
}

/** Voces neuronales de Piper (español) con su equivalente robótico de espeak-ng como respaldo. */
const VOICES: Record<VoiceId, { piper: string; speaker?: string; espeak: [string, number, number] }> = {
  slt: { piper: 'es_ES-sharvard-medium', speaker: '1', espeak: ['es+f3', 62, 140] },
  kal16: { piper: 'es_ES-davefx-medium', espeak: ['es', 45, 140] },
  awb: { piper: 'es_MX-claude-high', espeak: ['es+m3', 30, 136] },
  rms: { piper: 'es_AR-daniela-high', espeak: ['es-419', 42, 140] },
}

const PIPER_BIN = process.env.PIPER_BIN ?? path.join(process.env.HOME ?? '/home/ubuntu', 'piper-venv/bin/python')
const PIPER_VOICES = process.env.PIPER_VOICES_DIR ?? path.join(process.env.HOME ?? '/home/ubuntu', 'piper-voices')
/** Alarga los fonemas: 1.0 suena acelerado para narración. */
const PIPER_LENGTH_SCALE = '1.12'

const exists = async (file: string): Promise<boolean> =>
  access(file).then(
    () => true,
    () => false,
  )

export const piperModelFor = async (voice: VoiceId): Promise<string | null> => {
  const model = path.join(PIPER_VOICES, `${(VOICES[voice] ?? VOICES.slt).piper}.onnx`)
  return (await exists(PIPER_BIN)) && (await exists(model)) ? model : null
}

export const synthVoice = async (text: string, voice: VoiceId, outFile: string): Promise<number> => {
  const textFile = `${outFile}.txt`
  const rawFile = `${outFile}.raw.wav`
  const padFile = `${outFile}.pad.wav`
  await writeFile(textFile, text, 'utf8')

  const config = VOICES[voice] ?? VOICES.slt
  const model = await piperModelFor(voice)
  if (model) {
    const speaker = config.speaker
    await run(PIPER_BIN, [
      '-m', 'piper',
      '--model', model,
      '--input-file', textFile,
      '--output-file', rawFile,
      '--length-scale', PIPER_LENGTH_SCALE,
      '--sentence-silence', '0.25',
      ...(speaker ? ['--speaker', speaker] : []),
    ])
  } else {
    const [espeakVoice, pitch, speed] = config.espeak
    await run('espeak-ng', [
      '-v', espeakVoice,
      '-s', String(speed),
      '-p', String(pitch),
      '-g', '1',
      '-f', textFile,
      '-w', rawFile,
    ])
  }

  // Formato uniforme, ganancia fija (la normalización se hace una vez sobre la pista completa)
  // y una cola corta de silencio para respirar entre escenas.
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', rawFile,
    '-af', 'apad=pad_dur=0.15,apad=whole_dur=1.6,afade=t=in:st=0:d=0.02',
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
    padFile,
  ])

  // Se ajusta a un múltiplo exacto de frame (30 fps) para que la pista continua no derive
  // respecto al vídeo a lo largo de decenas de escenas.
  const target = Math.ceil((await probeDuration(padFile)) * 30 - 0.001) / 30
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', padFile,
    '-af', `apad=whole_dur=${target.toFixed(4)},atrim=0:${target.toFixed(4)}`,
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
    outFile,
  ])
  return target
}

/** Une las locuciones en una sola pista continua y la normaliza una única vez. */
export const buildVoiceTrack = async (files: string[], workDir: string, outFile: string): Promise<void> => {
  const listFile = path.join(workDir, 'concat-voice.txt')
  await writeFile(listFile, files.map((f) => `file '${f}'`).join('\n'), 'utf8')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le',
    outFile,
  ])
}

/**
 * Multiplexa el vídeo mudo ya concatenado con la pista de voz continua. Si hay música libre,
 * se mezcla de fondo con compresión sidechain para que baje sola cuando habla la voz.
 */
export const muxVoice = async (
  videoFile: string,
  audioFile: string,
  outFile: string,
  musicFile?: string | null,
): Promise<void> => {
  const mix = [
    '[1:a]asplit=2[voice][key]',
    '[2:a]aloop=loop=-1:size=2e9,volume=0.16,afade=t=in:st=0:d=2[bed]',
    '[bed][key]sidechaincompress=threshold=0.03:ratio=12:attack=20:release=400[duck]',
    '[voice][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]',
  ].join(';')

  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', videoFile, '-i', audioFile,
    ...(musicFile ? ['-i', musicFile] : []),
    ...(musicFile ? ['-filter_complex', mix, '-map', '0:v:0', '-map', '[a]'] : ['-map', '0:v:0', '-map', '1:a:0']),
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest', '-movflags', '+faststart',
    outFile,
  ])
}

const wrap = (text: string, maxChars: number): string => {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxChars) {
      if (line) lines.push(line.trim())
      line = word
    } else {
      line = `${line} ${word}`
    }
  }
  if (line.trim()) lines.push(line.trim())
  return lines.join('\n')
}

export const renderScene = async (
  scene: Scene,
  opts: {
    format: VideoFormat
    duration: number
    workDir: string
    title: string
    imageFile?: string | null
    imageFileB?: string | null
    clipFile?: string | null
    clipFileB?: string | null
    fadeIn?: boolean
    fadeOut?: boolean
  },
): Promise<string> => {
  const { format, duration, workDir, title, imageFile, clipFile, fadeIn, fadeOut } = opts
  // Solo se usa un segundo plano cuando la escena da tiempo a que la transición se aprecie.
  const imageFileB = duration >= 7 ? opts.imageFileB : null
  const clipFileB = duration >= 7 ? opts.clipFileB : null
  const [w, h] = format === 'vertical' ? [1080, 1920] : [1920, 1080]
  const [c0, c1] = PALETTES[scene.index % PALETTES.length]
  const out = path.join(workDir, `scene-${scene.index}.mp4`)

  const headFile = path.join(workDir, `scene-${scene.index}-head.txt`)
  const subsFile = path.join(workDir, `scene-${scene.index}.ass`)
  // El titular solo se muestra en la primera escena y cuando no es un "Escena N" sin valor.
  const heading =
    scene.index === 0
      ? wrap(title, format === 'vertical' ? 24 : 40)
      : /^escena\s*\d*$/i.test(scene.heading.trim())
        ? ''
        : scene.heading
  await writeFile(headFile, heading, 'utf8')
  await writeSceneSubtitles(scene.narration, duration, { w, h }, subsFile)

  const headSize = format === 'vertical' ? 56 : 48
  const frames = Math.max(2, Math.round(duration * 30))

  // Ken Burns sobre la imagen de stock; degradado animado si no hay imagen.
  const kenBurns = (input: string, out: string, seconds: number): string =>
    `[${input}]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
    `zoompan=z='min(1+0.0006*on,1.12)':d=${Math.max(2, Math.round(seconds * 30))}:` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30,format=yuv420p,trim=0:${seconds.toFixed(2)},` +
    `setpts=PTS-STARTPTS[${out}]`

  // Con dos imágenes la escena cambia de plano por la mitad con una fundida cruzada.
  const half = duration / 2 + 0.5
  // El clip se repite en bucle hasta cubrir su tramo y se recorta al lienzo.
  const clipPlane = (input: string, out: string, seconds?: number): string =>
    `[${input}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,setsar=1,format=yuv420p` +
    (seconds ? `,trim=0:${seconds.toFixed(2)},setpts=PTS-STARTPTS` : '') +
    `[${out}]`

  const background = clipFile && clipFileB
    ? [
        clipPlane('0:v', 'bgA', half),
        clipPlane('1:v', 'bgB', half),
        `[bgA][bgB]xfade=transition=fade:duration=0.6:offset=${Math.max(0.1, half - 0.6).toFixed(2)}[bg]`,
      ].join(';')
    : clipFile
    ? clipPlane('0:v', 'bg')
    : imageFile && imageFileB
      ? [
          kenBurns('0:v', 'bgA', half),
          kenBurns('1:v', 'bgB', half),
          `[bgA][bgB]xfade=transition=fade:duration=0.6:offset=${Math.max(0.1, half - 0.6).toFixed(2)}[bg]`,
        ].join(';')
      : imageFile
        ? `[0:v]scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},` +
          `zoompan=z='min(1+0.0006*on,1.12)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${w}x${h}:fps=30,` +
          `format=yuv420p[bg]`
        : `[0:v]format=yuv420p[bg]`

  const filters = [
    background,
    // Contraste, saturación y viñeta: el material de stock sale plano y así parece etalonado.
    `[bg]eq=contrast=1.08:saturation=1.14:gamma=0.98,vignette=PI/5,` +
      `drawbox=x=0:y=0:w=${w}:h=${h}:color=black@0.24:t=fill[dim]`,
    heading
      ? `[dim]drawtext=fontfile=${FONT}:textfile=${headFile}:fontsize=${headSize}:fontcolor=0xfacc15:line_spacing=12:` +
        `x=(w-text_w)/2:y=h*0.12:box=1:boxcolor=black@0.55:boxborderw=22[head]`
      : '[dim]null[head]',
    // Subtítulos karaoke: aparecen por trozos de 2-3 palabras al ritmo de la locución.
    `[head]ass=${subsFile}[txt]`,
    // Solo se funde a negro al principio y al final del vídeo: entre escenas el corte es directo.
    `[txt]${[
      fadeIn ? 'fade=t=in:st=0:d=0.4' : null,
      fadeOut ? `fade=t=out:st=${Math.max(0.1, duration - 0.4).toFixed(2)}:d=0.4` : null,
    ]
      .filter(Boolean)
      .join(',') || 'null'}[v]`,
  ].join(';')

  const videoInput = clipFile
    ? [
        '-stream_loop', '-1', '-t', (clipFileB ? half : duration).toFixed(2), '-i', clipFile,
        ...(clipFileB ? ['-stream_loop', '-1', '-t', half.toFixed(2), '-i', clipFileB] : []),
      ]
    : imageFile
    ? [
        '-loop', '1', '-t', duration.toFixed(2), '-i', imageFile,
        ...(imageFileB ? ['-loop', '1', '-t', duration.toFixed(2), '-i', imageFileB] : []),
      ]
    : [
        '-f', 'lavfi',
        '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:d=${duration.toFixed(2)}:speed=0.02:r=30`,
      ]

  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    ...videoInput,
    '-filter_complex', filters,
    '-map', '[v]', '-an',
    '-t', duration.toFixed(2),
    '-r', '30',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    out,
  ])
  return out
}

export const concatScenes = async (files: string[], workDir: string, outFile: string): Promise<void> => {
  const listFile = path.join(workDir, 'concat.txt')
  await writeFile(listFile, files.map((f) => `file '${f}'`).join('\n'), 'utf8')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy', '-movflags', '+faststart',
    outFile,
  ])
}

const frameBrightness = async (videoFile: string, at: number): Promise<number> => {
  const out = await run('ffprobe', [
    '-v', 'error', '-f', 'lavfi',
    `movie=${videoFile.replace(/:/g, '\\:')}:seek_point=${at.toFixed(2)},signalstats`,
    '-show_entries', 'frame_tags=lavfi.signalstats.YAVG',
    '-read_intervals', '%+#1', '-of', 'csv=p=0',
  ]).catch(() => '')
  return Number.parseFloat(out.split('\n')[0]) || 0
}

/**
 * Portadas candidatas para YouTube: varios fotogramas del vídeo, ordenados del más
 * luminoso al más oscuro, oscurecidos y con el título en grande.
 * No corta el flujo si falla: el vídeo ya está montado.
 */
export const makeThumbnails = async (
  videoFile: string,
  title: string,
  format: VideoFormat,
  workDir: string,
  count = 4,
): Promise<string[]> => {
  const [w, h] = format === 'vertical' ? [1080, 1920] : [1920, 1080]
  const textFile = path.join(workDir, 'thumb.txt')
  const maxChars = format === 'vertical' ? 14 : 20
  const text = wrap(title, maxChars)
  await writeFile(textFile, text, 'utf8')
  // El cuerpo se ajusta a la línea más larga (~0.6 em por carácter en DejaVu Bold) para no desbordar.
  const longest = Math.max(...text.split('\n').map((line) => line.length), 1)
  const fontSize = Math.round(Math.min(h * 0.075, (w * 0.86) / (longest * 0.6)))
  const duration = await probeDuration(videoFile)

  const scored = await Promise.all(
    [0.12, 0.28, 0.45, 0.62, 0.78, 0.9]
      .map((r) => Math.max(0.5, duration * r))
      .map(async (at) => ({ at, luma: await frameBrightness(videoFile, at) })),
  )
  const picks = scored.sort((a, b) => b.luma - a.luma).slice(0, count)

  const files: string[] = []
  for (const [i, pick] of picks.entries()) {
    const outFile = path.join(workDir, `thumb-${i}.jpg`)
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', pick.at.toFixed(2), '-i', videoFile,
      '-frames:v', '1',
      '-vf', [
        // El fotograma lleva quemados el rótulo de escena y los subtítulos: se recortan.
        'crop=iw:ih*0.58:0:ih*0.2',
        `scale=${w}:${h}:force_original_aspect_ratio=increase`,
        `crop=${w}:${h}`,
        'eq=contrast=1.15:saturation=1.25',
        `drawbox=x=0:y=0:w=${w}:h=${h}:color=black@0.35:t=fill`,
        `drawtext=fontfile=${FONT}:textfile=${textFile}:fontsize=${fontSize}:fontcolor=white:` +
          `line_spacing=${Math.round(fontSize * 0.25)}:borderw=${Math.round(fontSize * 0.09)}:bordercolor=black@0.9:` +
          'x=(w-text_w)/2:y=(h-text_h)/2',
      ].join(','),
      '-q:v', '3',
      outFile,
    ])
    files.push(outFile)
  }
  return files
}

export const encodeMp3 = async (inFile: string, outFile: string): Promise<void> => {
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inFile,
    '-c:a', 'libmp3lame', '-q:a', '4',
    outFile,
  ])
}

export const ensureDir = (dir: string) => mkdir(dir, { recursive: true })
