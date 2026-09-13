/**
 * Estas papeletas NO las respalda ningún evento de Twitch, así que el motivo y
 * la fecha se guardan en `raw_payload`: es la única explicación que quedará.
 */

import type { Db } from './client.js'
import { insertEntries } from './repositories/entries.js'
import { upsertParticipant } from './repositories/participants.js'

export interface ManualEntriesInput {
  giveawayId: string
  platform: string
  userId: string
  login: string
  displayName: string
  entries: number
  /** Por qué se añaden. Queda guardado: es toda la auditoría que habrá. */
  reason: string
  addedAt: string
}

export function addManualEntries(db: Db, input: ManualEntriesInput): number {
  return db.transaction((tx) => {
    upsertParticipant(tx, {
      platform: input.platform,
      userId: input.userId,
      login: input.login,
      displayName: input.displayName,
      seenAt: input.addedAt,
    })

    return insertEntries(tx, {
      giveawayId: input.giveawayId,
      // No vienen de ningún evento de EventSub.
      eventId: null,
      occurredAt: input.addedAt,
      rawPayload: JSON.stringify({ manual: true, reason: input.reason, addedAt: input.addedAt }),
      rows: Array.from({ length: input.entries }, (_, giftIndex) => ({
        platform: input.platform,
        userId: input.userId,
        source: 'manual' as const,
        tier: null,
        weight: 1,
        giftIndex,
      })),
    })
  })
}
