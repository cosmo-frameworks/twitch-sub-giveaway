/**
 * `entries` guarda UNA FILA POR ENTRADA, no un contador: el sorteo es un SELECT
 * plano y se puede reconstruir por qué alguien tenía N papeletas.
 */

import { sql } from 'drizzle-orm'
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { ENTRY_SOURCES } from '../config.js'

/** La columna `platform` existe para el bot multiplataforma futuro. */
export const PLATFORM_TWITCH = 'twitch'

export const participants = sqliteTable(
  'participants',
  {
    platform: text('platform').notNull().default(PLATFORM_TWITCH),
    /** Inmutable: el login puede cambiar, esto no. */
    userId: text('user_id').notNull(),
    login: text('login').notNull(),
    displayName: text('display_name').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.platform, t.userId] })],
)

export const giveaways = sqliteTable('giveaways', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', { enum: ['open', 'closed', 'drawn'] }).notNull(),
  openedAt: text('opened_at').notNull(),
  closedAt: text('closed_at'),
})

export const entries = sqliteTable(
  'entries',
  {
    id: text('id').primaryKey(),
    giveawayId: text('giveaway_id')
      .notNull()
      .references(() => giveaways.id),
    platform: text('platform').notNull().default(PLATFORM_TWITCH),
    userId: text('user_id').notNull(),
    source: text('source', { enum: ENTRY_SOURCES }).notNull(),
    /** '1000' | '2000' | '3000'. TEXT libre: ver la nota sobre "prime" en config.ts. */
    tier: text('tier'),
    weight: integer('weight').notNull().default(1),
    /** `message_id` de EventSub. `null` en entradas manuales o reconciliadas. */
    eventId: text('event_id'),
    /**
     * Un gift bomb de 20 subs genera 20 filas con el mismo `event_id` y
     * `source`; sin esta columna el índice único rechazaría de la segunda en
     * adelante.
     */
    giftIndex: integer('gift_index').notNull().default(0),
    /** Vino de reconciliar contra Helix al arrancar, no de un evento en directo. */
    reconciled: integer('reconciled', { mode: 'boolean' }).notNull().default(false),
    occurredAt: text('occurred_at').notNull(),
    rawPayload: text('raw_payload'),
  },
  (t) => [
    /** Idempotencia en la base: el mismo mensaje no puede entrar dos veces. */
    uniqueIndex('entries_event_unique')
      .on(t.giveawayId, t.eventId, t.source, t.giftIndex)
      .where(sql`${t.eventId} IS NOT NULL`),

    /** OJO: SQLite solo lo cumple con `PRAGMA foreign_keys = ON` (ver client.ts). */
    foreignKey({
      columns: [t.platform, t.userId],
      foreignColumns: [participants.platform, participants.userId],
      name: 'entries_participant_fk',
    }),

    /**
     * Las reconciliadas llevan `event_id = NULL` y el índice de arriba las
     * excluye por su WHERE. Sin esto, cada reinicio daría otra papeleta a todos
     * los subs actuales: diez reinicios, diez papeletas por cabeza.
     */
    uniqueIndex('entries_reconciled_unique')
      .on(t.giveawayId, t.platform, t.userId, t.source)
      .where(sql`${t.reconciled} = 1`),

    index('entries_giveaway_idx').on(t.giveawayId),
    index('entries_participant_idx').on(t.giveawayId, t.platform, t.userId),
  ],
)

/** Twurple deduplica en memoria 10 minutos; esto es lo que sobrevive a un reinicio. */
export const processedEvents = sqliteTable('processed_events', {
  messageId: text('message_id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: text('received_at').notNull(),
})

export const winners = sqliteTable(
  'winners',
  {
    id: text('id').primaryKey(),
    giveawayId: text('giveaway_id')
      .notNull()
      .references(() => giveaways.id),
    platform: text('platform').notNull(),
    userId: text('user_id').notNull(),
    position: integer('position').notNull(),
    /** Reproduce la tirada y además la identifica: cada sorteo tiene la suya. */
    seed: text('seed').notNull(),
    drawnAt: text('drawn_at').notNull(),
  },
  (t) => [
    /** Una tirada no se puede registrar dos veces. */
    uniqueIndex('winners_draw_unique').on(t.giveawayId, t.seed, t.position),
    index('winners_giveaway_idx').on(t.giveawayId),
  ],
)

export type Participant = typeof participants.$inferSelect
export type Giveaway = typeof giveaways.$inferSelect
export type Entry = typeof entries.$inferSelect
export type NewEntry = typeof entries.$inferInsert
export type Winner = typeof winners.$inferSelect
