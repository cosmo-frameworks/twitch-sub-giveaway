/** Puras: entran filas, sale texto. El formato es donde están los problemas. */

import type { ParticipantEntriesRow } from '../db/repositories/entries.js'
import type { Winner } from '../db/schema.js'

/**
 * Marca de orden de bytes al principio del CSV.
 *
 * Sin ella, Excel en Windows abre el fichero en la codificación del sistema y
 * destroza cualquier nombre con tilde o emoji — que en Twitch son casi todos.
 */
const BOM = '﻿'

/**
 * Escapa un valor para CSV.
 *
 * El apóstrofo delante de `=`, `+`, `-` y `@` evita que Excel interprete el
 * nombre como una fórmula. Un usuario que se llame `=cmd` no debería poder
 * ejecutar nada en el ordenador de quien abra el export.
 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''

  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`

  if (/[",\n\r;]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function csvRows(header: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [
    header.map((h) => csvCell(h)).join(','),
    ...rows.map((row) => row.map((cell) => csvCell(cell as string)).join(',')),
  ]
  // CRLF: es lo que espera Excel en Windows.
  return BOM + lines.join('\r\n') + '\r\n'
}

export function participantsToCsv(participants: readonly ParticipantEntriesRow[]): string {
  return csvRows(
    ['plataforma', 'user_id', 'login', 'nombre', 'papeletas', 'peso', 'origen', 'primera', 'ultima'],
    participants.map((p) => [
      p.platform,
      p.userId,
      p.login,
      p.displayName,
      p.entries,
      p.weight,
      p.sources,
      p.firstEntryAt,
      p.lastEntryAt,
    ]),
  )
}

export function winnersToCsv(winners: readonly Winner[]): string {
  return csvRows(
    ['puesto', 'plataforma', 'user_id', 'semilla', 'sorteado_el'],
    winners.map((w) => [w.position, w.platform, w.userId, w.seed, w.drawnAt]),
  )
}

/** Nombre de fichero con el canal y la fecha, para no acabar con seis `export.csv`. */
export function exportFilename(
  what: 'participantes' | 'ganadores',
  giveawayName: string,
  at: Date,
  extension: 'csv' | 'json',
): string {
  const slug = giveawayName
    .toLowerCase()
    .normalize('NFD')
    // Quita los diacríticos que `NFD` acaba de separar.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

  return `${what}-${slug || 'sorteo'}-${at.toISOString().slice(0, 10)}.${extension}`
}
