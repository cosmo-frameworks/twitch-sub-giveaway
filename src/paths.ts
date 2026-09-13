import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

export const APP_DIR_NAME = 'twitch-sorteos'

export interface AppDataDirOptions {
  platform?: NodeJS.Platform
  env?: Record<string, string | undefined>
  home?: string
}

export function appDataDir(options: AppDataDirOptions = {}): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()

  if (platform === 'win32') {
    return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_DIR_NAME)
  }

  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', APP_DIR_NAME)
  }

  return join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP_DIR_NAME)
}

/**
 * Aparte de `appDataDir` porque el log de arranque se escribe antes de cargar
 * la configuración y tiene que caer donde está todo lo demás.
 */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  return env.TWITCH_SORTEOS_DATA_DIR?.trim() || appDataDir({ env })
}

export const DEFAULT_DB_FILENAME = 'sorteos.db'

/** Nunca se mueve de la carpeta de datos: son las credenciales del streamer. */
export const TOKENS_FILENAME = 'tokens.json'
