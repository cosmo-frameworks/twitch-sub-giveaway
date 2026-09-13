/**
 * Vive siempre en la carpeta de datos: es el fichero que dice dónde está todo
 * lo demás, así que no puede moverse. Solo la base es configurable; los tokens
 * no (ver `TOKENS_FILENAME`).
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

import { z } from 'zod'

export const SETTINGS_FILENAME = 'settings.json'

export const settingsSchema = z.object({
  /** Ruta absoluta al fichero de base de datos. Ausente = la de por defecto. */
  dbPath: z.string().trim().min(1).optional(),
})

export type Settings = z.infer<typeof settingsSchema>

export class SettingsError extends Error {
  override readonly name = 'SettingsError'
}

/**
 * Lee los ajustes de la carpeta de datos.
 *
 * @returns `{}` si el fichero no existe (primer arranque).
 * @throws {SettingsError} si existe pero no se puede interpretar.
 *
 * Fallar aquí es deliberado. La alternativa —seguir con la ruta por defecto—
 * abriría una base de datos vacía mientras la de verdad sigue en la carpeta que
 * el streamer eligió, y lo parecería todo normal hasta el momento del sorteo.
 */
export async function readSettings(dataDir: string): Promise<Settings> {
  const file = join(dataDir, SETTINGS_FILENAME)

  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new SettingsError(`No se pudo leer ${file}: ${(error as Error).message}`)
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new SettingsError(
      `${file} no es JSON válido. Corrígelo o bórralo para volver a los valores por defecto.`,
    )
  }

  const parsed = settingsSchema.safeParse(json)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('; ')
    throw new SettingsError(
      `${file} tiene un formato inesperado (${detail}). ` +
        'Corrígelo o bórralo para volver a los valores por defecto.',
    )
  }

  return parsed.data
}

/** Guarda los ajustes de forma atómica. Normaliza `dbPath` a ruta absoluta. */
export async function writeSettings(dataDir: string, settings: Settings): Promise<void> {
  const parsed = settingsSchema.parse(settings)

  const normalized: Settings = {
    ...parsed,
    // Una ruta relativa guardada aquí tendría el mismo problema que queríamos
    // evitar: dependería de desde dónde se arrancó la app.
    ...(parsed.dbPath !== undefined && !isAbsolute(parsed.dbPath)
      ? { dbPath: resolve(parsed.dbPath) }
      : {}),
  }

  const file = join(dataDir, SETTINGS_FILENAME)
  const tmp = `${file}.tmp`

  await mkdir(dataDir, { recursive: true })
  await writeFile(tmp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
}
