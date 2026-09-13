/**
 * Archivar un sorteo en mitad del directo.
 *
 * El flujo que se prueba es el del streamer: entrega el premio, archiva el
 * sorteo, y sigue emitiendo. Las papeletas que lleguen a partir de ese momento
 * tienen que caer en el sorteo nuevo.
 *
 * Antes no pasaba. El id del sorteo se resolvía una sola vez al conectar y
 * quedaba incrustado en el listener de EventSub, así que las papeletas seguían
 * yendo al sorteo archivado hasta que se reiniciaba la aplicación — y la propia
 * respuesta del API lo anunciaba con un `restartRequired: true`. Reiniciar en
 * mitad de un directo no es una opción.
 *
 * Esto reproduce la composición real de `app.ts`: resolver el sorteo abierto
 * EN CADA evento y meter ahí la papeleta.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import type { SubEvent } from '../../src/twitch/normalize.js'
import { openDb, type DbHandle } from '../../src/db/client.js'
import { processEvent, type EntryDraft } from '../../src/db/process-event.js'
import {
  closeGiveaway,
  createGiveaway,
  ensureOpenGiveaway,
  openNewGiveaway,
} from '../../src/db/repositories/giveaways.js'

let handle: DbHandle

beforeEach(() => {
  handle = openDb({ path: ':memory:' })
  createGiveaway(handle.db, { name: 'Sorteo de enero', openedAt: '2026-01-12T19:00:00.000Z' })
})

/** Lo que hace el listener con cada evento: resolver el sorteo y guardar. */
function llegaUnaPapeleta(messageId: string, userId: string): string {
  const { giveaway } = ensureOpenGiveaway(handle.db, {
    name: 'Sorteo de shakarzr',
    at: '2026-01-12T22:00:00.000Z',
  })

  const event: SubEvent = {
    messageId,
    type: 'sub',
    userId,
    login: `usuario${userId}`,
    displayName: `Usuario ${userId}`,
    tier: '1000',
    isGift: false,
    total: null,
    isAnonymous: false,
    occurredAt: new Date('2026-01-12T20:30:00.000Z'),
  }

  const draft: EntryDraft = {
    platform: 'twitch',
    userId,
    login: `usuario${userId}`,
    displayName: `Usuario ${userId}`,
    source: 'sub',
    tier: '1000',
    weight: 1,
    giftIndex: 0,
  }

  processEvent(handle.db, { giveawayId: giveaway.id, event, drafts: [draft] })
  return giveaway.id
}

const papeletasDe = (giveawayId: string): number =>
  (
    handle.sqlite
      .prepare('select count(*) as n from entries where giveaway_id = ?')
      .get(giveawayId) as { n: number }
  ).n

describe('archivar un sorteo sin reiniciar', () => {
  it('las papeletas nuevas van al sorteo nuevo, no al archivado', () => {
    const enero = llegaUnaPapeleta('msg-1', '111')

    // El streamer entrega el premio y archiva.
    const { opened, closed } = openNewGiveaway(handle.db, {
      name: 'Sorteo de febrero',
      at: '2026-02-01T19:00:00.000Z',
    })
    expect(closed?.id).toBe(enero)

    const destino = llegaUnaPapeleta('msg-2', '222')

    expect(destino).toBe(opened.id)
    expect(papeletasDe(enero)).toBe(1)
    expect(papeletasDe(opened.id)).toBe(1)
  })

  it('el sorteo archivado conserva sus papeletas intactas', () => {
    llegaUnaPapeleta('msg-1', '111')
    llegaUnaPapeleta('msg-2', '222')
    const enero = llegaUnaPapeleta('msg-3', '333')

    openNewGiveaway(handle.db, { name: 'Sorteo de febrero', at: '2026-02-01T19:00:00.000Z' })
    llegaUnaPapeleta('msg-4', '444')

    expect(papeletasDe(enero)).toBe(3)
  })

  /*
   * Cerrar sin abrir otro deja la casa sin sorteo. Lo peor que puede hacer este
   * programa es tirar la papeleta de alguien que se acaba de suscribir, así que
   * se abre uno en vez de perderla.
   */
  it('si no queda ninguno abierto, la papeleta abre uno en vez de perderse', () => {
    const enero = llegaUnaPapeleta('msg-1', '111')
    closeGiveaway(handle.db, enero, '2026-01-12T21:00:00.000Z')

    const destino = llegaUnaPapeleta('msg-2', '222')

    expect(destino).not.toBe(enero)
    expect(papeletasDe(destino)).toBe(1)
  })
})
