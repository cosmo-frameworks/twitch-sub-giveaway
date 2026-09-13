import { describe, expect, it } from 'vitest'

import {
  formatSubEvent,
  normalizeGift,
  normalizeResub,
  normalizeSubscribe,
  type RawGiftEvent,
  type RawResubEvent,
  type RawSubscribeEvent,
} from '../../src/twitch/normalize.js'

const at = new Date('2026-09-13T20:30:00.000Z')

const subscribe: RawSubscribeEvent = {
  userId: '111',
  userName: 'pepito',
  userDisplayName: 'Pepito',
  tier: '1000',
  isGift: false,
}

const gift: RawGiftEvent = {
  gifterId: '222',
  gifterName: 'generosa',
  gifterDisplayName: 'Generosa',
  amount: 5,
  tier: '2000',
  isAnonymous: false,
}

const resub: RawResubEvent = {
  userId: '333',
  userName: 'fiel',
  userDisplayName: 'Fiel',
  tier: '3000',
  cumulativeMonths: 12,
}

describe('normalizeSubscribe', () => {
  it('normaliza una suscripción nueva', () => {
    expect(normalizeSubscribe(subscribe, 'msg-1', at)).toEqual({
      messageId: 'msg-1',
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
  })

  /**
   * Trampa 2 de la sección 6: en un gift bomb de N subs, Twitch dispara N veces
   * `channel.subscribe` con `is_gift: true` (uno por receptor) ADEMÁS del
   * `channel.subscription.gift` con el total. Aquí solo se marca; quien decide
   * qué hacer con ello es el motor de reglas de la fase 4.
   */
  it('marca isGift en el sub regalado, sin descartarlo todavía', () => {
    const event = normalizeSubscribe({ ...subscribe, isGift: true }, 'msg-2', at)

    expect(event.isGift).toBe(true)
    expect(event.type).toBe('sub')
    // El receptor sí se conoce; lo que no se sabe es quién se lo regaló.
    expect(event.userId).toBe('111')
  })

  it('conserva el tier aunque no afecte al peso', () => {
    expect(normalizeSubscribe({ ...subscribe, tier: '3000' }, 'm', at).tier).toBe('3000')
  })
})

describe('normalizeGift', () => {
  it('normaliza un regalo y guarda el total', () => {
    expect(normalizeGift(gift, 'msg-3', at)).toEqual({
      messageId: 'msg-3',
      type: 'gift',
      userId: '222',
      login: 'generosa',
      displayName: 'Generosa',
      tier: '2000',
      isGift: true,
      total: 5,
      isAnonymous: false,
      occurredAt: at,
    })
  })

  it('un gift bomb de 20 conserva el total', () => {
    expect(normalizeGift({ ...gift, amount: 20 }, 'm', at).total).toBe(20)
  })

  /**
   * Con `is_anonymous: true`, Twitch manda gifter_id/login/name a null.
   * Verificado en dev.twitch.tv/docs/eventsub/eventsub-subscription-types
   */
  it('deja el regalador a null si el regalo es anónimo', () => {
    const event = normalizeGift(
      { ...gift, gifterId: null, gifterName: null, gifterDisplayName: null, isAnonymous: true },
      'msg-4',
      at,
    )

    expect(event.isAnonymous).toBe(true)
    expect(event.userId).toBeNull()
    expect(event.login).toBeNull()
    expect(event.displayName).toBeNull()
    // El total sigue siendo información útil para el log.
    expect(event.total).toBe(5)
  })

  /**
   * `channel.subscription.gift` NO dice quién recibió los subs (trampa 4).
   * Si alguna vez aparece un campo de receptor en SubEvent, es que alguien
   * intentó correlacionar eventos por timestamp; el plan lo prohíbe.
   */
  it('no inventa el receptor del regalo', () => {
    expect(Object.keys(normalizeGift(gift, 'm', at))).not.toContain('recipientId')
  })
})

describe('normalizeResub', () => {
  it('normaliza una renovación', () => {
    expect(normalizeResub(resub, 'msg-5', at)).toEqual({
      messageId: 'msg-5',
      type: 'resub',
      userId: '333',
      login: 'fiel',
      displayName: 'Fiel',
      tier: '3000',
      isGift: false,
      total: null,
      isAnonymous: false,
      occurredAt: at,
    })
  })
})

describe('formatSubEvent', () => {
  // Criterio de aceptación de la fase 2: el messageId tiene que verse.
  it('enseña el messageId, el tipo y quién entra', () => {
    const line = formatSubEvent(normalizeGift(gift, 'msg-abc', at))

    expect(line).toContain('msg-abc')
    expect(line).toContain('gift')
    expect(line).toContain('Generosa')
    expect(line).toContain('x5')
  })

  it('deja claro que un sub regalado es regalado', () => {
    const line = formatSubEvent(normalizeSubscribe({ ...subscribe, isGift: true }, 'm', at))
    expect(line).toMatch(/regalad|gift/i)
  })

  it('dice "anónimo" cuando no hay a quién premiar', () => {
    const line = formatSubEvent(
      normalizeGift(
        { ...gift, gifterId: null, gifterName: null, gifterDisplayName: null, isAnonymous: true },
        'm',
        at,
      ),
    )
    expect(line).toMatch(/anónimo/i)
  })
})
