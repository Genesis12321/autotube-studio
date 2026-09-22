import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './pipeline'
import { ensureDir } from './render'

/** Casos ya publicados en el canal: la IA no puede volver a proponerlos. */
const SEED = [
  'El Incidente del Paso Dyatlov: la tienda rasgada desde dentro',
  'Las huellas inexplicables en la nieve de los Urales',
  'El Incidente del Paso Dyatlov: la tragedia de los 9 excursionistas',
  'D.B. Cooper: el hombre que saltó con 200.000 dólares',
  'El misterio de la maleta y los billetes marcados de D.B. Cooper',
  'D.B. Cooper: el secuestro aéreo perfecto que desconcertó al FBI',
  'La Colonia Roanoke: una isla entera desaparecida',
  'La misteriosa palabra CROATOAN en el árbol de Roanoke',
  'La leyenda de Roanoke: la desaparición de toda una colonia humana',
  'El Asesino del Zodiaco: el enigma de los criptogramas',
  'El mensaje cifrado del Zodiaco resuelto 50 años después',
  'El Zodiaco: el criminal que se burló de la policía',
  'El Hotel Cecil: sucesos en la habitación 1001',
  'El perturbador vídeo del ascensor de Elisa Lam',
  'El Hotel Cecil: la maldición del edificio más oscuro de Los Ángeles',
  'El caso de Mary Pinchot Meyer: asesinato conectado con JFK',
  'El diario secreto de Mary Pinchot Meyer robado por la CIA',
  'El misterio de Mary Pinchot Meyer y la conspiración del diario',
  'Vuelo MH370: un Boeing 777 borrado del radar',
  'El giro manual del MH370 que desconcertó a los radares militares',
  'MH370: qué pasó realmente con el avión fantasma',
  'El Monstruo de Florencia: el terror de las parejas en Italia',
  'Las cartas burlonas del Monstruo de Florencia enviadas a la fiscalía',
  'El Monstruo de Florencia: la cacería humana en la Toscana',
  'La leyenda de la Llorona: el origen histórico real',
  'El suceso de la Llorona documentado en la época colonial',
  'La Llorona: realidad histórica frente al mito del crimen colonial',
  'El enigma de Hinterkaifeck: la granja sin supervivientes',
  'Las pisadas en la nieve de Hinterkaifeck que no salían de la casa',
  'Hinterkaifeck: el crimen impune que aterrorizó a Alemania',
  'El Escuadrón 19: aviones perdidos en el Triángulo de las Bermudas',
  'La última transmisión del Escuadrón 19: todo se ve raro',
  'El Triángulo de las Bermudas y la desaparición del Escuadrón 19',
  'El Asesino del Hacha de Nueva Orleans',
  'La noche en que Nueva Orleans tocó jazz para salvarse del Asesino del Hacha',
  'El Asesino del Hacha: el psicópata melómano de Nueva Orleans',
  'El caso Alcàsser: sombras tras la versión oficial',
  'La fuga imposible de Antonio Anglés',
  'El caso Alcàsser: las incógnitas de un crimen sin cerrar',
  'El Somerton Man: cadáver con una frase en persa',
  'El código secreto del maletero del Somerton Man',
  'Tamám Shud: el enigma del hombre sin identidad',
]

/** Palabras demasiado genéricas para decidir que dos temas son el mismo caso. */
const COMMON = new Set([
  'misterio', 'misterios', 'misterioso', 'misteriosa', 'caso', 'enigma', 'leyenda', 'historia', 'secreto',
  'secretos', 'oscuro', 'oscura', 'crimen', 'asesino', 'asesinato', 'desaparicion', 'desaparecida',
  'desaparecidos', 'noche', 'hombre', 'mujer', 'nunca', 'jamas', 'policia', 'verdad', 'version', 'oficial',
  'ultima', 'ultimo', 'sucesos', 'suceso', 'terror', 'video', 'real', 'reales', 'entera', 'imposible',
  'inexplicables', 'inexplicable', 'perturbador', 'mensaje', 'cartas', 'diario', 'codigo', 'cifrado', 'todo',
  'para', 'desde', 'entre', 'tras', 'entero', 'anos', 'despues',
])

const FILE = path.join(DATA_DIR, 'used-topics.json')
let used: string[] = [...SEED]

const tokens = (topic: string): string[] =>
  topic
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !COMMON.has(w))

export const loadUsedTopics = async (): Promise<void> => {
  try {
    const saved = JSON.parse(await readFile(FILE, 'utf8')) as string[]
    used = [...new Set([...SEED, ...saved])]
  } catch {
    used = [...SEED]
  }
}

export const usedTopics = (): string[] => used

/** Nombres que identifican por sí solos un caso ya publicado, aunque el título cambie por completo. */
const CASE_KEYS = new Set([
  'dyatlov', 'urales', 'cooper', 'roanoke', 'croatoan', 'zodiaco', 'criptogramas', 'cecil', 'elisa', 'lam',
  'pinchot', 'meyer', 'mh370', 'boeing', 'florencia', 'toscana', 'llorona', 'hinterkaifeck', 'escuadron',
  'bermudas', 'hacha', 'orleans', 'alcasser', 'angles', 'somerton', 'tamam', 'shud',
])

/** Repetido si comparte un nombre propio del caso o al menos dos palabras clave con un título ya usado. */
export const isUsedTopic = (topic: string): boolean => {
  const next = new Set(tokens(topic))
  if (next.size === 0) return true
  for (const word of next) if (CASE_KEYS.has(word)) return true
  return used.some((old) => tokens(old).filter((w) => next.has(w)).length >= 2)
}

export const markTopicUsed = async (topic: string): Promise<void> => {
  if (used.includes(topic)) return
  used.push(topic)
  await ensureDir(DATA_DIR)
  await writeFile(FILE, JSON.stringify(used, null, 2), 'utf8')
}
