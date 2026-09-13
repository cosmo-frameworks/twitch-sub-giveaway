import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthStatus } from '../../src/auth/status.js'
import { parseConfig } from '../../src/config.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent } from '../../src/db/process-event.js'
import { createGiveaway, findOpenGiveaway } from '../../src/db/repositories/giveaways.js'
import type { SubEvent } from '../../src/twitch/normalize.js'
import { PanelEvents } from '../../src/api/events.js'
import { exportFilename, participantsToCsv, winnersToCsv } from '../../src/api/export.js'
import { createApiServer } from '../../src/api/server.js'

let handle: DbHandle
let app: FastifyInstance
let events: PanelEvents
let giveawayId: string
let resolveUser: ReturnType<typeof vi.fn>

beforeEach(async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'twitch-ops-'))
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo de enero',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id

  events = new PanelEvents()
  const authStatus = new AuthStatus()
  authStatus.set('ok', 'token válido')

  resolveUser = vi.fn(async (login: string) =>
    login === 'nadie' ? null : { userId: '777', login, displayName: 'ElInvitado' },
  )

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
    resolveUser: resolveUser as never,
    panelDist: null,
  })
})

afterEach(async () => {
  await app.close()
  handle.close()
})

let counter = 0
function addParticipant(userId: string, displayName: string, count: number): void {
  const event: SubEvent = {
    messageId: `m-${counter++}`,
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

describe('CSV', () => {
  const row = {
    platform: 'twitch',
    userId: '111',
    login: 'pepito',
    displayName: 'Pepito',
    entries: 3,
    weight: 3,
    sources: 'sub,resub',
    firstEntryAt: '2026-09-13T20:30:00.000Z',
    lastEntryAt: '2026-09-13T21:00:00.000Z',
  }

  /** Sin BOM, Excel en Windows destroza cualquier nombre con tilde. */
  it('empieza por BOM para que Excel no rompa los acentos', () => {
    expect(participantsToCsv([row]).startsWith('﻿')).toBe(true)
  })

  it('usa CRLF, que es lo que espera Excel', () => {
    expect(participantsToCsv([row])).toContain('\r\n')
  })

  it('entrecomilla lo que lleve comas o comillas', () => {
    const csv = participantsToCsv([{ ...row, displayName: 'Pepito, "el bueno"' }])
    expect(csv).toContain('"Pepito, ""el bueno"""')
  })

  /**
   * Un usuario de Twitch puede llamarse `=cmd`. Sin escapar, Excel lo trataría
   * como fórmula en el ordenador de quien abra el fichero.
   */
  it('neutraliza los nombres que Excel interpretaría como fórmula', () => {
    const csv = participantsToCsv([{ ...row, displayName: '=1+1' }])
    expect(csv).toContain("'=1+1")
    expect(csv).not.toMatch(/,=1\+1/)
  })

  it('exporta los ganadores con su semilla', () => {
    const csv = winnersToCsv([
      {
        id: 'w1',
        giveawayId: 'g1',
        platform: 'twitch',
        userId: '111',
        position: 1,
        seed: 'la-semilla',
        drawnAt: '2026-09-13T22:00:00.000Z',
      },
    ])
    expect(csv).toContain('la-semilla')
    expect(csv).toContain('puesto,plataforma,user_id,semilla,sorteado_el')
  })
})

describe('exportFilename', () => {
  it('lleva el nombre del sorteo y la fecha', () => {
    expect(exportFilename('participantes', 'Sorteo de enero', new Date('2026-09-13'), 'csv')).toBe(
      'participantes-sorteo-de-enero-2026-09-13.csv',
    )
  })

  it('limpia acentos y caracteres raros', () => {
    expect(exportFilename('ganadores', 'Ñandú: ¡el sorteo!', new Date('2026-09-13'), 'json')).toBe(
      'ganadores-nandu-el-sorteo-2026-09-13.json',
    )
  })

  it('aguanta un nombre que no deje nada utilizable', () => {
    expect(exportFilename('participantes', '???', new Date('2026-09-13'), 'csv')).toBe(
      'participantes-sorteo-2026-09-13.csv',
    )
  })
})

describe('GET /export', () => {
  beforeEach(() => {
    addParticipant('111', 'Pepito', 2)
    addParticipant('222', 'Generosa', 5)
  })

  it('descarga el CSV de participantes con nombre de fichero', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/export` })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('participantes-sorteo-de-enero-')
    expect(res.body).toContain('Generosa')
    expect(res.body).toContain('Pepito')
  })

  it('exporta también en JSON', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/giveaways/${giveawayId}/export?format=json`,
    })
    const body = res.json() as { participants: unknown[]; totals: { entries: number } }

    expect(body.participants).toHaveLength(2)
    expect(body.totals.entries).toBe(7)
  })

  it('exporta los ganadores', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/draw`,
      payload: { winners: 1, seed: 's' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/giveaways/${giveawayId}/export?what=ganadores`,
    })

    expect(res.headers['content-disposition']).toContain('ganadores-')
    expect(res.body).toContain('s')
  })

  it('rechaza un formato inventado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/giveaways/${giveawayId}/export?format=xlsx`,
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('abrir y cerrar sorteos', () => {
  it('abrir uno nuevo cierra el anterior', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/giveaways',
      payload: { name: 'Sorteo de febrero' },
    })
    const body = res.json() as {
      giveaway: { id: string; name: string; status: string }
      closed: { name: string } | null
      restartRequired: boolean
    }

    expect(body.giveaway.name).toBe('Sorteo de febrero')
    expect(body.giveaway.status).toBe('open')
    expect(body.closed?.name).toBe('Sorteo de enero')
    // Ya no hace falta reiniciar: el sorteo activo se resuelve en cada papeleta.
    expect(body.restartRequired).toBe(false)
  })

  /** Dos sorteos abiertos a la vez y las papeletas no sabrían a cuál ir. */
  it('nunca deja dos sorteos abiertos', async () => {
    await app.inject({ method: 'POST', url: '/api/giveaways', payload: { name: 'Dos' } })
    await app.inject({ method: 'POST', url: '/api/giveaways', payload: { name: 'Tres' } })

    const abiertos = handle.sqlite
      .prepare("select count(*) as n from giveaways where status = 'open'")
      .get() as { n: number }

    expect(abiertos.n).toBe(1)
    expect(findOpenGiveaway(handle.db)?.name).toBe('Tres')
  })

  it('exige un nombre', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/giveaways', payload: { name: '  ' } })
    expect(res.statusCode).toBe(400)
  })

  it('cierra y vuelve a abrir', async () => {
    await app.inject({ method: 'POST', url: `/api/giveaways/${giveawayId}/close` })
    expect(findOpenGiveaway(handle.db)).toBeUndefined()

    await app.inject({ method: 'POST', url: `/api/giveaways/${giveawayId}/reopen` })
    expect(findOpenGiveaway(handle.db)?.id).toBe(giveawayId)
  })

  it('lista todos los sorteos', async () => {
    await app.inject({ method: 'POST', url: '/api/giveaways', payload: { name: 'Otro' } })

    const body = (await app.inject({ method: 'GET', url: '/api/giveaways' })).json() as {
      giveaways: unknown[]
    }
    expect(body.giveaways).toHaveLength(2)
  })
})

describe('entradas manuales', () => {
  it('añade papeletas y guarda el motivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/manual-entries`,
      payload: { login: 'elinvitado', entries: 3, reason: 'Se suscribió con la app cerrada' },
    })
    const body = res.json() as { added: number; participant: { displayName: string } }

    expect(body.added).toBe(3)
    expect(body.participant.displayName).toBe('ElInvitado')

    const row = handle.sqlite
      .prepare("select source, raw_payload from entries where source = 'manual' limit 1")
      .get() as { source: string; raw_payload: string }

    expect(row.source).toBe('manual')
    expect(JSON.parse(row.raw_payload)).toMatchObject({
      manual: true,
      reason: 'Se suscribió con la app cerrada',
    })
  })

  /** Sin motivo no hay forma de explicar de dónde salieron esas papeletas. */
  it('exige un motivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/manual-entries`,
      payload: { login: 'elinvitado', entries: 1 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('avisa si el canal no existe en Twitch', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/manual-entries`,
      payload: { login: 'nadie', entries: 1, reason: 'prueba' },
    })

    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: string }).error).toMatch(/no existe/)
  })

  it('el panel se entera sin refrescar', async () => {
    const publicados: unknown[] = []
    events.on('event', (e) => publicados.push(e))

    await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/manual-entries`,
      payload: { login: 'elinvitado', entries: 1, reason: 'compensación' },
    })

    expect(publicados.filter((e) => (e as { type: string }).type === 'entry.added')).toHaveLength(1)
  })

  it('suma a quien ya tenía papeletas en vez de duplicarlo', async () => {
    addParticipant('777', 'ElInvitado', 2)

    await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/manual-entries`,
      payload: { login: 'elinvitado', entries: 1, reason: 'una más' },
    })

    const res = await app.inject({ method: 'GET', url: `/api/giveaways/${giveawayId}/entries` })
    const body = res.json() as { participants: Array<{ userId: string; entries: number }> }

    expect(body.participants).toHaveLength(1)
    expect(body.participants[0]).toMatchObject({ userId: '777', entries: 3 })
  })

  it('rechaza un número de papeletas absurdo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/manual-entries`,
      payload: { login: 'elinvitado', entries: 5000, reason: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})

/**
 * El archivo que ve el streamer: qué sorteos hubo y qué dio cada uno.
 *
 * Lo importante es que las cifras vengan ya en la lista. Sin ellas el panel
 * tendría que pedir las papeletas y los ganadores de cada sorteo por separado,
 * y un streamer con un año de directos acabaría haciendo cientos de peticiones
 * para pintar una pantalla.
 */
describe('GET /api/giveaways', () => {
  it('devuelve cada sorteo con sus papeletas, participantes y ganadores', async () => {
    addParticipant('111', 'ElManu', 3)

    const res = await app.inject({ method: 'GET', url: '/api/giveaways' })
    const body = res.json() as {
      giveaways: Array<{ name: string; entries: number; participants: number; winners: number }>
    }

    expect(body.giveaways[0]).toMatchObject({
      name: 'Sorteo de enero',
      entries: 3,
      participants: 1,
      winners: 0,
    })
  })

  it('cuenta los ganadores una vez sorteado', async () => {
    addParticipant('111', 'ElManu', 2)
    await app.inject({
      method: 'POST',
      url: `/api/giveaways/${giveawayId}/draw`,
      payload: { winners: 1 },
    })

    const res = await app.inject({ method: 'GET', url: '/api/giveaways' })
    const body = res.json() as { giveaways: Array<{ winners: number }> }

    expect(body.giveaways[0]?.winners).toBe(1)
  })

  it('un sorteo archivado sigue en la lista con sus cifras', async () => {
    addParticipant('111', 'ElManu', 4)
    await app.inject({ method: 'POST', url: '/api/giveaways', payload: { name: 'El siguiente' } })

    const res = await app.inject({ method: 'GET', url: '/api/giveaways' })
    const body = res.json() as {
      giveaways: Array<{ name: string; status: string; entries: number }>
    }

    const enero = body.giveaways.find((g) => g.name === 'Sorteo de enero')
    expect(enero).toMatchObject({ status: 'closed', entries: 4 })
    expect(body.giveaways.find((g) => g.name === 'El siguiente')).toMatchObject({
      status: 'open',
      entries: 0,
    })
  })
})
