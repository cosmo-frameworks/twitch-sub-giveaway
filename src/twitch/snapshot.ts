/**
 * Red de última instancia: si la base se corrompe, queda un JSON con quién
 * estaba suscrito cada día. En la carpeta de datos, no en una ruta relativa.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CurrentSubscriber } from './reconcile.js'

export const BACKUPS_DIRNAME = 'backups'

/** `subs-2026-09-13.json` */
export function snapshotFilename(date: Date): string {
  return `subs-${date.toISOString().slice(0, 10)}.json`
}

export interface SnapshotResult {
  /** Ruta escrita, o `null` si la de hoy ya existía. */
  path: string | null
  subscribers: number
}

/**
 * Escribe la copia de hoy si no existe todavía.
 *
 * Se llama en cada reconciliación —arranque y cada reconexión—, que pueden ser
 * muchas en un día malo de red. Solo la primera del día escribe.
 */
export async function writeDailySnapshot(options: {
  dataDir: string
  subscribers: CurrentSubscriber[]
  now?: Date
}): Promise<SnapshotResult> {
  const now = options.now ?? new Date()
  const dir = join(options.dataDir, BACKUPS_DIRNAME)
  const filename = snapshotFilename(now)

  await mkdir(dir, { recursive: true })

  const existing = await readdir(dir)
  if (existing.includes(filename)) {
    return { path: null, subscribers: options.subscribers.length }
  }

  const path = join(dir, filename)
  await writeFile(
    path,
    `${JSON.stringify(
      {
        takenAt: now.toISOString(),
        count: options.subscribers.length,
        subscribers: options.subscribers,
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  return { path, subscribers: options.subscribers.length }
}
