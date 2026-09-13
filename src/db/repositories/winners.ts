import { randomUUID } from 'node:crypto'

import { and, asc, eq, lte, sql } from 'drizzle-orm'

import type { DrawTicketT, DrawWinnerT } from '../../draw/draw.js'
import type { Db } from '../client.js'
import { entries, participants, winners, type Winner } from '../schema.js'

/**
 * Las papeletas que entran en el sorteo.
 *
 * `at` acota el bote a lo que existía en un momento dado. Sin eso, verificar un
 * sorteo de hace una hora fallaría en cuanto entrara un sub nuevo: el resultado
 * no cambiaría por trampa, sino porque el bote ya no es el mismo.
 */
export function ticketsForDraw(db: Db, giveawayId: string, at?: string): DrawTicketT[] {
  const where = at
    ? and(eq(entries.giveawayId, giveawayId), lte(entries.occurredAt, at))
    : eq(entries.giveawayId, giveawayId)

  return db
    .select({
      entryId: entries.id,
      platform: entries.platform,
      userId: entries.userId,
      displayName: participants.displayName,
      weight: entries.weight,
    })
    .from(entries)
    .innerJoin(
      participants,
      and(eq(entries.platform, participants.platform), eq(entries.userId, participants.userId)),
    )
    .where(where)
    .all()
}

/** Todos los ganadores del sorteo, del más reciente al más antiguo. */
export function winnersForGiveaway(db: Db, giveawayId: string): Winner[] {
  return db
    .select()
    .from(winners)
    .where(eq(winners.giveawayId, giveawayId))
    .orderBy(sql`${winners.drawnAt} desc`, asc(winners.position))
    .all()
}

/** Los ganadores de una tirada concreta, identificada por su semilla. */
export function winnersBySeed(db: Db, giveawayId: string, seed: string): Winner[] {
  return db
    .select()
    .from(winners)
    .where(and(eq(winners.giveawayId, giveawayId), eq(winners.seed, seed)))
    .orderBy(asc(winners.position))
    .all()
}

/** A quién hay que dejar fuera si se pide excluir a los que ya ganaron. */
export function pastWinnerRefs(
  db: Db,
  giveawayId: string,
): Array<{ platform: string; userId: string }> {
  return db
    .selectDistinct({ platform: winners.platform, userId: winners.userId })
    .from(winners)
    .where(eq(winners.giveawayId, giveawayId))
    .all()
}

/** Guarda una tirada entera. Todo o nada. */
export function recordDraw(
  db: Db,
  input: { giveawayId: string; seed: string; drawnAt: string; winners: readonly DrawWinnerT[] },
): Winner[] {
  if (input.winners.length === 0) return []

  const rows: Winner[] = input.winners.map((w) => ({
    id: randomUUID(),
    giveawayId: input.giveawayId,
    platform: w.platform,
    userId: w.userId,
    position: w.position,
    seed: input.seed,
    drawnAt: input.drawnAt,
  }))

  db.transaction((tx) => {
    tx.insert(winners).values(rows).run()
  })

  return rows
}

/**
 * Fecha de la papeleta más reciente del sorteo.
 *
 * Sirve para fijar el corte del bote al sortear: se usa `max(ahora, esta)` para
 * que ninguna papeleta existente quede fuera por un reloj desajustado, y para
 * que la verificación pueda recomponer exactamente el mismo bote después.
 */
export function latestEntryAt(db: Db, giveawayId: string): string | null {
  const row = db
    .select({ at: sql<string | null>`max(${entries.occurredAt})` })
    .from(entries)
    .where(eq(entries.giveawayId, giveawayId))
    .get()
  return row?.at ?? null
}

/**
 * Ganadores en el orden en que se registraron.
 *
 * Se usa el `rowid` de SQLite en vez de `drawn_at` porque dos tiradas seguidas
 * pueden compartir marca de tiempo al milisegundo, y entonces "quién ganó
 * antes" deja de tener respuesta. El orden de inserción sí la tiene siempre.
 */
export function winnersInInsertionOrder(
  db: Db,
  giveawayId: string,
): Array<{ order: number; seed: string; platform: string; userId: string }> {
  return db
    .select({
      order: sql<number>`${winners}.rowid`,
      seed: winners.seed,
      platform: winners.platform,
      userId: winners.userId,
    })
    .from(winners)
    .where(eq(winners.giveawayId, giveawayId))
    .orderBy(sql`${winners}.rowid asc`)
    .all()
}
