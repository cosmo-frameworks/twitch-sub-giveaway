import { sql } from 'drizzle-orm'

import type { Db } from '../client.js'
import { participants } from '../schema.js'

export interface ParticipantInput {
  platform: string
  userId: string
  login: string
  displayName: string
  seenAt: string
}

/**
 * Da de alta al participante, o actualiza lo que puede haber cambiado.
 *
 * El `user_id` es lo único inmutable: en Twitch el login y el nombre para
 * mostrar se pueden cambiar. Por eso la clave es `(platform, user_id)` y el
 * resto se refresca en cada aparición.
 *
 * `first_seen_at` NO se toca: es el dato que dice desde cuándo participa.
 */
export function upsertParticipant(db: Db, input: ParticipantInput): void {
  db.insert(participants)
    .values({
      platform: input.platform,
      userId: input.userId,
      login: input.login,
      displayName: input.displayName,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
    })
    .onConflictDoUpdate({
      target: [participants.platform, participants.userId],
      set: {
        login: sql`excluded.login`,
        displayName: sql`excluded.display_name`,
        // Si llegara un evento antiguo (reconciliación), no se retrocede.
        lastSeenAt: sql`max(${participants.lastSeenAt}, excluded.last_seen_at)`,
      },
    })
    .run()
}
