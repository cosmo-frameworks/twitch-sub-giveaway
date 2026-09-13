import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_ENTRY_RULES, type EntryRules } from '../../src/config.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent } from '../../src/db/process-event.js'
import { tallyByParticipant } from '../../src/db/repositories/entries.js'
import { createGiveaway } from '../../src/db/repositories/giveaways.js'
import { reconcile, type CurrentSubscriber } from '../../src/twitch/reconcile.js'
import type { SubEvent } from '../../src/twitch/normalize.js'
import { writeDailySnapshot, snapshotFilename } from '../../src/twitch/snapshot.js'

let handle: DbHandle
let giveawayId: string

const BROADCASTER_ID = '123456'

beforeEach(() => {
  handle = openDb({ path: ':memory:' })
  giveawayId = createGiveaway(handle.db, {
    name: 'Sorteo',
    openedAt: '2026-09-13T20:00:00.000Z',
  }).id
})

function sub(over: Partial<CurrentSubscriber> = {}): CurrentSubscriber {
  return {
    userId: '111',
    userName: 'pepito',
    userDisplayName: 'Pepito',
    tier: '1000',
    isGift: false,
    gifterId: null,
    ...over,
  }
}

const run = (subscribers: CurrentSubscriber[], rules: EntryRules = DEFAULT_ENTRY_RULES) =>
  reconcile({
    db: handle.db,
    giveawayId,
    broadcasterId: BROADCASTER_ID,
    rules,
    fetchSubscribers: async () => subscribers,
    now: () => new Date('2026-09-13T21:00:00.000Z'),
  })

const tally = (): Record<string, number> =>
  Object.fromEntries(tallyByParticipant(handle.db, giveawayId).map((t) => [t.userId, t.entries]))

const countEntries = (): number =>
  (handle.sqlite.prepare('select count(*) as n from entries').get() as { n: number }).n

describe('reconcile — criterio de aceptación', () => {
  /**
   * "Matar el proceso, suscribir a alguien, rearrancar → aparece en la lista."
   * EventSub no reenvía lo perdido (trampa 6): sin esto, ese sub no existe.
   */
  it('da de alta a un sub que llegó mientras el proceso estaba caído', async () => {
    const result = await run([sub({ userId: '999', userName: 'nuevo', userDisplayName: 'Nuevo' })])

    expect(result.entriesAdded).toBe(1)
    expect(result.subscribers).toBe(1)
    expect(tally()).toEqual({ '999': 1 })
  })

  it('informa de cuántas papeletas añadió, como pide el plan', async () => {
    const result = await run([sub({ userId: '1' }), sub({ userId: '2' }), sub({ userId: '3' })])

    expect(result).toMatchObject({
      subscribers: 3,
      entriesAdded: 3,
      participantsAdded: 3,
      alreadyHadEntries: 0,
    })
  })
})

describe('reconcile — idempotencia', () => {
  /**
   * Lo más peligroso de esta fase. Las entradas reconciliadas llevan
   * `event_id = NULL`, así que el índice único de eventos no las cubre: sin una
   * protección propia, cada reinicio repartiría otra papeleta a todo el mundo.
   */
  it('ejecutarla dos veces no añade nada la segunda vez', async () => {
    const subs = [sub({ userId: '1' }), sub({ userId: '2' })]

    await run(subs)
    const after = countEntries()

    const second = await run(subs)

    expect(second.entriesAdded).toBe(0)
    expect(second.alreadyHadEntries).toBe(2)
    expect(countEntries()).toBe(after)
  })

  it('aguanta diez reinicios sin inflar la lista', async () => {
    const subs = [sub({ userId: '1' }), sub({ userId: '2' }), sub({ userId: '3' })]

    for (let i = 0; i < 10; i++) await run(subs)

    expect(countEntries()).toBe(3)
    expect(tally()).toEqual({ '1': 1, '2': 1, '3': 1 })
  })

  /** Defensa a nivel de base de datos, por si fallara la comprobación en memoria. */
  it('el índice único impide dos papeletas reconciliadas del mismo usuario', async () => {
    await run([sub({ userId: '1' })])

    expect(() =>
      handle.sqlite
        .prepare(
          `insert into entries
             (id, giveaway_id, platform, user_id, source, tier, weight, event_id, gift_index, reconciled, occurred_at)
           values ('dup', ?, 'twitch', '1', 'sub', '1000', 1, null, 0, 1, '2026-09-13T21:00:00.000Z')`,
        )
        .run(giveawayId),
    ).toThrow(/UNIQUE/i)
  })
})

describe('reconcile — no pisa lo que ya llegó en directo', () => {
  it('respeta a quien ya tiene papeletas de un evento', async () => {
    const event: SubEvent = {
      messageId: 'msg-1',
      type: 'gift',
      userId: '222',
      login: 'generosa',
      displayName: 'Generosa',
      tier: '2000',
      isGift: true,
      total: 5,
      isAnonymous: false,
      occurredAt: new Date('2026-09-13T20:30:00.000Z'),
    }
    processEvent(handle.db, {
      giveawayId,
      event,
      drafts: Array.from({ length: 5 }, (_, i) => ({
        platform: 'twitch',
        userId: '222',
        login: 'generosa',
        displayName: 'Generosa',
        source: 'gift_sent' as const,
        tier: '2000',
        weight: 1,
        giftIndex: i,
      })),
    })

    const result = await run([sub({ userId: '222', userName: 'generosa' })])

    expect(result.alreadyHadEntries).toBe(1)
    expect(result.entriesAdded).toBe(0)
    // Sus 5 papeletas del regalo siguen intactas, no se reducen a 1.
    expect(tally()).toEqual({ '222': 5 })
  })
})

describe('reconcile — aplica las mismas reglas que en directo', () => {
  /**
   * Si un sub regalado diera papeleta al reconciliar pero no al llegar por
   * evento, la lista dependería de si el proceso estuvo caído o no.
   */
  it('un sub regalado no da papeleta al receptor, igual que en directo', async () => {
    const result = await run([sub({ userId: '555', isGift: true, gifterId: '222' })])

    expect(result.entriesAdded).toBe(0)
    expect(result.skippedByRules).toBe(1)
    expect(countEntries()).toBe(0)
  })

  it('si se configuran papeletas al receptor, también las da al reconciliar', async () => {
    const result = await run([sub({ userId: '555', isGift: true, gifterId: '222' })], {
      ...DEFAULT_ENTRY_RULES,
      giftReceived: { entries: 1 },
    })

    expect(result.entriesAdded).toBe(1)
    expect(tally()).toEqual({ '555': 1 })
  })

  it('cuenta los regalos cuyo regalador no se puede acreditar', async () => {
    const result = await run([
      sub({ userId: '1', isGift: true, gifterId: '222' }),
      sub({ userId: '2', isGift: true, gifterId: '222' }),
      sub({ userId: '3', isGift: false }),
    ])

    // Helix no dice CUÁNDO se regaló, así que no se puede saber si fue durante
    // la caída. Acreditar al regalador le daría crédito por su histórico entero.
    expect(result.giftersNotCredited).toBe(2)
  })

  it('aplica los pesos por tier', async () => {
    await run([sub({ userId: '1', tier: '3000' })], {
      ...DEFAULT_ENTRY_RULES,
      tierWeights: { '1000': 1, '2000': 2, '3000': 5 },
    })

    const row = handle.sqlite.prepare('select weight, tier from entries').get() as {
      weight: number
      tier: string
    }
    expect(row).toEqual({ weight: 5, tier: '3000' })
  })

  it('no revienta si Twitch manda un tier desconocido', async () => {
    await run([sub({ userId: '1', tier: 'algo-raro' })])
    const row = handle.sqlite.prepare('select weight from entries').get() as { weight: number }
    expect(row.weight).toBe(1)
  })
})

describe('reconcile — detalles', () => {
  it('excluye al propio streamer, que figura como suscriptor de sí mismo', async () => {
    const result = await run([sub({ userId: BROADCASTER_ID }), sub({ userId: '1' })])

    expect(result.subscribers).toBe(1)
    expect(tally()).toEqual({ '1': 1 })
  })

  it('marca las entradas como reconciled y sin event_id', async () => {
    await run([sub({ userId: '1' })])

    const row = handle.sqlite.prepare('select reconciled, event_id from entries').get() as {
      reconciled: number
      event_id: string | null
    }
    expect(row).toEqual({ reconciled: 1, event_id: null })
  })

  it('no hace nada si el canal no tiene subs', async () => {
    const result = await run([])
    expect(result).toMatchObject({ subscribers: 0, entriesAdded: 0 })
    expect(countEntries()).toBe(0)
  })

  it('recorre la lista entera aunque sea larga', async () => {
    const muchos = Array.from({ length: 500 }, (_, i) => sub({ userId: `u${i}` }))
    const result = await run(muchos)

    expect(result.entriesAdded).toBe(500)
    expect(countEntries()).toBe(500)
  })
})

describe('snapshot diario', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'twitch-snap-'))
  })

  it('escribe la lista de subs del día', async () => {
    const now = new Date('2026-09-13T21:00:00.000Z')
    const result = await writeDailySnapshot({ dataDir, subscribers: [sub()], now })

    expect(result.path).toContain(snapshotFilename(now))
    expect(result.subscribers).toBe(1)

    const written = JSON.parse(await readFile(result.path as string, 'utf8')) as {
      count: number
      subscribers: CurrentSubscriber[]
    }
    expect(written.count).toBe(1)
    expect(written.subscribers[0]?.userName).toBe('pepito')
  })

  /** Se llama en cada reconexión; en un día malo de red serían muchas. */
  it('solo escribe una vez al día', async () => {
    const now = new Date('2026-09-13T21:00:00.000Z')

    await writeDailySnapshot({ dataDir, subscribers: [sub()], now })
    const second = await writeDailySnapshot({ dataDir, subscribers: [sub()], now })

    expect(second.path).toBeNull()
    expect(await readdir(join(dataDir, 'backups'))).toHaveLength(1)
  })

  it('escribe un fichero nuevo al día siguiente', async () => {
    await writeDailySnapshot({
      dataDir,
      subscribers: [sub()],
      now: new Date('2026-09-13T21:00:00.000Z'),
    })
    await writeDailySnapshot({
      dataDir,
      subscribers: [sub()],
      now: new Date('2026-09-14T09:00:00.000Z'),
    })

    expect(await readdir(join(dataDir, 'backups'))).toEqual([
      'subs-2026-09-13.json',
      'subs-2026-09-14.json',
    ])
  })

  it('crea la carpeta backups si no existe', async () => {
    const nuevo = join(dataDir, 'sin', 'crear')
    const result = await writeDailySnapshot({ dataDir: nuevo, subscribers: [], now: new Date() })
    expect(result.path).not.toBeNull()
  })
})

describe('reconcile — errores de red', () => {
  it('propaga el fallo sin dejar la base a medias', async () => {
    const boom = reconcile({
      db: handle.db,
      giveawayId,
      broadcasterId: BROADCASTER_ID,
      rules: DEFAULT_ENTRY_RULES,
      fetchSubscribers: vi.fn(async () => {
        throw new Error('Encountered HTTP status code 503')
      }),
    })

    await expect(boom).rejects.toThrow(/503/)
    expect(countEntries()).toBe(0)
  })
})
