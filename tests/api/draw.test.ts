/**
 * El sorteo por la API, contra SQLite real.
 *
 * `draw.test.ts` prueba el algoritmo. Esto prueba lo que pasa alrededor: que la
 * semilla se guarda, que la tirada no se registra dos veces, y que la
 * verificación aguanta que sigan entrando papeletas después de sortear — que es
 * justo cuando alguien pregunta en el chat si el sorteo estaba amañado.
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthStatus } from '../../src/auth/status.js'
import { parseConfig } from '../../src/config.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent } from '../../src/db/process-event.js'
import { createGiveaway } from '../../src/db/repositories/giveaways.js'
import type { SubEvent } from '../../src/twitch/normalize.js'
import { PanelEvents } from '../../src/api/events.js'
import { createApiServer } from '../../src/api/server.js'

let handle: DbHandle
let app: FastifyInstance
let events: PanelEvents
let giveawayId: string

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'twitch-draw-'))
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id

  events = new PanelEvents()
  const authStatus = new AuthStatus()
  authStatus.set('ok', 'token válido')

  app = await createApiServer({
    db: handle.db,
    config: parseConfig(
      {
        TWITCH_CLIENT_ID: 'client-id',
        TWITCH_CLIENT_SECRET: 'secret',
        TWITCH_BROADCASTER_LOGIN: 'elstreamer',
      },
      { defaultDataDir: dataDir },
    ),
    authStatus,
    events,
    activeGiveawayId: () => giveawayId,
    eventSubConnected: () => true,
    panelDist: null,
  })
})

afterEach(async () => {
  await app.close()
  handle.close()
})

let messageCounter = 0

function addParticipant(userId: string, displayName: string, count: number, at?: string): void {
  const occurredAt = new Date(at ?? '2026-09-13T20:30:00.000Z')
  const event: SubEvent = {
    messageId: `msg-${messageCounter++}`,
    type: 'gift',
    userId,
    login: displayName.toLowerCase(),
    displayName,
    tier: '1000',
    isGift: true,
    total: count,
    isAnonymous: false,
    occurredAt,
  }
  processEvent(handle.db, {
    giveawayId,
    event,
    drafts: Array.from({ length: count }, (_, i) => ({
      platform: 'twitch',
      userId,
      login: displayName.toLowerCase(),
      displayName,
      source: 'gift_sent' as const,
      tier: '1000',
      weight: 1,
      giftIndex: i,
    })),
  })
}

const drawOnce = async (payload: object = {}) =>
  await app.inject({ method: 'POST', url: `/api/giveaways/${giveawayId}/draw`, payload })

describe('POST /draw', () => {
  beforeEach(() => {
    addParticipant('111', 'Ana', 5)
    addParticipant('222', 'Bruno', 3)
    addParticipant('333', 'Carla', 1)
  })

  it('saca un ganador y guarda la semilla', async () => {
    const res = await drawOnce({ winners: 1, seed: 'la-semilla' })
    const body = res.json() as {
      ok: boolean
      seed: string
      winners: Array<{ userId: string; position: number; seed: string }>
    }

    expect(res.statusCode).toBe(200)
    expect(body.seed).toBe('la-semilla')
    expect(body.winners).toHaveLength(1)
    expect(body.winners[0]?.position).toBe(1)
    expect(body.winners[0]?.seed).toBe('la-semilla')
  })

  it('genera una semilla si no se pasa ninguna', async () => {
    const body = (await drawOnce({ winners: 1 })).json() as { seed: string }
    expect(body.seed).toMatch(/^[0-9a-f]{32}$/)
  })

  it('saca varios ganadores sin repetir a nadie', async () => {
    const body = (await drawOnce({ winners: 3, seed: 's' })).json() as {
      winners: Array<{ userId: string }>
    }

    expect(body.winners).toHaveLength(3)
    expect(new Set(body.winners.map((w) => w.userId)).size).toBe(3)
  })

  /** Un doble clic no puede parecer dos sorteos. */
  it('repetir la misma semilla devuelve la tirada guardada, no una nueva', async () => {
    const primera = (await drawOnce({ winners: 1, seed: 'misma' })).json() as {
      winners: Array<{ id: string; userId: string }>
    }
    const segunda = (await drawOnce({ winners: 1, seed: 'misma' })).json() as {
      alreadyDrawn: boolean
      winners: Array<{ id: string; userId: string }>
    }

    expect(segunda.alreadyDrawn).toBe(true)
    expect(segunda.winners[0]?.id).toBe(primera.winners[0]?.id)

    const total = handle.sqlite.prepare('select count(*) as n from winners').get() as { n: number }
    expect(total.n).toBe(1)
  })

  it('excluye por defecto a quien ya ganó', async () => {
    const primero = (await drawOnce({ winners: 1, seed: 'a' })).json() as {
      winners: Array<{ userId: string }>
    }
    const segundo = (await drawOnce({ winners: 1, seed: 'b' })).json() as {
      winners: Array<{ userId: string }>
    }

    expect(segundo.winners[0]?.userId).not.toBe(primero.winners[0]?.userId)
  })

  it('permite que repita quien ya ganó si se pide', async () => {
    await drawOnce({ winners: 3, seed: 'a' })
    const res = await drawOnce({ winners: 1, seed: 'b', excludePastWinners: false })

    expect(res.statusCode).toBe(200)
  })

  it('avisa cuando ya no queda nadie por sortear', async () => {
    await drawOnce({ winners: 3, seed: 'a' })
    const res = await drawOnce({ winners: 1, seed: 'b' })

    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toMatch(/ya han ganado/)
  })

  it('publica un evento por ganador para que el panel lo anuncie', async () => {
    const publicados: unknown[] = []
    events.on('event', (e) => publicados.push(e))

    await drawOnce({ winners: 2, seed: 's' })

    expect(publicados.filter((e) => (e as { type: string }).type === 'winner.drawn')).toHaveLength(2)
  })

  it('rechaza un número de ganadores absurdo', async () => {
    expect((await drawOnce({ winners: 0 })).statusCode).toBe(400)
    expect((await drawOnce({ winners: 999 })).statusCode).toBe(400)
  })

  it('404 si el sorteo no existe', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/giveaways/nope/draw', payload: {} })
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /draw sin papeletas', () => {
  it('avisa de que no hay nadie en vez de sortear el vacío', async () => {
    const res = await drawOnce({ winners: 1 })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toMatch(/No hay papeletas/)
  })
})

describe('GET /verify', () => {
  beforeEach(() => {
    addParticipant('111', 'Ana', 5)
    addParticipant('222', 'Bruno', 3)
    addParticipant('333', 'Carla', 1)
  })

  const verify = async (seed: string) =>
    await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/verify?seed=${seed}` })

  it('reproduce la tirada a partir de la semilla', async () => {
    const sorteo = (await drawOnce({ winners: 2, seed: 'demostrable' })).json() as {
      winners: Array<{ userId: string; position: number }>
    }

    const body = (await verify('demostrable')).json() as {
      matches: boolean
      stored: Array<{ userId: string }>
      recomputed: Array<{ userId: string }>
      explanation: string
    }

    expect(body.matches).toBe(true)
    expect(body.recomputed.map((w) => w.userId)).toEqual(sorteo.winners.map((w) => w.userId))
    expect(body.stored).toEqual(body.recomputed)
    expect(body.explanation).toMatch(/se reproduce/)
  })

  /**
   * El caso que importa: se sortea a mitad de directo y sigue entrando gente.
   * La verificación no puede fallar por eso.
   */
  it('sigue cuadrando aunque entren papeletas nuevas después de sortear', async () => {
    await drawOnce({ winners: 1, seed: 'antes' })

    // Más participantes, con fecha posterior al sorteo.
    addParticipant('444', 'Diego', 50, '2026-09-13T23:00:00.000Z')
    addParticipant('555', 'Elena', 40, '2026-09-13T23:30:00.000Z')

    const body = (await verify('antes')).json() as { matches: boolean; pool: { tickets: number } }

    expect(body.matches).toBe(true)
    // El bote verificado es el que había al sortear, no el de ahora.
    expect(body.pool.tickets).toBe(9)
  })

  it('cuadra también en una segunda tirada que excluyó al primer ganador', async () => {
    await drawOnce({ winners: 1, seed: 'primera' })
    await drawOnce({ winners: 1, seed: 'segunda' })

    expect(((await verify('primera')).json() as { matches: boolean }).matches).toBe(true)
    expect(((await verify('segunda')).json() as { matches: boolean }).matches).toBe(true)
  })

  /**
   * Con tres tiradas, la segunda excluyó solo al ganador de la primera, no al
   * de la tercera. Si "ganadores anteriores" se calculara por fecha, aquí
   * fallaría: las tres comparten marca de tiempo al milisegundo.
   */
  it('cuadra con tres tiradas encadenadas', async () => {
    await drawOnce({ winners: 1, seed: 'uno' })
    await drawOnce({ winners: 1, seed: 'dos' })
    await drawOnce({ winners: 1, seed: 'tres' })

    for (const seed of ['uno', 'dos', 'tres']) {
      const body = (await verify(seed)).json() as { matches: boolean }
      expect(body.matches, `la tirada "${seed}" no se reproduce`).toBe(true)
    }
  })

  /** Si alguien toca la base de datos, la verificación tiene que cantarlo. */
  it('detecta que el resultado guardado no se corresponde con la semilla', async () => {
    await drawOnce({ winners: 1, seed: 'tocada' })

    handle.sqlite.prepare("update winners set user_id = '999' where seed = 'tocada'").run()

    const body = (await verify('tocada')).json() as { matches: boolean; explanation: string }

    expect(body.matches).toBe(false)
    expect(body.explanation).toMatch(/no coincide/)
  })

  it('404 si esa semilla no corresponde a ninguna tirada', async () => {
    expect((await verify('inventada')).statusCode).toBe(404)
  })

  it('400 si no se dice qué semilla comprobar', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/verify` })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /winners', () => {
  it('lista las tiradas guardadas', async () => {
    addParticipant('111', 'Ana', 1)
    addParticipant('222', 'Bruno', 1)

    await drawOnce({ winners: 1, seed: 'a' })
    await drawOnce({ winners: 1, seed: 'b' })

    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/winners` })
    const body = res.json() as { winners: Array<{ seed: string }> }

    expect(body.winners).toHaveLength(2)
    expect(new Set(body.winners.map((w) => w.seed))).toEqual(new Set(['a', 'b']))
  })
})
