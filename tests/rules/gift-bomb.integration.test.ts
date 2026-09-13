/**
 * Criterio de aceptación de la fase 4, extremo a extremo.
 *
 * `apply.test.ts` prueba la función pura. Esto prueba la cadena entera —
 * listener de Twurple → normalización → reglas → SQLite real — porque el doble
 * conteo del gift bomb (§6.2) es un fallo de integración, no de una función
 * suelta: cada pieza puede estar bien y aun así acabar con papeletas de más.
 *
 * Se empujan payloads reales de EventSub por el listener de Twurple, sin red.
 */

import type { ApiClient } from '@twurple/api'
import type { EventSubWsListener } from '@twurple/eventsub-ws'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_ENTRY_RULES } from '../../src/config.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent } from '../../src/db/process-event.js'
import { tallyByParticipant } from '../../src/db/repositories/entries.js'
import { createGiveaway } from '../../src/db/repositories/giveaways.js'
import { MessageIdCapturingListener, SubEventListener } from '../../src/twitch/listener.js'
import { applyRules } from '../../src/rules/apply.js'

type Subscription = ReturnType<EventSubWsListener['onChannelSubscription']>

const BROADCASTER = {
  broadcaster_user_id: '123456',
  broadcaster_user_login: 'elstreamer',
  broadcaster_user_name: 'ElStreamer',
}

class TestListener extends MessageIdCapturingListener {
  readonly subs = new Map<string, Subscription>()
  override start(): void {}
  override stop(): void {}
  override onChannelSubscription(
    ...a: Parameters<EventSubWsListener['onChannelSubscription']>
  ): Subscription {
    const s = super.onChannelSubscription(...a)
    this.subs.set('sub', s)
    return s
  }
  override onChannelSubscriptionGift(
    ...a: Parameters<EventSubWsListener['onChannelSubscriptionGift']>
  ): Subscription {
    const s = super.onChannelSubscriptionGift(...a)
    this.subs.set('gift', s)
    return s
  }
  override onChannelSubscriptionMessage(
    ...a: Parameters<EventSubWsListener['onChannelSubscriptionMessage']>
  ): Subscription {
    const s = super.onChannelSubscriptionMessage(...a)
    this.subs.set('resub', s)
    return s
  }
}

let handle: DbHandle
let giveawayId: string
let inner: TestListener

beforeEach(() => {
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id

  const listener = new SubEventListener({
    apiClient: {} as ApiClient,
    broadcasterId: '123456',
    createListener: (c) => (inner = new TestListener(c)),
    // El mismo cableado que index.ts: reglas → persistencia.
    onEvent: (event) => {
      processEvent(handle.db, {
        giveawayId,
        event,
        drafts: applyRules(event, DEFAULT_ENTRY_RULES),
      })
    },
  })
  listener.start()
})

function deliver(kind: 'sub' | 'gift' | 'resub', payload: object, messageId: string): void {
  const subscription = inner.subs.get(kind)
  if (!subscription) throw new Error(`sin suscripción para ${kind}`)
  inner._handleSingleEventPayload(subscription, payload as Record<string, unknown>, messageId)
}

const tally = (): Record<string, number> =>
  Object.fromEntries(tallyByParticipant(handle.db, giveawayId).map((t) => [t.userId, t.entries]))

describe('criterio de aceptación fase 4 · gift bomb de 5 por el stack completo', () => {
  /**
   * Twitch dispara, para un regalo de 5 subs:
   *   1 × channel.subscription.gift  (total: 5, el regalador)
   *   5 × channel.subscribe          (is_gift: true, un receptor cada uno)
   * Sumar ambos duplicaría el regalo.
   */
  it('5 papeletas al regalador y 0 a los receptores, con los 6 eventos', () => {
    deliver(
      'gift',
      {
        ...BROADCASTER,
        user_id: '222',
        user_login: 'generosa',
        user_name: 'Generosa',
        total: 5,
        tier: '2000',
        cumulative_total: 40,
        is_anonymous: false,
      },
      'msg-gift',
    )

    for (let i = 0; i < 5; i++) {
      deliver(
        'sub',
        {
          ...BROADCASTER,
          user_id: `90${i}`,
          user_login: `recept${i}`,
          user_name: `Receptor${i}`,
          tier: '2000',
          is_gift: true,
        },
        `msg-sub-${i}`,
      )
    }

    expect(tally()).toEqual({ '222': 5 })
  })

  it('los 6 eventos quedan registrados como procesados, incluidos los que no dan papeletas', () => {
    deliver(
      'gift',
      {
        ...BROADCASTER,
        user_id: '222',
        user_login: 'generosa',
        user_name: 'Generosa',
        total: 5,
        tier: '2000',
        cumulative_total: 40,
        is_anonymous: false,
      },
      'msg-gift',
    )
    for (let i = 0; i < 5; i++) {
      deliver(
        'sub',
        { ...BROADCASTER, user_id: `90${i}`, user_login: `r${i}`, user_name: `R${i}`, tier: '2000', is_gift: true },
        `msg-sub-${i}`,
      )
    }

    const processed = handle.sqlite
      .prepare('select count(*) as n from processed_events')
      .get() as { n: number }

    expect(processed.n).toBe(6)
  })
})

describe('un directo entero, mezclando eventos', () => {
  it('cuadra el recuento por participante', () => {
    // Sub nuevo.
    deliver(
      'sub',
      { ...BROADCASTER, user_id: '111', user_login: 'pepito', user_name: 'Pepito', tier: '1000', is_gift: false },
      'm1',
    )
    // Resub.
    deliver(
      'resub',
      {
        ...BROADCASTER,
        user_id: '333',
        user_login: 'fiel',
        user_name: 'Fiel',
        tier: '3000',
        message: { text: '12 meses', emotes: [] },
        cumulative_months: 12,
        streak_months: 3,
        duration_months: 1,
      },
      'm2',
    )
    // Gift bomb de 3 + sus 3 receptores.
    deliver(
      'gift',
      { ...BROADCASTER, user_id: '222', user_login: 'generosa', user_name: 'Generosa', total: 3, tier: '1000', cumulative_total: 3, is_anonymous: false },
      'm3',
    )
    for (let i = 0; i < 3; i++) {
      deliver(
        'sub',
        { ...BROADCASTER, user_id: `80${i}`, user_login: `g${i}`, user_name: `G${i}`, tier: '1000', is_gift: true },
        `m4-${i}`,
      )
    }
    // Regalo anónimo: se descarta.
    deliver(
      'gift',
      { ...BROADCASTER, user_id: null, user_login: null, user_name: null, total: 10, tier: '1000', cumulative_total: null, is_anonymous: true },
      'm5',
    )
    // Reenvío del sub de pepito.
    deliver(
      'sub',
      { ...BROADCASTER, user_id: '111', user_login: 'pepito', user_name: 'Pepito', tier: '1000', is_gift: false },
      'm1',
    )

    expect(tally()).toEqual({
      '111': 1, // sub nuevo, el reenvío no cuenta
      '333': 1, // resub
      '222': 3, // gift bomb de 3
      // receptores y anónimo: nada
    })
  })
})
