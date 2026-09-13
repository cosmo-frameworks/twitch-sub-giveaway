/**
 * Criterio de aceptación de la fase 6: la fila aparece en el panel en menos de
 * un segundo, sin refrescar.
 *
 * Se mide la cadena entera tal y como corre en producción — listener de Twurple
 * → normalización → reglas → SQLite → bus de eventos → WebSocket → cliente —
 * sobre un servidor Fastify de verdad escuchando en un puerto real.
 *
 * Lo único que no interviene es el socket de Twitch: los payloads se empujan
 * por el listener igual que haría el mock del Twitch CLI.
 */

import type { AddressInfo } from 'node:net'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ApiClient } from '@twurple/api'
import type { EventSubWsListener } from '@twurple/eventsub-ws'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthStatus } from '../../src/auth/status.js'
import { DEFAULT_ENTRY_RULES, parseConfig } from '../../src/config.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent } from '../../src/db/process-event.js'
import { entriesByParticipant, giveawayTotals } from '../../src/db/repositories/entries.js'
import { createGiveaway } from '../../src/db/repositories/giveaways.js'
import { applyRules } from '../../src/rules/apply.js'
import { MessageIdCapturingListener, SubEventListener } from '../../src/twitch/listener.js'
import { PanelEvents } from '../../src/api/events.js'
import { createApiServer } from '../../src/api/server.js'

type Subscription = ReturnType<EventSubWsListener['onChannelSubscription']>

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

const BROADCASTER = {
  broadcaster_user_id: '123456',
  broadcaster_user_login: 'elstreamer',
  broadcaster_user_name: 'ElStreamer',
}

let handle: DbHandle
let app: FastifyInstance
let events: PanelEvents
let giveawayId: string
let inner: TestListener
let port: number

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'twitch-stream-'))
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id

  const config = parseConfig(
    {
      TWITCH_CLIENT_ID: 'client-id',
      TWITCH_CLIENT_SECRET: 'secret',
      TWITCH_BROADCASTER_LOGIN: 'elstreamer',
    },
    { defaultDataDir: dataDir },
  )

  events = new PanelEvents()
  const authStatus = new AuthStatus()
  authStatus.set('ok', 'token válido')

  app = await createApiServer({
    db: handle.db,
    config,
    authStatus,
    events,
    activeGiveawayId: () => giveawayId,
    eventSubConnected: () => true,
    panelDist: null,
  })

  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port

  // Mismo cableado que index.ts: reglas → persistencia → bus de eventos.
  const listener = new SubEventListener({
    apiClient: {} as ApiClient,
    broadcasterId: '123456',
    createListener: (c) => (inner = new TestListener(c)),
    onEvent: (event) => {
      const drafts = applyRules(event, DEFAULT_ENTRY_RULES)
      const result = processEvent(handle.db, { giveawayId, event, drafts })
      if (result.status !== 'inserted') return

      const first = drafts[0]
      if (!first) return
      const row = entriesByParticipant(handle.db, giveawayId).find(
        (p) => p.platform === first.platform && p.userId === first.userId,
      )
      if (!row) return

      events.publish({
        type: 'entry.added',
        giveawayId,
        participant: row,
        added: result.entriesInserted,
        totals: giveawayTotals(handle.db, giveawayId),
      })
    },
  })
  listener.start()
})

afterEach(async () => {
  await app.close()
  handle.close()
})

/** Abre el stream y espera a que llegue un evento del tipo pedido. */
async function openStream(): Promise<{
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>
  close: () => void
}> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/giveaways/${giveawayId}/stream`)
  const received: Array<Record<string, unknown>> = []
  const waiters: Array<(event: Record<string, unknown>) => void> = []

  socket.addEventListener('message', (message) => {
    const event = JSON.parse(String((message as { data: unknown }).data)) as Record<string, unknown>
    received.push(event)
    for (const waiter of [...waiters]) waiter(event)
  })

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve())
    socket.addEventListener('error', () => reject(new Error('no se pudo abrir el stream')))
  })

  const waitFor = async (type: string, timeoutMs = 3000): Promise<Record<string, unknown>> => {
    const already = received.find((e) => e.type === type)
    if (already) return already

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no llegó ningún "${type}"`)), timeoutMs)
      const waiter = (event: Record<string, unknown>): void => {
        if (event.type !== type) return
        clearTimeout(timer)
        waiters.splice(waiters.indexOf(waiter), 1)
        resolve(event)
      }
      waiters.push(waiter)
    })
  }

  return { waitFor, close: () => socket.close() }
}

function deliver(kind: 'sub' | 'gift' | 'resub', payload: object, messageId: string): void {
  const subscription = inner.subs.get(kind)
  if (!subscription) throw new Error(`sin suscripción para ${kind}`)
  inner._handleSingleEventPayload(subscription, payload as Record<string, unknown>, messageId)
}

describe('criterio de aceptación fase 6 · la fila llega al panel en menos de un segundo', () => {
  it('un sub nuevo llega por el stream sin que el panel refresque', async () => {
    const stream = await openStream()

    const started = Date.now()
    deliver(
      'sub',
      { ...BROADCASTER, user_id: '111', user_login: 'pepito', user_name: 'Pepito', tier: '1000', is_gift: false },
      'msg-1',
    )

    const event = await stream.waitFor('entry.added')
    const elapsed = Date.now() - started

    expect(elapsed).toBeLessThan(1000)
    expect(event).toMatchObject({
      type: 'entry.added',
      giveawayId,
      added: 1,
      participant: { userId: '111', displayName: 'Pepito', entries: 1 },
      totals: { entries: 1, participants: 1 },
    })

    stream.close()
  })

  it('un gift bomb de 20 llega como UNA fila ya agregada, no veinte mensajes', async () => {
    const stream = await openStream()

    const started = Date.now()
    deliver(
      'gift',
      {
        ...BROADCASTER,
        user_id: '222',
        user_login: 'generosa',
        user_name: 'Generosa',
        total: 20,
        tier: '2000',
        cumulative_total: 20,
        is_anonymous: false,
      },
      'msg-gift',
    )

    const event = await stream.waitFor('entry.added')

    expect(Date.now() - started).toBeLessThan(1000)
    expect(event).toMatchObject({
      added: 20,
      participant: { userId: '222', entries: 20 },
      totals: { entries: 20, participants: 1 },
    })

    stream.close()
  })

  it('el estado inicial llega nada más conectar, sin pedir nada', async () => {
    const stream = await openStream()

    const auth = await stream.waitFor('auth.status')
    const eventSub = await stream.waitFor('eventsub.status')

    expect(auth).toMatchObject({ state: 'ok' })
    expect(eventSub).toMatchObject({ connected: true })

    stream.close()
  })

  it('los eventos sin papeletas no ensucian el panel', async () => {
    const stream = await openStream()

    // Sub regalado: por reglas no da papeleta al receptor.
    deliver(
      'sub',
      { ...BROADCASTER, user_id: '900', user_login: 'r', user_name: 'R', tier: '2000', is_gift: true },
      'msg-gifted',
    )
    // Y ahora uno que sí.
    deliver(
      'sub',
      { ...BROADCASTER, user_id: '111', user_login: 'pepito', user_name: 'Pepito', tier: '1000', is_gift: false },
      'msg-real',
    )

    const event = await stream.waitFor('entry.added')
    expect(event).toMatchObject({ participant: { userId: '111' } })

    stream.close()
  })

  it('varios paneles abiertos reciben el mismo evento', async () => {
    const uno = await openStream()
    const dos = await openStream()

    deliver(
      'sub',
      { ...BROADCASTER, user_id: '111', user_login: 'pepito', user_name: 'Pepito', tier: '1000', is_gift: false },
      'msg-1',
    )

    await expect(uno.waitFor('entry.added')).resolves.toMatchObject({ added: 1 })
    await expect(dos.waitFor('entry.added')).resolves.toMatchObject({ added: 1 })

    uno.close()
    dos.close()
  })

  it('el snapshot inicial de la API coincide con lo que llega por el stream', async () => {
    const stream = await openStream()

    deliver(
      'gift',
      {
        ...BROADCASTER,
        user_id: '222',
        user_login: 'generosa',
        user_name: 'Generosa',
        total: 3,
        tier: '1000',
        cumulative_total: 3,
        is_anonymous: false,
      },
      'msg-gift',
    )
    await stream.waitFor('entry.added')

    // Un panel que se abra ahora tiene que ver lo mismo.
    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/entries` })
    const body = res.json() as { participants: Array<{ userId: string; entries: number }> }

    expect(body.participants).toEqual([expect.objectContaining({ userId: '222', entries: 3 })])

    stream.close()
  })
})
