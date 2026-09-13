import { randomUUID } from 'node:crypto'

import { and, eq, sql } from 'drizzle-orm'

import type { Db } from '../client.js'
import { entries, participants, type Entry } from '../schema.js'

export interface InsertEntriesInput {
  giveawayId: string
  /** `message_id` de EventSub, o `null` en entradas manuales / reconciliadas. */
  eventId: string | null
  occurredAt: string
  rawPayload?: string | null
  /** La papeleta viene de reconciliar contra Helix, no de un evento en directo. */
  reconciled?: boolean
  rows: Array<{
    platform: string
    userId: string
    source: Entry['source']
    tier: string | null
    weight: number
    giftIndex: number
  }>
}

/** Inserta las papeletas de un evento. Una fila por entrada, no un contador. */
export function insertEntries(db: Db, input: InsertEntriesInput): number {
  if (input.rows.length === 0) return 0

  db.insert(entries)
    .values(
      input.rows.map((row) => ({
        id: randomUUID(),
        giveawayId: input.giveawayId,
        platform: row.platform,
        userId: row.userId,
        source: row.source,
        tier: row.tier,
        weight: row.weight,
        eventId: input.eventId,
        giftIndex: row.giftIndex,
        reconciled: input.reconciled ?? false,
        occurredAt: input.occurredAt,
        rawPayload: input.rawPayload ?? null,
      })),
    )
    .run()

  return input.rows.length
}

export interface ParticipantTally {
  platform: string
  userId: string
  entries: number
  weight: number
}

/** Recuento por participante, que es lo que pinta el panel. */
export function tallyByParticipant(db: Db, giveawayId: string): ParticipantTally[] {
  return db
    .select({
      platform: entries.platform,
      userId: entries.userId,
      entries: sql<number>`count(*)`,
      weight: sql<number>`sum(${entries.weight})`,
    })
    .from(entries)
    .where(eq(entries.giveawayId, giveawayId))
    .groupBy(entries.platform, entries.userId)
    .all()
}

export function countEntries(db: Db, giveawayId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(entries)
    .where(eq(entries.giveawayId, giveawayId))
    .get()
  return row?.n ?? 0
}

export function entriesForParticipant(
  db: Db,
  giveawayId: string,
  platform: string,
  userId: string,
): Entry[] {
  return db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.giveawayId, giveawayId),
        eq(entries.platform, platform),
        eq(entries.userId, userId),
      ),
    )
    .all()
}

export interface ParticipantEntriesRow {
  platform: string
  userId: string
  login: string
  displayName: string
  /** Número de papeletas. */
  entries: number
  /** Suma de pesos: lo que de verdad pesa en el sorteo. */
  weight: number
  /** Fuentes distintas que le dieron papeletas, separadas por coma. */
  sources: string
  /** Cuándo entró su primera papeleta en este sorteo. */
  firstEntryAt: string
  lastEntryAt: string
}

/**
 * Lista agregada por participante — lo que pinta el panel.
 *
 * Se une con `participants` para tener el nombre para mostrar: `entries` solo
 * guarda el `user_id`, que es lo único inmutable.
 */
export function entriesByParticipant(db: Db, giveawayId: string): ParticipantEntriesRow[] {
  return db
    .select({
      platform: entries.platform,
      userId: entries.userId,
      login: participants.login,
      displayName: participants.displayName,
      entries: sql<number>`count(*)`,
      weight: sql<number>`sum(${entries.weight})`,
      sources: sql<string>`group_concat(distinct ${entries.source})`,
      firstEntryAt: sql<string>`min(${entries.occurredAt})`,
      lastEntryAt: sql<string>`max(${entries.occurredAt})`,
    })
    .from(entries)
    .innerJoin(
      participants,
      and(eq(entries.platform, participants.platform), eq(entries.userId, participants.userId)),
    )
    .where(eq(entries.giveawayId, giveawayId))
    .groupBy(entries.platform, entries.userId)
    .orderBy(sql`count(*) desc`, participants.displayName)
    .all()
}

export interface GiveawayTotals {
  entries: number
  weight: number
  participants: number
}

export function giveawayTotals(db: Db, giveawayId: string): GiveawayTotals {
  const row = db
    .select({
      entries: sql<number>`count(*)`,
      weight: sql<number>`coalesce(sum(${entries.weight}), 0)`,
      participants: sql<number>`count(distinct ${entries.platform} || ':' || ${entries.userId})`,
    })
    .from(entries)
    .where(eq(entries.giveawayId, giveawayId))
    .get()

  return row ?? { entries: 0, weight: 0, participants: 0 }
}
