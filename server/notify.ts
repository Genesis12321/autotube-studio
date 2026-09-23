import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir } from './render'

const API = 'https://api.telegram.org'

let chatId = process.env.TELEGRAM_CHAT_ID ?? ''
let dataDir = ''
/** Un mismo fallo se repite en cada intento: solo se avisa una vez por motivo. */
const sent = new Set<string>()

const token = (): string => process.env.TELEGRAM_BOT_TOKEN ?? ''

/** El chat se descubre del primer mensaje que el usuario escribe al bot y queda guardado. */
const resolveChatId = async (): Promise<string> => {
  if (chatId) return chatId
  const res = await fetch(`${API}/bot${token()}/getUpdates`)
  if (!res.ok) return ''
  const body = (await res.json()) as {
    result?: { message?: { chat?: { id?: number } } }[]
  }
  const found = body.result?.map((u) => u.message?.chat?.id).find((id): id is number => typeof id === 'number')
  if (found === undefined) return ''
  chatId = String(found)
  await ensureDir(dataDir)
  await writeFile(path.join(dataDir, 'telegram.json'), JSON.stringify({ chatId }), 'utf8')
  return chatId
}

export const loadNotify = async (dir: string): Promise<void> => {
  dataDir = dir
  if (chatId) return
  try {
    const saved = JSON.parse(await readFile(path.join(dir, 'telegram.json'), 'utf8')) as { chatId?: string }
    chatId = saved.chatId ?? ''
  } catch {
    /* aún sin chat conocido */
  }
}

export const notify = async (text: string, dedupeKey?: string): Promise<boolean> => {
  if (!token()) return false
  if (dedupeKey) {
    if (sent.has(dedupeKey)) return false
    sent.add(dedupeKey)
  }
  const chat = await resolveChatId()
  if (!chat) return false
  const res = await fetch(`${API}/bot${token()}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  })
  return res.ok
}

export const notifyStatus = (): { configured: boolean; chatReady: boolean } => ({
  configured: Boolean(token()),
  chatReady: Boolean(chatId),
})
