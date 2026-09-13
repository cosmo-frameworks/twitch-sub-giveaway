import { eq } from 'drizzle-orm'

import type { Db } from '../client.js'
import { processedEvents } from '../schema.js'

/** Twurple deduplica en memoria 10 minutos; esto sobrevive a un reinicio. */
export function isProcessed(db: Db, messageId: string): boolean {
  return (
    db
      .select({ messageId: processedEvents.messageId })
      .from(processedEvents)
      .where(eq(processedEvents.messageId, messageId))
      .get() !== undefined
  )
}

export function markProcessed(
  db: Db,
  input: { messageId: string; type: string; receivedAt: string },
): void {
  db.insert(processedEvents)
    .values({
      messageId: input.messageId,
      type: input.type,
      receivedAt: input.receivedAt,
    })
    .run()
}
