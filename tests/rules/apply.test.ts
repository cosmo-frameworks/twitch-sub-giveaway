/**
 * Tests del motor de reglas — escritos ANTES de la implementación.
 *
 * Cubren fila por fila la tabla de la sección 5 del plan, más las dos trampas
 * que más caro salen en directo: el doble conteo del gift bomb (§6.2) y los
 * regalos anónimos.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_ENTRY_RULES, type EntryRules } from '../../src/config.js'
import type { SubEvent } from '../../src/twitch/normalize.js'
import { applyRules } from '../../src/rules/apply.js'

const at = new Date('2026-09-13T20:30:00.000Z')

const base: SubEvent = {
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
}

const subEvent = (over: Partial<SubEvent> = {}): SubEvent => ({ ...base, ...over })

const giftEvent = (over: Partial<SubEvent> = {}): SubEvent => ({
  ...base,
  type: 'gift',
  userId: '222',
  login: 'generosa',
  displayName: 'Generosa',
  tier: '2000',
  isGift: true,
  total: 5,
  ...over,
})

const resubEvent = (over: Partial<SubEvent> = {}): SubEvent => ({
  ...base,
  type: 'resub',
  userId: '333',
  login: 'fiel',
  displayName: 'Fiel',
  tier: '3000',
  ...over,
})

const rules = (over: Partial<EntryRules> = {}): EntryRules => ({ ...DEFAULT_ENTRY_RULES, ...over })

describe('§5 · channel.subscribe (is_gift = false) → 1 entrada al suscriptor', () => {
  it('genera una entrada con source "sub"', () => {
    const drafts = applyRules(subEvent(), DEFAULT_ENTRY_RULES)

    expect(drafts).toEqual([
      {
        platform: 'twitch',
        userId: '111',
        login: 'pepito',
        displayName: 'Pepito',
        source: 'sub',
        tier: '1000',
        weight: 1,
        giftIndex: 0,
      },
    ])
  })

  it('respeta que se configuren más entradas por sub', () => {
    const drafts = applyRules(subEvent(), rules({ sub: { entries: 3 } }))

    expect(drafts).toHaveLength(3)
    expect(drafts.map((d) => d.giftIndex)).toEqual([0, 1, 2])
    expect(drafts.every((d) => d.source === 'sub')).toBe(true)
  })

  it('no genera nada si los subs están desactivados', () => {
    expect(applyRules(subEvent(), rules({ sub: { entries: 0 } }))).toEqual([])
  })
})

describe('§5 · channel.subscribe (is_gift = true) → 0 entradas por defecto', () => {
  it('el receptor de un sub regalado no entra', () => {
    expect(applyRules(subEvent({ isGift: true }), DEFAULT_ENTRY_RULES)).toEqual([])
  })

  it('si se activa, entra el receptor con source "gift_received"', () => {
    const drafts = applyRules(
      subEvent({ isGift: true }),
      rules({ giftReceived: { entries: 1 } }),
    )

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ userId: '111', source: 'gift_received' })
  })
})

describe('§5 · channel.subscription.gift → `total` entradas al regalador', () => {
  it('un regalo de 5 genera 5 entradas para el regalador', () => {
    const drafts = applyRules(giftEvent({ total: 5 }), DEFAULT_ENTRY_RULES)

    expect(drafts).toHaveLength(5)
    expect(drafts.every((d) => d.userId === '222')).toBe(true)
    expect(drafts.every((d) => d.source === 'gift_sent')).toBe(true)
    expect(drafts.map((d) => d.giftIndex)).toEqual([0, 1, 2, 3, 4])
  })

  it('un gift bomb de 20 genera 20 entradas', () => {
    const drafts = applyRules(giftEvent({ total: 20 }), DEFAULT_ENTRY_RULES)

    expect(drafts).toHaveLength(20)
    expect(drafts.map((d) => d.giftIndex)).toEqual([...Array(20).keys()])
  })

  it('en modo "fixed" da igual cuántos subs se regalen', () => {
    const fixed = rules({ giftSent: { mode: 'fixed', entries: 1 } })

    expect(applyRules(giftEvent({ total: 20 }), fixed)).toHaveLength(1)
    expect(applyRules(giftEvent({ total: 1 }), fixed)).toHaveLength(1)
  })

  it('multiplica entradas por sub en modo "per_sub"', () => {
    const drafts = applyRules(
      giftEvent({ total: 3 }),
      rules({ giftSent: { mode: 'per_sub', entries: 2 } }),
    )
    expect(drafts).toHaveLength(6)
  })

  it('no revienta si Twitch no manda total', () => {
    expect(applyRules(giftEvent({ total: null }), DEFAULT_ENTRY_RULES)).toEqual([])
  })
})

describe('§5 · channel.subscription.gift con is_anonymous = true', () => {
  /** Twitch manda gifter_id/login/name a null: no hay a quién premiar. */
  it('se descarta por defecto', () => {
    const drafts = applyRules(
      giftEvent({ isAnonymous: true, userId: null, login: null, displayName: null }),
      DEFAULT_ENTRY_RULES,
    )
    expect(drafts).toEqual([])
  })

  it('con anonymousGift = "bucket" acumula en un participante sintético', () => {
    const drafts = applyRules(
      giftEvent({ total: 3, isAnonymous: true, userId: null, login: null, displayName: null }),
      rules({ anonymousGift: 'bucket' }),
    )

    expect(drafts).toHaveLength(3)
    expect(drafts.every((d) => d.userId === DEFAULT_ENTRY_RULES.anonymousBucketUserId)).toBe(true)
    expect(drafts.every((d) => d.source === 'gift_sent')).toBe(true)
  })

  it('nunca deja un userId nulo: eso rompería la clave ajena de entries', () => {
    const drafts = applyRules(
      giftEvent({ isAnonymous: true, userId: null, login: null, displayName: null }),
      rules({ anonymousGift: 'bucket' }),
    )
    expect(drafts.every((d) => typeof d.userId === 'string' && d.userId.length > 0)).toBe(true)
  })
})

describe('§5 · channel.subscription.message (resub) → 1 entrada', () => {
  it('genera una entrada con source "resub"', () => {
    const drafts = applyRules(resubEvent(), DEFAULT_ENTRY_RULES)

    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ userId: '333', source: 'resub', tier: '3000' })
  })

  it('no genera nada si los resubs no cuentan', () => {
    expect(applyRules(resubEvent(), rules({ resub: { entries: 0 } }))).toEqual([])
  })
})

describe('criterio de aceptación · gift bomb de 5 sin doble conteo', () => {
  /**
   * Trampa 2 de la sección 6: Twitch dispara 1 `channel.subscription.gift` con
   * el total Y 5 `channel.subscribe` con `is_gift: true`, uno por receptor.
   * Sumar los dos duplicaría. El listener entrega los 6 eventos; es aquí donde
   * se filtran.
   */
  it('5 entradas para el regalador y 0 para los receptores, con los 6 eventos', () => {
    const gift = giftEvent({ messageId: 'msg-gift', total: 5 })
    const receptores = Array.from({ length: 5 }, (_, i) =>
      subEvent({
        messageId: `msg-sub-${i}`,
        userId: `90${i}`,
        login: `recept${i}`,
        displayName: `Receptor${i}`,
        isGift: true,
        tier: '2000',
      }),
    )

    const todos = [gift, ...receptores].flatMap((e) => applyRules(e, DEFAULT_ENTRY_RULES))

    expect(todos).toHaveLength(5)
    expect(todos.every((d) => d.userId === '222')).toBe(true)
    expect(todos.every((d) => d.source === 'gift_sent')).toBe(true)

    // Ningún receptor recibe papeleta.
    for (const r of receptores) {
      expect(applyRules(r, DEFAULT_ENTRY_RULES)).toEqual([])
    }
  })
})

describe('tier y peso', () => {
  /** El tier se GUARDA siempre aunque no afecte al peso (sección 5). */
  it('conserva el tier con los pesos por defecto', () => {
    for (const tier of ['1000', '2000', '3000'] as const) {
      const [draft] = applyRules(subEvent({ tier }), DEFAULT_ENTRY_RULES)
      expect(draft?.tier).toBe(tier)
      expect(draft?.weight).toBe(1)
    }
  })

  it('aplica pesos por tier si se configuran', () => {
    const pesado = rules({ tierWeights: { '1000': 1, '2000': 2, '3000': 5 } })

    expect(applyRules(subEvent({ tier: '1000' }), pesado)[0]?.weight).toBe(1)
    expect(applyRules(subEvent({ tier: '2000' }), pesado)[0]?.weight).toBe(2)
    expect(applyRules(subEvent({ tier: '3000' }), pesado)[0]?.weight).toBe(5)
  })

  it('el peso se aplica a todas las papeletas de un gift bomb', () => {
    const drafts = applyRules(
      giftEvent({ total: 3, tier: '3000' }),
      rules({ tierWeights: { '1000': 1, '2000': 2, '3000': 5 } }),
    )
    expect(drafts.map((d) => d.weight)).toEqual([5, 5, 5])
  })
})

describe('applyRules es pura', () => {
  it('dos llamadas con la misma entrada dan el mismo resultado', () => {
    const event = giftEvent({ total: 4 })
    expect(applyRules(event, DEFAULT_ENTRY_RULES)).toEqual(applyRules(event, DEFAULT_ENTRY_RULES))
  })

  it('no modifica ni el evento ni las reglas', () => {
    const event = giftEvent({ total: 4 })
    const snapshotEvent = structuredClone({ ...event, occurredAt: event.occurredAt.toISOString() })
    const snapshotRules = structuredClone(DEFAULT_ENTRY_RULES)

    applyRules(event, DEFAULT_ENTRY_RULES)

    expect({ ...event, occurredAt: event.occurredAt.toISOString() }).toEqual(snapshotEvent)
    expect(DEFAULT_ENTRY_RULES).toEqual(snapshotRules)
  })
})

describe('casos límite', () => {
  it('descarta un evento sin usuario que no sea anónimo', () => {
    expect(applyRules(subEvent({ userId: null }), DEFAULT_ENTRY_RULES)).toEqual([])
  })

  it('usa el login si Twitch no manda nombre para mostrar', () => {
    const [draft] = applyRules(subEvent({ displayName: null }), DEFAULT_ENTRY_RULES)
    expect(draft?.displayName).toBe('pepito')
  })

  /**
   * `total` sale de Twitch. Un valor absurdo no puede convertirse en millones
   * de inserciones en mitad de un directo.
   */
  it('limita cuántas papeletas puede generar un solo evento', () => {
    const drafts = applyRules(giftEvent({ total: 10_000_000 }), DEFAULT_ENTRY_RULES)
    expect(drafts.length).toBeLessThanOrEqual(1000)
  })
})
