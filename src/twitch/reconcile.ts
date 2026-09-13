/**
 * EventSub NO reenvía lo que pasó mientras el proceso estuvo caído: si se
 * reinicia el ordenador en mitad de un directo, esos subs no vuelven a llegar.
 * Esto los recupera preguntando quién está suscrito ahora mismo.
 *
 * Lo que NO puede recuperar:
 *
 * `GET /helix/subscriptions` dice quién está suscrito HOY, no cuándo empezó.
 * Para un sub normal da igual: o está en la lista del sorteo o no está.
 *
 * Con los regalos es distinto. La respuesta trae `gifter_id`, pero no hay forma
 * de saber si ese regalo fue durante la caída o hace ocho meses. Contar
 * papeletas por `gifter_id` daría al regalador crédito por todos sus regalos
 * históricos, que es mucho peor que quedarse corto. Así que un gift bomb caído
 * durante una desconexión se pierde para el regalador, y se avisa en el log.
 */

import type { ApiClient } from '@twurple/api'

import type { EntryRules } from '../config.js'
import type { Db } from '../db/client.js'
import { insertEntries } from '../db/repositories/entries.js'
import { upsertParticipant } from '../db/repositories/participants.js'
import { entries, PLATFORM_TWITCH, type Entry } from '../db/schema.js'
import { eq } from 'drizzle-orm'

export interface CurrentSubscriber {
  userId: string
  userName: string
  userDisplayName: string
  tier: string
  isGift: boolean
  gifterId: string | null
}

export type FetchSubscribers = () => Promise<CurrentSubscriber[]>

export function helixSubscribers(apiClient: ApiClient, broadcasterId: string): FetchSubscribers {
  return async () => {
    // `getAll()` recorre todas las páginas. El rate limit de Helix es de 800
    // puntos/minuto y esto se llama al arrancar y al reconectar, no en bucle.
    const all = await apiClient.subscriptions.getSubscriptionsPaginated(broadcasterId).getAll()

    return all.map((s) => ({
      userId: s.userId,
      userName: s.userName,
      userDisplayName: s.userDisplayName,
      tier: s.tier,
      isGift: s.isGift,
      gifterId: s.gifterId,
    }))
  }
}

export interface ReconcileResult {
  /** Suscriptores que devolvió Twitch (sin contar al propio streamer). */
  subscribers: number
  entriesAdded: number
  participantsAdded: number
  /** Ya tenían papeletas en este sorteo: llegaron por evento en directo. */
  alreadyHadEntries: number
  /** Subs que por reglas no dan papeleta (regalados, con `giftReceived: 0`). */
  skippedByRules: number
  /** Regalos cuyo regalador no se puede acreditar. Ver la nota de arriba. */
  giftersNotCredited: number
}

export interface ReconcileOptions {
  db: Db
  giveawayId: string
  /** Para excluir al propio streamer, que aparece en su lista de subs. */
  broadcasterId: string
  rules: EntryRules
  fetchSubscribers: FetchSubscribers
  now?: () => Date
}

/**
 * Da de alta a los subs actuales que todavía no tienen papeletas en el sorteo.
 *
 * Es idempotente: correrla dos veces no añade nada la segunda vez. Aparte de la
 * comprobación en memoria, el índice `entries_reconciled_unique` lo garantiza a
 * nivel de base de datos.
 */
export async function reconcile(options: ReconcileOptions): Promise<ReconcileResult> {
  const { db, giveawayId, broadcasterId, rules } = options
  const at = (options.now ?? (() => new Date()))().toISOString()

  const all = await options.fetchSubscribers()
  // El streamer figura como suscriptor de sí mismo; no entra en su propio sorteo.
  const subscribers = all.filter((s) => s.userId !== broadcasterId)

  const result: ReconcileResult = {
    subscribers: subscribers.length,
    entriesAdded: 0,
    participantsAdded: 0,
    alreadyHadEntries: 0,
    skippedByRules: 0,
    giftersNotCredited: 0,
  }

  if (subscribers.length === 0) return result

  db.transaction((tx) => {
    // Quién tiene ya papeletas, en una sola consulta en vez de una por sub.
    const existing = new Set(
      tx
        .select({ platform: entries.platform, userId: entries.userId })
        .from(entries)
        .where(eq(entries.giveawayId, giveawayId))
        .all()
        .map((r) => `${r.platform}:${r.userId}`),
    )

    for (const sub of subscribers) {
      if (sub.isGift) result.giftersNotCredited++

      if (existing.has(`${PLATFORM_TWITCH}:${sub.userId}`)) {
        result.alreadyHadEntries++
        continue
      }

      // Se aplican las MISMAS reglas que en directo: un sub regalado vale lo
      // que diga `giftReceived` (0 por defecto), no lo que valdría un sub
      // normal. Si no, reconciliar contradiría al motor de reglas.
      const { count, source } = sub.isGift
        ? { count: rules.giftReceived.entries, source: 'gift_received' as const }
        : { count: rules.sub.entries, source: 'sub' as const }

      if (count === 0) {
        result.skippedByRules++
        continue
      }

      upsertParticipant(tx, {
        platform: PLATFORM_TWITCH,
        userId: sub.userId,
        login: sub.userName,
        displayName: sub.userDisplayName,
        seenAt: at,
      })
      result.participantsAdded++

      result.entriesAdded += insertEntries(tx, {
        giveawayId,
        // Sin `message_id`: esto no vino de ningún evento de EventSub.
        eventId: null,
        occurredAt: at,
        reconciled: true,
        rows: Array.from({ length: count }, (_, giftIndex) => ({
          platform: PLATFORM_TWITCH,
          userId: sub.userId,
          source: source as Entry['source'],
          tier: sub.tier,
          weight: weightForTier(rules, sub.tier),
          giftIndex,
        })),
      })

      existing.add(`${PLATFORM_TWITCH}:${sub.userId}`)
    }
  })

  return result
}

/** Helix devuelve `tier` como string libre; si no lo reconocemos, peso 1. */
function weightForTier(rules: EntryRules, tier: string): number {
  if (tier === '1000' || tier === '2000' || tier === '3000') return rules.tierWeights[tier]
  return 1
}

/** Resumen para el log, que el plan pide explícitamente. */
export function describeReconcile(result: ReconcileResult): string {
  const parts = [
    `${result.subscribers} subs en Twitch`,
    `+${result.entriesAdded} papeletas nuevas`,
    `${result.alreadyHadEntries} ya estaban`,
  ]
  if (result.skippedByRules > 0) parts.push(`${result.skippedByRules} sin papeleta por reglas`)
  return parts.join(', ')
}
