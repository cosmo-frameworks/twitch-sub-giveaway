/**
 * Criterio de aceptación de la fase 3: procesar el mismo evento dos veces deja
 * `entries` con el mismo número de filas.
 *
 * Se prueba contra SQLite de verdad (en memoria), con las migraciones reales
 * aplicadas: las garantías que interesan aquí —índice único, claves ajenas,
 * atomicidad de la transacción— las da el motor, no el código TypeScript, así
 * que falsear la base de datos no probaría nada.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import type { SubEvent } from '../../src/twitch/normalize.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent, type EntryDraft } from '../../src/db/process-event.js'
import { createGiveaway } from '../../src/db/repositories/giveaways.js'

let handle: DbHandle
let giveawayId: string

beforeEach(() => {
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo de prueba',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id
})

const subEvent: SubEvent = {
  messageId: 'msg-001',
  type: 'sub',
  userId: '111',
  login: 'pepito',
  displayName: 'Pepito',
  tier: '1000',
  isGift: false,
  total: null,
  isAnonymous: false,
  occurredAt: new Date('2026-09-13T20:30:00.000Z'),
}

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    platform: 'twitch',
    userId: '111',
    login: 'pepito',
    displayName: 'Pepito',
    source: 'sub',
    tier: '1000',
    weight: 1,
    giftIndex: 0,
    ...overrides,
  }
}

const countEntries = (): number =>
  (handle.sqlite.prepare('select count(*) as n from entries').get() as { n: number }).n

const countParticipants = (): number =>
  (handle.sqlite.prepare('select count(*) as n from participants').get() as { n: number }).n

describe('processEvent — inserción', () => {
  it('guarda participante y entrada', () => {
    const result = processEvent(handle.db, { giveawayId, event: subEvent, drafts: [draft()] })

    expect(result).toEqual({ status: 'inserted', entriesInserted: 1 })
    expect(countEntries()).toBe(1)
    expect(countParticipants()).toBe(1)
  })

  it('deja el message_id registrado como procesado', () => {
    processEvent(handle.db, { giveawayId, event: subEvent, drafts: [draft()] })

    const row = handle.sqlite
      .prepare('select message_id, type from processed_events')
      .get() as { message_id: string; type: string }

    expect(row).toEqual({ message_id: 'msg-001', type: 'sub' })
  })

  it('guarda el tier aunque el peso sea 1', () => {
    processEvent(handle.db, {
      giveawayId,
      event: { ...subEvent, tier: '3000' },
      drafts: [draft({ tier: '3000' })],
    })

    const row = handle.sqlite.prepare('select tier, weight from entries').get() as {
      tier: string
      weight: number
    }
    expect(row).toEqual({ tier: '3000', weight: 1 })
  })
})

describe('processEvent — idempotencia (criterio de aceptación)', () => {
  it('procesar el mismo evento dos veces deja el mismo número de filas', () => {
    const input = { giveawayId, event: subEvent, drafts: [draft()] }

    const first = processEvent(handle.db, input)
    const after = countEntries()

    const second = processEvent(handle.db, input)

    expect(first.status).toBe('inserted')
    expect(second).toEqual({ status: 'duplicate', entriesInserted: 0 })
    expect(countEntries()).toBe(after)
  })

  it('un gift bomb de 20 inserta 20 filas, y repetido sigue en 20', () => {
    const gift: SubEvent = {
      ...subEvent,
      messageId: 'msg-gift',
      type: 'gift',
      userId: '222',
      login: 'generosa',
      displayName: 'Generosa',
      total: 20,
      isGift: true,
      tier: '2000',
    }

    const drafts = Array.from({ length: 20 }, (_, i) =>
      draft({
        userId: '222',
        login: 'generosa',
        displayName: 'Generosa',
        source: 'gift_sent',
        tier: '2000',
        giftIndex: i,
      }),
    )

    expect(processEvent(handle.db, { giveawayId, event: gift, drafts })).toEqual({
      status: 'inserted',
      entriesInserted: 20,
    })
    expect(countEntries()).toBe(20)

    processEvent(handle.db, { giveawayId, event: gift, drafts })
    expect(countEntries()).toBe(20)
  })

  /**
   * El índice único de la sección 4 —(giveaway_id, event_id, source)— habría
   * rechazado la segunda papeleta de un gift bomb. Con `gift_index` cada una es
   * única sin perder la protección contra duplicados.
   */
  it('el índice único deja pasar las N papeletas de un regalo pero no un duplicado exacto', () => {
    const insert = (giftIndex: number): unknown =>
      handle.sqlite
        .prepare(
          `insert into entries
             (id, giveaway_id, platform, user_id, source, tier, weight, event_id, gift_index, occurred_at)
           values (?, ?, 'twitch', '111', 'gift_sent', '1000', 1, 'ev-1', ?, '2026-09-13T20:30:00.000Z')`,
        )
        .run(`e${giftIndex}`, giveawayId, giftIndex)

    handle.sqlite
      .prepare(
        `insert into participants (platform, user_id, login, display_name, first_seen_at, last_seen_at)
         values ('twitch', '111', 'pepito', 'Pepito', '2026-09-13T20:00:00.000Z', '2026-09-13T20:00:00.000Z')`,
      )
      .run()

    insert(0)
    insert(1)
    expect(countEntries()).toBe(2)

    // Mismo evento, misma fuente, mismo gift_index → duplicado real.
    expect(() =>
      handle.sqlite
        .prepare(
          `insert into entries
             (id, giveaway_id, platform, user_id, source, tier, weight, event_id, gift_index, occurred_at)
           values ('otro', ?, 'twitch', '111', 'gift_sent', '1000', 1, 'ev-1', 0, '2026-09-13T20:30:00.000Z')`,
        )
        .run(giveawayId),
    ).toThrow(/UNIQUE/i)
  })
})

describe('processEvent — participantes', () => {
  it('conserva first_seen_at y actualiza last_seen_at y el nombre', () => {
    processEvent(handle.db, { giveawayId, event: subEvent, drafts: [draft()] })

    processEvent(handle.db, {
      giveawayId,
      event: {
        ...subEvent,
        messageId: 'msg-002',
        displayName: 'PepitoNuevo',
        login: 'pepitonuevo',
        occurredAt: new Date('2026-09-14T10:00:00.000Z'),
      },
      drafts: [draft({ login: 'pepitonuevo', displayName: 'PepitoNuevo' })],
    })

    const row = handle.sqlite
      .prepare('select login, display_name, first_seen_at, last_seen_at from participants')
      .get() as Record<string, string>

    expect(countParticipants()).toBe(1)
    expect(row.display_name).toBe('PepitoNuevo')
    expect(row.login).toBe('pepitonuevo')
    expect(row.first_seen_at).toBe('2026-09-13T20:30:00.000Z')
    expect(row.last_seen_at).toBe('2026-09-14T10:00:00.000Z')
  })

  it('no duplica participantes aunque un evento traiga muchas entradas', () => {
    const drafts = Array.from({ length: 5 }, (_, i) =>
      draft({ source: 'gift_sent', giftIndex: i }),
    )
    processEvent(handle.db, { giveawayId, event: subEvent, drafts })

    expect(countParticipants()).toBe(1)
    expect(countEntries()).toBe(5)
  })
})

describe('processEvent — eventos que no generan entradas', () => {
  /**
   * Un regalo anónimo con `anonymousGift: 'ignore'` no tiene a quién premiar.
   * Aun así hay que marcarlo como procesado: si no, un reenvío lo volvería a
   * evaluar entero.
   */
  it('marca como procesado un evento sin entradas', () => {
    const result = processEvent(handle.db, {
      giveawayId,
      event: { ...subEvent, messageId: 'msg-anon', type: 'gift', isAnonymous: true, userId: null },
      drafts: [],
    })

    expect(result).toEqual({ status: 'no-entries', entriesInserted: 0 })
    expect(countEntries()).toBe(0)
    expect(countParticipants()).toBe(0)

    const processed = handle.sqlite
      .prepare('select count(*) as n from processed_events')
      .get() as { n: number }
    expect(processed.n).toBe(1)
  })

  it('un evento sin entradas también queda deduplicado', () => {
    const input = {
      giveawayId,
      event: { ...subEvent, messageId: 'msg-anon', isAnonymous: true },
      drafts: [],
    }
    processEvent(handle.db, input)
    expect(processEvent(handle.db, input).status).toBe('duplicate')
  })
})

describe('processEvent — atomicidad', () => {
  /**
   * Si la inserción de entradas falla, no puede quedar el evento marcado como
   * procesado: al reintentar se descartaría y esas papeletas se perderían para
   * siempre.
   */
  it('no deja el evento marcado si la inserción falla', () => {
    expect(() =>
      processEvent(handle.db, {
        giveawayId: 'sorteo-que-no-existe',
        event: subEvent,
        drafts: [draft()],
      }),
    ).toThrow()

    const processed = handle.sqlite
      .prepare('select count(*) as n from processed_events')
      .get() as { n: number }

    expect(processed.n).toBe(0)
    expect(countEntries()).toBe(0)
    expect(countParticipants()).toBe(0)
  })
})

describe('claves ajenas', () => {
  it('están activadas: no se puede insertar una entrada huérfana', () => {
    expect(() =>
      handle.sqlite
        .prepare(
          `insert into entries
             (id, giveaway_id, platform, user_id, source, weight, gift_index, occurred_at)
           values ('x', ?, 'twitch', 'fantasma', 'sub', 1, 0, '2026-09-13T20:30:00.000Z')`,
        )
        .run(giveawayId),
    ).toThrow(/FOREIGN KEY/i)
  })
})
