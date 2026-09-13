/**
 * Estos tests empujan payloads REALES de EventSub por el listener de Twurple,
 * sin red: se llama a `_handleSingleEventPayload` igual que lo haría el socket,
 * y Twurple hace su transformación de verdad.
 *
 * Lo que se comprueba de fondo es que el `message_id` del sobre llega hasta el
 * `SubEvent`. Twurple lo consume para su deduplicación interna y no lo expone,
 * así que dependemos de API interna suya: si una actualización cambia cómo
 * entrega los eventos, estos tests lo cazan.
 *
 * Payloads tomados de:
 * https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types
 */

import type { ApiClient } from '@twurple/api'
import type { EventSubWsListener } from '@twurple/eventsub-ws'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MISSING_MESSAGE_ID_PREFIX, MessageIdCapturingListener, SubEventListener } from '../../src/twitch/listener.js'
import type { SubEvent } from '../../src/twitch/normalize.js'

type Subscription = ReturnType<EventSubWsListener['onChannelSubscription']>

const BROADCASTER = {
  broadcaster_user_id: '123456',
  broadcaster_user_login: 'elstreamer',
  broadcaster_user_name: 'ElStreamer',
}

const SUBSCRIBE_PAYLOAD = {
  ...BROADCASTER,
  user_id: '111',
  user_login: 'pepito',
  user_name: 'Pepito',
  tier: '1000',
  is_gift: false,
}

const GIFT_PAYLOAD = {
  ...BROADCASTER,
  user_id: '222',
  user_login: 'generosa',
  user_name: 'Generosa',
  total: 5,
  tier: '2000',
  cumulative_total: 40,
  is_anonymous: false,
}

const RESUB_PAYLOAD = {
  ...BROADCASTER,
  user_id: '333',
  user_login: 'fiel',
  user_name: 'Fiel',
  tier: '3000',
  message: { text: '¡12 meses!', emotes: [] },
  cumulative_months: 12,
  streak_months: 3,
  duration_months: 1,
}

const at = new Date('2026-09-13T20:30:00.000Z')

/** Listener de Twurple real, pero sin abrir el WebSocket. */
class TestListener extends MessageIdCapturingListener {
  readonly subs = new Map<string, Subscription>()

  override start(): void {
    /* sin socket */
  }
  override stop(): void {
    /* sin socket */
  }

  override onChannelSubscription(
    ...args: Parameters<EventSubWsListener['onChannelSubscription']>
  ): Subscription {
    const sub = super.onChannelSubscription(...args)
    this.subs.set('sub', sub)
    return sub
  }

  override onChannelSubscriptionGift(
    ...args: Parameters<EventSubWsListener['onChannelSubscriptionGift']>
  ): Subscription {
    const sub = super.onChannelSubscriptionGift(...args)
    this.subs.set('gift', sub)
    return sub
  }

  override onChannelSubscriptionMessage(
    ...args: Parameters<EventSubWsListener['onChannelSubscriptionMessage']>
  ): Subscription {
    const sub = super.onChannelSubscriptionMessage(...args)
    this.subs.set('resub', sub)
    return sub
  }
}

let inner: TestListener
let received: SubEvent[]
let missing: SubEvent[]
let revoked: string[]
let connects: number
let disconnects: (Error | undefined)[]
let listener: SubEventListener

beforeEach(() => {
  received = []
  missing = []
  revoked = []
  connects = 0
  disconnects = []

  listener = new SubEventListener({
    apiClient: {} as ApiClient,
    broadcasterId: '123456',
    now: () => at,
    createListener: (config) => (inner = new TestListener(config)),
    onEvent: (e) => received.push(e),
    onMissingMessageId: (e) => missing.push(e),
    onRevoke: (d) => revoked.push(d),
    onConnect: () => connects++,
    onDisconnect: (e) => disconnects.push(e),
  })
  listener.start()
})

/** Entrega un evento como lo haría el socket de EventSub. */
function deliver(kind: 'sub' | 'gift' | 'resub', payload: object, messageId: string): void {
  const subscription = inner.subs.get(kind)
  if (!subscription) throw new Error(`no hay suscripción para ${kind}`)
  inner._handleSingleEventPayload(subscription, payload as Record<string, unknown>, messageId)
}

describe('SubEventListener — se suscribe a los tres eventos', () => {
  /** Sin `channel.subscription.message` se pierden todos los resubs (trampa 3). */
  it('da de alta subscribe, gift y message', () => {
    expect([...inner.subs.keys()].sort()).toEqual(['gift', 'resub', 'sub'])
  })

  it('no vuelve a suscribirse si se arranca dos veces', () => {
    listener.start()
    expect(inner.subs.size).toBe(3)
  })
})

describe('SubEventListener — normaliza lo que llega del socket', () => {
  // Criterio de aceptación de la fase 2: el messageId tiene que llegar.
  it('lleva el message_id del sobre hasta el SubEvent', () => {
    deliver('sub', SUBSCRIBE_PAYLOAD, 'msg-sub-001')

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      messageId: 'msg-sub-001',
      type: 'sub',
      userId: '111',
      login: 'pepito',
      displayName: 'Pepito',
      tier: '1000',
      isGift: false,
      total: null,
      isAnonymous: false,
      occurredAt: at,
    })
    expect(missing).toHaveLength(0)
  })

  it('normaliza un gift bomb con su total y su regalador', () => {
    deliver('gift', { ...GIFT_PAYLOAD, total: 20 }, 'msg-gift-002')

    expect(received[0]).toMatchObject({
      messageId: 'msg-gift-002',
      type: 'gift',
      userId: '222',
      displayName: 'Generosa',
      total: 20,
      tier: '2000',
      isAnonymous: false,
    })
  })

  it('normaliza un regalo anónimo sin inventarse un regalador', () => {
    deliver(
      'gift',
      { ...GIFT_PAYLOAD, user_id: null, user_login: null, user_name: null, is_anonymous: true, cumulative_total: null },
      'msg-gift-003',
    )

    expect(received[0]).toMatchObject({
      messageId: 'msg-gift-003',
      type: 'gift',
      userId: null,
      login: null,
      displayName: null,
      isAnonymous: true,
      total: 5,
    })
  })

  it('normaliza un resub', () => {
    deliver('resub', RESUB_PAYLOAD, 'msg-resub-004')

    expect(received[0]).toMatchObject({
      messageId: 'msg-resub-004',
      type: 'resub',
      userId: '333',
      displayName: 'Fiel',
      tier: '3000',
      isGift: false,
    })
  })

  /**
   * Trampa 2: un gift bomb de 5 dispara 1 `channel.subscription.gift` y 5
   * `channel.subscribe` con `is_gift: true`. El listener los entrega todos,
   * cada uno con su propio message_id; filtrarlos es cosa de la fase 4.
   */
  it('entrega los subscribe regalados además del gift, cada uno con su id', () => {
    deliver('gift', GIFT_PAYLOAD, 'msg-gift')
    for (let i = 0; i < 5; i++) {
      deliver('sub', { ...SUBSCRIBE_PAYLOAD, user_id: `90${i}`, is_gift: true }, `msg-sub-${i}`)
    }

    expect(received).toHaveLength(6)
    expect(received.map((e) => e.messageId)).toEqual([
      'msg-gift',
      'msg-sub-0',
      'msg-sub-1',
      'msg-sub-2',
      'msg-sub-3',
      'msg-sub-4',
    ])
    expect(received.filter((e) => e.type === 'sub').every((e) => e.isGift)).toBe(true)
  })

  /** Twurple filtra reenvíos del mismo message_id durante 10 minutos. */
  it('no entrega dos veces el mismo message_id', () => {
    deliver('sub', SUBSCRIBE_PAYLOAD, 'msg-repetido')
    deliver('sub', SUBSCRIBE_PAYLOAD, 'msg-repetido')

    expect(received).toHaveLength(1)
  })

  it('limpia el message_id en curso después de entregar', () => {
    deliver('sub', SUBSCRIBE_PAYLOAD, 'msg-x')
    expect(inner.currentMessageId).toBeUndefined()
  })
})

describe('SubEventListener — si la captura del message_id fallara', () => {
  /**
   * Simula que Twurple deja de entregar el evento de forma síncrona. Preferimos
   * un id sintético y un aviso antes que perder un sub en directo.
   */
  it('genera un id sintético y avisa', async () => {
    const subscription = inner.subs.get('sub')
    if (!subscription) throw new Error('sin suscripción')

    // Se salta el wrapper: `currentMessageId` nunca llega a fijarse.
    await subscription._handleData(SUBSCRIBE_PAYLOAD as unknown as Record<string, unknown>)

    expect(received).toHaveLength(1)
    expect(received[0]?.messageId).toMatch(new RegExp(`^${MISSING_MESSAGE_ID_PREFIX}`))
    expect(missing).toHaveLength(1)
  })
})

describe('SubEventListener — alta de suscripciones', () => {
  /**
   * Sin este handler, un alta fallida deja el socket conectado pero mudo para
   * ese evento y no se entera nadie.
   */
  it('avisa si una suscripción no se puede dar de alta', () => {
    const failures: Array<[string, string]> = []
    const local = new SubEventListener({
      apiClient: {} as ApiClient,
      broadcasterId: '123456',
      createListener: (c) => (inner = new TestListener(c)),
      onEvent: () => undefined,
      onSubscriptionFailed: (type, error) => failures.push([type, error.message]),
    })
    local.start()

    const emitter = inner as unknown as { emit: (event: unknown, ...args: unknown[]) => void }
    emitter.emit(
      inner.onSubscriptionCreateFailure,
      { id: 'channel.subscribe.123456' },
      new Error('401 Unauthorized'),
    )

    expect(failures).toEqual([['channel.subscribe.123456', '401 Unauthorized']])
  })

  it('informa del alta y deja el comando del CLI a null fuera del mock', async () => {
    const ready: Array<{ type: string; cliCommand: string | null }> = []
    const local = new SubEventListener({
      apiClient: {} as ApiClient,
      broadcasterId: '123456',
      createListener: (c) => (inner = new TestListener(c)),
      onEvent: () => undefined,
      onSubscriptionReady: (info) => ready.push(info),
    })
    local.start()

    const subscription = inner.subs.get('sub')
    const emitter = inner as unknown as { emit: (event: unknown, ...args: unknown[]) => void }
    emitter.emit(inner.onSubscriptionCreateSuccess, subscription, {})

    await vi.waitFor(() => expect(ready).toHaveLength(1))
    // Sin TWURPLE_MOCK_API_PORT, Twurple no genera comando: no es un error.
    expect(ready[0]?.cliCommand).toBeNull()
  })
})

describe('SubEventListener — handlers de conexión', () => {
  it('registra onConnect, onDisconnect y onRevoke', () => {
    const emitter = inner as unknown as { emit: (event: unknown, ...args: unknown[]) => void }

    emitter.emit(inner.onUserSocketConnect, '123456')
    expect(connects).toBe(1)

    const boom = new Error('socket caído')
    emitter.emit(inner.onUserSocketDisconnect, '123456', boom)
    expect(disconnects).toEqual([boom])

    emitter.emit(inner.onRevoke, { id: 'sub-1' }, 'authorization_revoked')
    expect(revoked).toEqual(['sub-1 (authorization_revoked)'])
  })
})
