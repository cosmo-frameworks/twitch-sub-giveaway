import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'

import type { Db } from '../client.js'
import { entries, giveaways, winners, type Giveaway } from '../schema.js'

export function createGiveaway(
  db: Db,
  input: { id?: string; name: string; openedAt: string },
): Giveaway {
  const row: Giveaway = {
    id: input.id ?? randomUUID(),
    name: input.name,
    status: 'open',
    openedAt: input.openedAt,
    closedAt: null,
  }
  db.insert(giveaways).values(row).run()
  return row
}

/** El sorteo al que van a parar las entradas nuevas. */
export function findOpenGiveaway(db: Db): Giveaway | undefined {
  return db.select().from(giveaways).where(eq(giveaways.status, 'open')).get()
}

export function getGiveaway(db: Db, id: string): Giveaway | undefined {
  return db.select().from(giveaways).where(eq(giveaways.id, id)).get()
}

export function closeGiveaway(db: Db, id: string, closedAt: string): void {
  db.update(giveaways).set({ status: 'closed', closedAt }).where(eq(giveaways.id, id)).run()
}

export function listGiveaways(db: Db): Giveaway[] {
  return db.select().from(giveaways).orderBy(sql`${giveaways.openedAt} desc`).all()
}

/** Un sorteo del archivo: el sorteo y lo que dio de sí. */
export interface GiveawayWithTotals extends Giveaway {
  entries: number
  participants: number
  winners: number
}

/**
 * Los sorteos con sus cifras, para el archivo.
 *
 * Tres consultas y no una: unir `entries` y `winners` en la misma sentencia
 * multiplica las filas de una tabla por las de la otra, y un sorteo con 10
 * papeletas y 3 ganadores acabaría contando 30 papeletas. Son tres consultas
 * fijas, no tres por sorteo.
 */
export function listGiveawaysWithTotals(db: Db): GiveawayWithTotals[] {
  const entryTotals = db
    .select({
      giveawayId: entries.giveawayId,
      entries: sql<number>`count(*)`,
      participants: sql<number>`count(distinct ${entries.platform} || ':' || ${entries.userId})`,
    })
    .from(entries)
    .groupBy(entries.giveawayId)
    .all()

  const winnerTotals = db
    .select({ giveawayId: winners.giveawayId, winners: sql<number>`count(*)` })
    .from(winners)
    .groupBy(winners.giveawayId)
    .all()

  const byEntries = new Map(entryTotals.map((row) => [row.giveawayId, row]))
  const byWinners = new Map(winnerTotals.map((row) => [row.giveawayId, row.winners]))

  return listGiveaways(db).map((giveaway) => ({
    ...giveaway,
    entries: byEntries.get(giveaway.id)?.entries ?? 0,
    participants: byEntries.get(giveaway.id)?.participants ?? 0,
    winners: byWinners.get(giveaway.id) ?? 0,
  }))
}

/**
 * El sorteo abierto; si no queda ninguno, uno nuevo.
 *
 * Se usa en el camino de las papeletas en directo. Perder la papeleta de
 * alguien que acaba de suscribirse es el peor fallo que puede tener este
 * programa: si el streamer cerró el último sorteo y no abrió otro, es mejor
 * abrirlo por él que tirar la papeleta. Un sorteo de más es un fastidio menor.
 *
 * Para leer —el panel, el estado— está `findOpenGiveaway`, que no crea nada.
 */
export function ensureOpenGiveaway(
  db: Db,
  input: { name: string; at: string },
): { giveaway: Giveaway; created: boolean } {
  const open = findOpenGiveaway(db)
  if (open) return { giveaway: open, created: false }

  return {
    giveaway: createGiveaway(db, { name: input.name, openedAt: input.at }),
    created: true,
  }
}

/**
 * Abre un sorteo nuevo y cierra el que estuviera abierto.
 *
 * Solo puede haber uno abierto a la vez: las papeletas que llegan en directo no
 * sabrían a cuál ir.
 */
export function openNewGiveaway(
  db: Db,
  input: { name: string; at: string },
): { opened: Giveaway; closed: Giveaway | null } {
  return db.transaction((tx) => {
    const current = findOpenGiveaway(tx)
    if (current) {
      tx.update(giveaways)
        .set({ status: 'closed', closedAt: input.at })
        .where(eq(giveaways.id, current.id))
        .run()
    }

    const opened: Giveaway = {
      id: randomUUID(),
      name: input.name,
      status: 'open',
      openedAt: input.at,
      closedAt: null,
    }
    tx.insert(giveaways).values(opened).run()

    return { opened, closed: current ?? null }
  })
}

/** Vuelve a admitir papeletas en un sorteo cerrado. */
export function reopenGiveaway(db: Db, id: string, at: string): Giveaway | undefined {
  return db.transaction((tx) => {
    const current = findOpenGiveaway(tx)
    if (current && current.id !== id) {
      tx.update(giveaways)
        .set({ status: 'closed', closedAt: at })
        .where(eq(giveaways.id, current.id))
        .run()
    }
    tx.update(giveaways).set({ status: 'open', closedAt: null }).where(eq(giveaways.id, id)).run()
    return tx.select().from(giveaways).where(eq(giveaways.id, id)).get()
  })
}
