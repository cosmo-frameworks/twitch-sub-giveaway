/**
 * El archivo de sorteos.
 *
 * Lo que se prueba aquí es que las cifras de cada sorteo son las suyas. La
 * forma obvia de escribir esta consulta —un LEFT JOIN a papeletas y otro a
 * ganadores en la misma sentencia— multiplica las filas de una tabla por las de
 * la otra, y un sorteo con 10 papeletas y 2 ganadores pasa a contar 20
 * papeletas. Por eso hay un test dedicado a ese caso concreto.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { openDb, type DbHandle } from '../../../src/db/client.js'
import { entries, participants, winners } from '../../../src/db/schema.js'
import {
  closeGiveaway,
  createGiveaway,
  ensureOpenGiveaway,
  listGiveawaysWithTotals,
} from '../../../src/db/repositories/giveaways.js'

let handle: DbHandle

beforeEach(() => {
  handle = openDb({ path: ':memory:' })
})

/** Da de alta a alguien y le mete `count` papeletas en un sorteo. */
function addEntries(giveawayId: string, userId: string, count: number): void {
  handle.db
    .insert(participants)
    .values({
      platform: 'twitch',
      userId,
      login: `usuario${userId}`,
      displayName: `Usuario ${userId}`,
      firstSeenAt: '2026-01-12T19:00:00.000Z',
      lastSeenAt: '2026-01-12T19:30:00.000Z',
    })
    .onConflictDoNothing()
    .run()

  for (let i = 0; i < count; i += 1) {
    handle.db
      .insert(entries)
      .values({
        id: `${giveawayId}-${userId}-${i}`,
        giveawayId,
        platform: 'twitch',
        userId,
        source: 'sub',
        weight: 1,
        giftIndex: i,
        occurredAt: '2026-01-12T19:30:00.000Z',
      })
      .run()
  }
}

function addWinner(giveawayId: string, userId: string, position: number): void {
  handle.db
    .insert(winners)
    .values({
      id: `${giveawayId}-w${position}`,
      giveawayId,
      platform: 'twitch',
      userId,
      position,
      seed: 'semilla',
      drawnAt: '2026-01-12T21:00:00.000Z',
    })
    .run()
}

describe('listGiveawaysWithTotals', () => {
  it('devuelve los sorteos del más reciente al más antiguo', () => {
    createGiveaway(handle.db, { name: 'Enero', openedAt: '2026-01-12T19:00:00.000Z' })
    createGiveaway(handle.db, { name: 'Marzo', openedAt: '2026-03-02T19:00:00.000Z' })
    createGiveaway(handle.db, { name: 'Febrero', openedAt: '2026-02-01T19:00:00.000Z' })

    expect(listGiveawaysWithTotals(handle.db).map((g) => g.name)).toEqual([
      'Marzo',
      'Febrero',
      'Enero',
    ])
  })

  it('cuenta papeletas, participantes y ganadores de cada sorteo', () => {
    const sorteo = createGiveaway(handle.db, {
      name: 'Enero',
      openedAt: '2026-01-12T19:00:00.000Z',
    })

    addEntries(sorteo.id, '111', 3)
    addEntries(sorteo.id, '222', 2)
    addWinner(sorteo.id, '111', 1)

    const [fila] = listGiveawaysWithTotals(handle.db)

    expect(fila).toMatchObject({
      name: 'Enero',
      entries: 5,
      participants: 2,
      winners: 1,
    })
  })

  /* El fallo que provoca unir las dos tablas en una sola consulta. */
  it('no multiplica las papeletas por el número de ganadores', () => {
    const sorteo = createGiveaway(handle.db, {
      name: 'Con varios ganadores',
      openedAt: '2026-01-12T19:00:00.000Z',
    })

    addEntries(sorteo.id, '111', 10)
    addWinner(sorteo.id, '111', 1)
    addWinner(sorteo.id, '111', 2)
    addWinner(sorteo.id, '111', 3)

    const [fila] = listGiveawaysWithTotals(handle.db)

    expect(fila?.entries).toBe(10)
    expect(fila?.winners).toBe(3)
  })

  it('no mezcla las cifras de un sorteo con las de otro', () => {
    const enero = createGiveaway(handle.db, { name: 'Enero', openedAt: '2026-01-01T19:00:00.000Z' })
    const marzo = createGiveaway(handle.db, { name: 'Marzo', openedAt: '2026-03-01T19:00:00.000Z' })

    addEntries(enero.id, '111', 4)
    addEntries(marzo.id, '222', 1)
    addWinner(marzo.id, '222', 1)

    const porNombre = Object.fromEntries(
      listGiveawaysWithTotals(handle.db).map((g) => [g.name, g]),
    )

    expect(porNombre['Enero']).toMatchObject({ entries: 4, participants: 1, winners: 0 })
    expect(porNombre['Marzo']).toMatchObject({ entries: 1, participants: 1, winners: 1 })
  })

  it('un sorteo sin papeletas sale con ceros, no desaparece de la lista', () => {
    createGiveaway(handle.db, { name: 'Vacío', openedAt: '2026-01-12T19:00:00.000Z' })

    expect(listGiveawaysWithTotals(handle.db)).toEqual([
      expect.objectContaining({ name: 'Vacío', entries: 0, participants: 0, winners: 0 }),
    ])
  })
})

/**
 * El camino de las papeletas en directo no puede quedarse sin sorteo donde
 * escribir. Si alguien cierra el último y se suscribe un espectador, esa
 * papeleta tiene que ir a algún sitio.
 */
describe('ensureOpenGiveaway', () => {
  const ahora = { name: 'Sorteo de shakarzr', at: '2026-01-12T19:00:00.000Z' }

  it('devuelve el que ya está abierto sin crear otro', () => {
    const abierto = createGiveaway(handle.db, {
      name: 'Enero',
      openedAt: '2026-01-01T19:00:00.000Z',
    })

    const resultado = ensureOpenGiveaway(handle.db, ahora)

    expect(resultado).toEqual({ giveaway: abierto, created: false })
    expect(listGiveawaysWithTotals(handle.db)).toHaveLength(1)
  })

  it('abre uno si no queda ninguno abierto', () => {
    const cerrado = createGiveaway(handle.db, {
      name: 'Enero',
      openedAt: '2026-01-01T19:00:00.000Z',
    })
    closeGiveaway(handle.db, cerrado.id, '2026-01-01T21:00:00.000Z')

    const resultado = ensureOpenGiveaway(handle.db, ahora)

    expect(resultado.created).toBe(true)
    expect(resultado.giveaway.name).toBe('Sorteo de shakarzr')
    expect(resultado.giveaway.status).toBe('open')
    // El cerrado sigue ahí: abrir uno nuevo no borra el archivo.
    expect(listGiveawaysWithTotals(handle.db)).toHaveLength(2)
  })

  it('abre uno cuando la base está vacía', () => {
    expect(ensureOpenGiveaway(handle.db, ahora).created).toBe(true)
  })
})
