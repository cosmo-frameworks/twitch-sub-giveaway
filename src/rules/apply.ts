/**
 * Pura: entra un evento normalizado y salen sus papeletas. Sin base de datos,
 * sin red, sin reloj. Es lo único que hay que releer cuando alguien pregunte
 * por qué fulano tiene 20 papeletas.
 */

import type { EntryRules } from '../config.js'
import type { EntryDraft } from '../db/process-event.js'
import { PLATFORM_TWITCH } from '../db/schema.js'
import type { SubEvent } from '../twitch/normalize.js'

/**
 * `total` viene de Twitch y no lo controlamos: un valor absurdo no puede
 * traducirse en millones de inserciones en mitad de un directo.
 */
export const MAX_ENTRIES_PER_EVENT = 1000

const ANONYMOUS_DISPLAY_NAME = 'Anónimo'

export function applyRules(event: SubEvent, rules: EntryRules): EntryDraft[] {
  switch (event.type) {
    case 'sub':
      // En un gift bomb Twitch manda un `channel.subscribe` con `is_gift` por
      // CADA receptor, además del `gift` con el total: si el receptor entrara
      // por defecto, cada regalo contaría dos veces.
      return event.isGift
        ? draftsFor(event, rules, rules.giftReceived.entries, 'gift_received')
        : draftsFor(event, rules, rules.sub.entries, 'sub')

    case 'resub':
      return draftsFor(event, rules, rules.resub.entries, 'resub')

    case 'gift':
      return giftDrafts(event, rules)
  }
}

/**
 * Entra el REGALADOR. El evento no dice quién recibió los subs, solo cuántos,
 * y no se intenta correlacionar con los `channel.subscribe`.
 */
function giftDrafts(event: SubEvent, rules: EntryRules): EntryDraft[] {
  const count =
    rules.giftSent.mode === 'fixed'
      ? rules.giftSent.entries
      : (event.total ?? 0) * rules.giftSent.entries

  if (!event.isAnonymous) {
    return draftsFor(event, rules, count, 'gift_sent')
  }

  // Con `is_anonymous`, Twitch manda el regalador a null: no hay a quién premiar.
  if (rules.anonymousGift === 'ignore') return []

  return repeat(count, (giftIndex) => ({
    platform: PLATFORM_TWITCH,
    userId: rules.anonymousBucketUserId,
    login: rules.anonymousBucketUserId,
    displayName: ANONYMOUS_DISPLAY_NAME,
    source: 'gift_sent',
    tier: event.tier,
    weight: rules.tierWeights[event.tier],
    giftIndex,
  }))
}

function draftsFor(
  event: SubEvent,
  rules: EntryRules,
  count: number,
  source: EntryDraft['source'],
): EntryDraft[] {
  // Sin `userId` la clave ajena a `participants` rechazaría la fila. Solo pasa
  // en regalos anónimos, que van aparte; aquí es defensa.
  const userId = event.userId
  if (!userId) return []

  const login = event.login ?? userId

  return repeat(count, (giftIndex) => ({
    platform: PLATFORM_TWITCH,
    userId,
    login,
    displayName: event.displayName ?? login,
    source,
    tier: event.tier,
    weight: rules.tierWeights[event.tier],
    giftIndex,
  }))
}

function repeat(count: number, build: (giftIndex: number) => EntryDraft): EntryDraft[] {
  const total = Math.max(0, Math.min(MAX_ENTRIES_PER_EVENT, Math.floor(count)))
  return Array.from({ length: total }, (_, i) => build(i))
}
