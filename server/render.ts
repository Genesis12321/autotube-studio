import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

export const synthVoice = async (text: string, voice: VoiceId, outFile: string): Promise<number> => {
  const textFile = `${outFile}.txt`
  await writeFile(textFile, text.replace(/["']/g, ''), 'utf8')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `flite=textfile=${textFile}:v=${voice}`,
    '-ar', '44100', '-ac', '2',
    outFile,
  ])
  return probeDuration(outFile)
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
  opts: { format: VideoFormat; audioFile: string; duration: number; workDir: string; title: string },
): Promise<string> => {
  const { format, audioFile, duration, workDir, title } = opts
  const [w, h] = format === 'vertical' ? [1080, 1920] : [1920, 1080]
  const [c0, c1] = PALETTES[scene.index % PALETTES.length]
  const out = path.join(workDir, `scene-${scene.index}.mp4`)

  const bodyFile = path.join(workDir, `scene-${scene.index}-body.txt`)
  const headFile = path.join(workDir, `scene-${scene.index}-head.txt`)
  await writeFile(bodyFile, wrap(scene.narration, format === 'vertical' ? 26 : 44), 'utf8')
  await writeFile(headFile, scene.index === 0 ? title : scene.heading, 'utf8')

  const bodySize = format === 'vertical' ? 58 : 52
  const headSize = format === 'vertical' ? 44 : 40

  const filters = [
    `[0:v]format=yuv420p[bg]`,
    `[bg]drawbox=x=0:y=0:w=${w}:h=${h}:color=black@0.28:t=fill[dim]`,
    `[dim]drawtext=fontfile=${FONT}:textfile=${headFile}:fontsize=${headSize}:fontcolor=0xfacc15:` +
      `x=(w-text_w)/2:y=h*0.16:box=1:boxcolor=black@0.45:boxborderw=22[head]`,
    `[head]drawtext=fontfile=${FONT}:textfile=${bodyFile}:fontsize=${bodySize}:fontcolor=white:line_spacing=16:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.35:boxborderw=34[txt]`,
    `[txt]fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0.1, duration - 0.35).toFixed(2)}:d=0.35[v]`,
  ].join(';')

  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:d=${duration.toFixed(2)}:speed=0.02:r=30`,
    '-i', audioFile,
    '-filter_complex', filters,
    '-map', '[v]', '-map', '1:a',
    '-t', duration.toFixed(2),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
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

export const concatAudio = async (files: string[], workDir: string, outFile: string): Promise<void> => {
  const listFile = path.join(workDir, 'concat-audio.txt')
  await writeFile(listFile, files.map((f) => `file '${f}'`).join('\n'), 'utf8')
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:a', 'libmp3lame', '-q:a', '4',
    outFile,
  ])
}

export const ensureDir = (dir: string) => mkdir(dir, { recursive: true })
