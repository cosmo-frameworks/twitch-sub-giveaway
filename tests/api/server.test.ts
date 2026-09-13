import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AuthStatus } from '../../src/auth/status.js'
import { parseConfig, type AppConfig } from '../../src/config.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent } from '../../src/db/process-event.js'
import { createGiveaway } from '../../src/db/repositories/giveaways.js'
import { SETTINGS_FILENAME } from '../../src/settings.js'
import type { SubEvent } from '../../src/twitch/normalize.js'
import { PanelEvents } from '../../src/api/events.js'
import { createApiServer } from '../../src/api/server.js'

let handle: DbHandle
let app: FastifyInstance
let config: AppConfig
let events: PanelEvents
let authStatus: AuthStatus
let giveawayId: string
let dataDir: string
let connected = true

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'twitch-api-'))
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo de prueba',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id

  config = parseConfig(
    {
      TWITCH_CLIENT_ID: 'client-id',
      TWITCH_CLIENT_SECRET: 'secret',
      TWITCH_BROADCASTER_LOGIN: 'elstreamer',
    },
    { defaultDataDir: dataDir },
  )

  events = new PanelEvents()
  authStatus = new AuthStatus()
  authStatus.set('ok', 'token válido')
  connected = true

  app = await createApiServer({
    db: handle.db,
    config,
    authStatus,
    events,
    eventSubConnected: () => connected,
    activeGiveawayId: () => giveawayId,
    broadcasterLogin: () => 'elstreamer',
    // Sin panel en los tests: se prueba la API, no el estático.
    panelDist: null,
  })
})

afterEach(async () => {
  await app.close()
  handle.close()
})

function addEntries(userId: string, displayName: string, count: number, messageId: string): void {
  const event: SubEvent = {
    messageId,
    type: 'gift',
    userId,
    login: displayName.toLowerCase(),
    displayName,
    tier: '1000',
    isGift: true,
    total: count,
    isAnonymous: false,
    occurredAt: new Date('2026-09-13T20:30:00.000Z'),
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

describe('GET /api/giveaways/:id/entries', () => {
  it('devuelve la lista agregada por participante con su contador', async () => {
    addEntries('222', 'Generosa', 5, 'm1')
    addEntries('111', 'Pepito', 1, 'm2')

    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/entries` })
    const body = res.json() as {
      ok: boolean
      participants: Array<{ userId: string; displayName: string; entries: number }>
      totals: { entries: number; participants: number }
    }

    expect(res.statusCode).toBe(200)
    expect(body.ok).toBe(true)
    // Ordenado por número de papeletas, de más a menos.
    expect(body.participants.map((p) => [p.displayName, p.entries])).toEqual([
      ['Generosa', 5],
      ['Pepito', 1],
    ])
    expect(body.totals).toMatchObject({ entries: 6, participants: 2 })
  })

  it('devuelve una lista vacía si aún no hay nadie', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/entries` })
    const body = res.json() as { participants: unknown[]; totals: { entries: number } }

    expect(body.participants).toEqual([])
    expect(body.totals.entries).toBe(0)
  })

  it('404 si el sorteo no existe', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/giveaways/no-existe/entries' })
    expect(res.statusCode).toBe(404)
  })

  it('incluye de dónde salieron las papeletas, para poder auditarlas', async () => {
    addEntries('222', 'Generosa', 2, 'm1')

    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/entries` })
    const body = res.json() as { participants: Array<{ sources: string }> }

    expect(body.participants[0]?.sources).toContain('gift_sent')
  })
})

describe('GET /api/status', () => {
  it('expone el estado de auth, de eventsub y dónde está la base de datos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' })
    const body = res.json() as {
      status: {
        broadcaster: string
        auth: { state: string }
        eventSub: { connected: boolean }
        storage: { dbPath: string; dbSource: string }
      }
    }

    expect(body.status.broadcaster).toBe('elstreamer')
    expect(body.status.auth.state).toBe('ok')
    expect(body.status.eventSub.connected).toBe(true)
    expect(body.status.storage.dbPath).toContain('sorteos.db')
    expect(body.status.storage.dbSource).toBe('default')
  })

  it('refleja que eventsub se ha caído', async () => {
    connected = false
    const res = await app.inject({ method: 'GET', url: '/api/status' })
    const body = res.json() as { status: { eventSub: { connected: boolean } } }
    expect(body.status.eventSub.connected).toBe(false)
  })

  it('refleja un token revocado', async () => {
    authStatus.set('revoked', 'el streamer retiró el acceso')
    const res = await app.inject({ method: 'GET', url: '/api/status' })
    const body = res.json() as { status: { auth: { state: string; detail: string } } }

    expect(body.status.auth.state).toBe('revoked')
    expect(body.status.auth.detail).toContain('retiró')
  })
})

describe('PUT /api/settings/db-path', () => {
  it('guarda la ruta elegida en settings.json y pide reinicio', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/db-path',
      payload: { dbPath: 'D:/sorteos/enero.db' },
    })
    const body = res.json() as { ok: boolean; restartRequired: boolean }

    expect(body.ok).toBe(true)
    expect(body.restartRequired).toBe(true)

    const saved = JSON.parse(await readFile(join(dataDir, SETTINGS_FILENAME), 'utf8')) as {
      dbPath: string
    }
    expect(saved.dbPath).toBe('D:/sorteos/enero.db')
  })

  it('null vuelve a la carpeta por defecto', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings/db-path',
      payload: { dbPath: 'D:/sorteos/enero.db' },
    })
    await app.inject({ method: 'PUT', url: '/api/settings/db-path', payload: { dbPath: null } })

    const saved = JSON.parse(await readFile(join(dataDir, SETTINGS_FILENAME), 'utf8')) as object
    expect(saved).toEqual({})
  })

  it('rechaza una ruta vacía', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/db-path',
      payload: { dbPath: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('rechaza algo que no sea una ruta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings/db-path',
      payload: { dbPath: 42 },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/auth/reauthorize', () => {
  it('501 si el proceso no puede lanzar el flujo', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/reauthorize' })
    expect(res.statusCode).toBe(501)
  })

  it('lanza el flujo sin esperar a que el streamer autorice', async () => {
    let lanzado = false
    const withAuth = await createApiServer({
      db: handle.db,
      config,
      authStatus,
      events,
      eventSubConnected: () => true,
      activeGiveawayId: () => giveawayId,
      reauthorize: async () => {
        lanzado = true
        // Un OAuth real tarda minutos: la respuesta no puede esperarlo.
        await new Promise((r) => setTimeout(r, 10_000))
      },
    })

    const res = await withAuth.inject({ method: 'POST', url: '/api/auth/reauthorize' })

    expect(res.statusCode).toBe(200)
    expect(lanzado).toBe(true)
    await withAuth.close()
  })
})

describe('rutas desconocidas', () => {
  it('404 en JSON para /api', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/lo-que-sea' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ ok: false })
  })

  it('explica cómo compilar el panel si no está', async () => {
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(503)
    expect(res.body).toContain('panel:build')
  })
})
