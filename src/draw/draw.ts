/**
 * Pura: entran papeletas y semilla, salen ganadores. Dos detalles que parecen
 * menores y no lo son:
 *
 *  - Las papeletas se ORDENAN antes de sortear. Si el resultado dependiera del
 *    orden del SELECT, reproducirlo exigiría que SQLite devolviera las filas
 *    siempre igual, y eso no está garantizado.
 *  - Cada extracción usa su propio índice de semilla, no un estado que avanza:
 *    así el puesto 3 se verifica por separado.
 */

import { seededInt } from './rng.js'

export interface DrawTicketT {
  entryId: string
  platform: string
  userId: string
  displayName: string
  /** Peso por tier. Con la configuración por defecto, siempre 1. */
  weight: number
}

export interface DrawParticipantRefT {
  platform: string
  userId: string
}

export interface DrawWinnerT {
  position: number
  platform: string
  userId: string
  displayName: string
}

export interface DrawOptionsT {
  tickets: readonly DrawTicketT[]
  winners: number
  seed: string
  /** Participantes que no entran: típicamente los que ya ganaron antes. */
  exclude?: readonly DrawParticipantRefT[]
}

export interface DrawResultT {
  seed: string
  winners: DrawWinnerT[]
  /** El bote sobre el que se sorteó, ya descontadas las exclusiones. */
  pool: {
    tickets: number
    weight: number
    participants: number
  }
}

const key = (platform: string, userId: string): string => `${platform}:${userId}`

export function draw(options: DrawOptionsT): DrawResultT {
  const excluded = new Set((options.exclude ?? []).map((e) => key(e.platform, e.userId)))

  const pool = options.tickets
    // Una papeleta sin peso no reparte nada; dejarla dentro solo estorbaría al
    // recorrido acumulado.
    .filter((t) => t.weight > 0 && !excluded.has(key(t.platform, t.userId)))
    // Orden canónico: el resultado no puede depender de cómo salgan del SELECT.
    .slice()
    .sort((a, b) => a.entryId.localeCompare(b.entryId))

  const result: DrawResultT = {
    seed: options.seed,
    winners: [],
    pool: {
      tickets: pool.length,
      weight: pool.reduce((sum, t) => sum + t.weight, 0),
      participants: new Set(pool.map((t) => key(t.platform, t.userId))).size,
    },
  }

  const alreadyWon = new Set<string>()
  let remaining = pool

  for (let position = 1; position <= options.winners; position++) {
    if (remaining.length === 0) break

    const totalWeight = remaining.reduce((sum, t) => sum + t.weight, 0)
    if (totalWeight <= 0) break

    // Se recorre el bote acumulando pesos hasta pasar el número sorteado: es el
    // equivalente exacto a meter todas las papeletas en un bombo.
    const target = seededInt(options.seed, position, BigInt(totalWeight))

    let accumulated = 0n
    let winner: DrawTicketT | undefined
    for (const ticket of remaining) {
      accumulated += BigInt(ticket.weight)
      if (accumulated > target) {
        winner = ticket
        break
      }
    }
    if (!winner) break

    result.winners.push({
      position,
      platform: winner.platform,
      userId: winner.userId,
      displayName: winner.displayName,
    })

    // Nadie gana dos veces: fuera TODAS sus papeletas, no solo la que salió.
    alreadyWon.add(key(winner.platform, winner.userId))
    remaining = remaining.filter((t) => !alreadyWon.has(key(t.platform, t.userId)))
  }

  return result
}
