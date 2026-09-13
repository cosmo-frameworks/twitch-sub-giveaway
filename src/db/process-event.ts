/**
 * Todo en una transacción: marcar procesado, dar de alta al participante e
 * insertar las papeletas es todo o nada. Si se marcara el evento y fallara la
 * inserción, al reintentar se descartaría por duplicado y esas papeletas se
 * perderían sin dejar rastro.
 */

import type { SubEvent } from '../twitch/normalize.js'
import type { Db } from './client.js'
import { insertEntries } from './repositories/entries.js'
import { isProcessed, markProcessed } from './repositories/events.js'
import { upsertParticipant } from './repositories/participants.js'
import type { Entry } from './schema.js'

/** Una papeleta a punto de guardarse. La produce el motor de reglas. */
export interface EntryDraft {
  platform: string
  /** A quién se le apunta. En un regalo es el REGALADOR. */
  userId: string
  login: string
  displayName: string
  source: Entry['source']
  tier: string | null
  weight: number
  /** Posición dentro del evento: 0..N-1 en un gift bomb de N. */
  giftIndex: number
}

export interface ProcessEventInput {
  giveawayId: string
  event: SubEvent
  drafts: EntryDraft[]
  /** Si se quiere guardar el payload original para auditoría. */
  rawPayload?: string | null
}

export interface ProcessEventResult {
  status:
    /** Se guardaron papeletas. */
    | 'inserted'
    /** Ya estaba en `processed_events`: no se tocó nada. */
    | 'duplicate'
    /** Evento válido pero sin papeletas (p. ej. regalo anónimo descartado). */
    | 'no-entries'
  entriesInserted: number
}

export function processEvent(db: Db, input: ProcessEventInput): ProcessEventResult {
  const { event, drafts, giveawayId } = input
  const occurredAt = event.occurredAt.toISOString()

  return db.transaction((tx) => {
    if (isProcessed(tx, event.messageId)) {
      return { status: 'duplicate', entriesInserted: 0 }
    }

    // Se marca siempre, incluso sin papeletas: si no, un reenvío del mismo
    // mensaje volvería a evaluarse entero.
    markProcessed(tx, {
      messageId: event.messageId,
      type: event.type,
      receivedAt: occurredAt,
    })

    if (drafts.length === 0) {
      return { status: 'no-entries', entriesInserted: 0 }
    }

    // Un gift bomb trae N papeletas del mismo regalador: se da de alta una vez.
    const seen = new Set<string>()
    for (const d of drafts) {
      const key = `${d.platform}:${d.userId}`
      if (seen.has(key)) continue
      seen.add(key)

      upsertParticipant(tx, {
        platform: d.platform,
        userId: d.userId,
        login: d.login,
        displayName: d.displayName,
        seenAt: occurredAt,
      })
    }

    const inserted = insertEntries(tx, {
      giveawayId,
      eventId: event.messageId,
      occurredAt,
      rawPayload: input.rawPayload ?? null,
      rows: drafts.map((d) => ({
        platform: d.platform,
        userId: d.userId,
        source: d.source,
        tier: d.tier,
        weight: d.weight,
        giftIndex: d.giftIndex,
      })),
    })

    return { status: 'inserted', entriesInserted: inserted }
  })
}
