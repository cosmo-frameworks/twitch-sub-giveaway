/**
 * A partir de aquí nadie sabe nada de Twurple ni de los payloads de Twitch.
 * Campos verificados en
 * https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types
 */

import type { TwitchTier } from '../config.js'

export type SubEventType =
  /** `channel.subscribe` — suscripción nueva (NO salta en renovaciones). */
  | 'sub'
  /** `channel.subscription.gift` */
  | 'gift'
  /** `channel.subscription.message` — renovación mensual. */
  | 'resub'

export interface SubEvent {
  /** `metadata.message_id` del sobre de EventSub: la clave para deduplicar. */
  messageId: string
  type: SubEventType
  /** `null` solo en regalos anónimos: Twitch no dice quién fue. */
  userId: string | null
  login: string | null
  displayName: string | null
  tier: TwitchTier
  /** En `type: 'sub'`, si la suscripción fue un regalo recibido. */
  isGift: boolean
  /** Número de subs regalados. Solo en `type: 'gift'`. */
  total: number | null
  isAnonymous: boolean
  occurredAt: Date
}

/*
 * Estructurales en vez de importar las clases de Twurple: sus objetos encajan
 * igual, y los tests pueden construir casos con objetos planos.
 */

export interface RawSubscribeEvent {
  userId: string
  userName: string
  userDisplayName: string
  tier: TwitchTier
  isGift: boolean
}

export interface RawGiftEvent {
  /** `null` si `isAnonymous`. */
  gifterId: string | null
  gifterName: string | null
  gifterDisplayName: string | null
  /** `total` en el payload de Twitch: cuántos subs se regalaron de golpe. */
  amount: number
  tier: TwitchTier
  isAnonymous: boolean
}

export interface RawResubEvent {
  userId: string
  userName: string
  userDisplayName: string
  tier: TwitchTier
  cumulativeMonths: number
}

/**
 * `channel.subscribe`.
 *
 * `isGift` se conserva tal cual y NO se descarta aquí: decidir qué hacer con un
 * sub regalado es cosa del motor de reglas (fase 4), no de la normalización.
 */
export function normalizeSubscribe(
  event: RawSubscribeEvent,
  messageId: string,
  occurredAt: Date,
): SubEvent {
  return {
    messageId,
    type: 'sub',
    userId: event.userId,
    login: event.userName,
    displayName: event.userDisplayName,
    tier: event.tier,
    isGift: event.isGift,
    total: null,
    isAnonymous: false,
    occurredAt,
  }
}

/**
 * `channel.subscription.gift`.
 *
 * Quien figura como usuario es el REGALADOR. Este evento no dice quién recibió
 * los subs (trampa 4 de la sección 6) y no se intenta averiguar.
 */
export function normalizeGift(
  event: RawGiftEvent,
  messageId: string,
  occurredAt: Date,
): SubEvent {
  return {
    messageId,
    type: 'gift',
    userId: event.gifterId,
    login: event.gifterName,
    displayName: event.gifterDisplayName,
    tier: event.tier,
    isGift: true,
    total: event.amount,
    isAnonymous: event.isAnonymous,
    occurredAt,
  }
}

/**
 * `channel.subscription.message` — la renovación mensual.
 *
 * Es el único evento que avisa de un resub: `channel.subscribe` no salta en las
 * renovaciones (trampa 3 de la sección 6).
 */
export function normalizeResub(
  event: RawResubEvent,
  messageId: string,
  occurredAt: Date,
): SubEvent {
  return {
    messageId,
    type: 'resub',
    userId: event.userId,
    login: event.userName,
    displayName: event.userDisplayName,
    tier: event.tier,
    isGift: false,
    total: null,
    isAnonymous: false,
    occurredAt,
  }
}

const TIER_LABEL: Record<TwitchTier, string> = {
  '1000': 'T1',
  '2000': 'T2',
  '3000': 'T3',
}

/** Una línea legible para el log. El `messageId` va siempre visible. */
export function formatSubEvent(event: SubEvent): string {
  const who = event.isAnonymous ? '(anónimo)' : (event.displayName ?? event.login ?? '(desconocido)')

  const what =
    event.type === 'gift'
      ? `regala x${event.total ?? '?'}`
      : event.type === 'resub'
        ? 'renueva'
        : event.isGift
          ? 'recibe sub regalado'
          : 'se suscribe'

  const stamp = event.occurredAt.toISOString().slice(11, 19)

  return `[${stamp}] ${event.type.padEnd(5)} ${TIER_LABEL[event.tier]} ${who} ${what}  · ${event.messageId}`
}
