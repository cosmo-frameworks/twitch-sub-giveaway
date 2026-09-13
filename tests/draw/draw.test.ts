/**
 * Tests del sorteo — escritos ANTES de la implementación.
 *
 * El criterio de la fase 7 es que dos ejecuciones con la misma semilla y las
 * mismas entradas den el mismo ganador. Eso no es un detalle técnico: es lo que
 * permite rehacer el sorteo delante de todo el mundo si alguien dice que hubo
 * tongo.
 */

import { describe, expect, it } from 'vitest'

import { draw, type DrawTicketT } from '../../src/draw/draw.js'

/** Genera N papeletas para un participante, como las guarda `entries`. */
function tickets(userId: string, count: number, weight = 1): DrawTicketT[] {
  return Array.from({ length: count }, (_, i) => ({
    entryId: `${userId}-${i}`,
    platform: 'twitch',
    userId,
    displayName: userId.toUpperCase(),
    weight,
  }))
}

const pool = [...tickets('ana', 5), ...tickets('bruno', 3), ...tickets('carla', 1)]

describe('criterio de aceptación · reproducibilidad', () => {
  it('la misma semilla y las mismas entradas dan el mismo ganador', () => {
    const uno = draw({ tickets: pool, winners: 1, seed: 'semilla-de-prueba' })
    const dos = draw({ tickets: pool, winners: 1, seed: 'semilla-de-prueba' })

    expect(uno.winners).toEqual(dos.winners)
    expect(uno.winners).toHaveLength(1)
  })

  it('se mantiene con varios ganadores', () => {
    const uno = draw({ tickets: pool, winners: 3, seed: 'otra-semilla' })
    const dos = draw({ tickets: pool, winners: 3, seed: 'otra-semilla' })

    expect(uno.winners.map((w) => w.userId)).toEqual(dos.winners.map((w) => w.userId))
  })

  it('semillas distintas pueden dar resultados distintos', () => {
    const resultados = new Set(
      Array.from({ length: 40 }, (_, i) => draw({ tickets: pool, winners: 1, seed: `s${i}` }).winners[0]?.userId),
    )
    // Con 9 papeletas repartidas entre 3, 40 semillas deberían tocar a más de uno.
    expect(resultados.size).toBeGreaterThan(1)
  })

  /**
   * El orden de las papeletas que llegan de la base de datos no puede cambiar
   * el resultado: si cambiara, reproducir el sorteo dependería de que el SELECT
   * devolviera las filas exactamente igual, y eso no está garantizado.
   */
  it('el resultado no depende del orden en que lleguen las papeletas', () => {
    const alReves = [...pool].reverse()
    const barajado = [pool[4], pool[0], pool[8], pool[2], pool[6], pool[1], pool[7], pool[3], pool[5]].filter(
      (t): t is DrawTicketT => t !== undefined,
    )

    const esperado = draw({ tickets: pool, winners: 2, seed: 'orden' }).winners
    expect(draw({ tickets: alReves, winners: 2, seed: 'orden' }).winners).toEqual(esperado)
    expect(draw({ tickets: barajado, winners: 2, seed: 'orden' }).winners).toEqual(esperado)
  })
})

describe('selección', () => {
  it('nadie gana dos veces en el mismo sorteo', () => {
    const result = draw({ tickets: pool, winners: 3, seed: 'x' })
    const ids = result.winners.map((w) => w.userId)

    expect(new Set(ids).size).toBe(3)
  })

  it('numera los puestos desde 1', () => {
    const result = draw({ tickets: pool, winners: 3, seed: 'x' })
    expect(result.winners.map((w) => w.position)).toEqual([1, 2, 3])
  })

  it('devuelve el nombre para mostrar del ganador', () => {
    const result = draw({ tickets: tickets('ana', 1), winners: 1, seed: 'x' })
    expect(result.winners[0]).toMatchObject({ userId: 'ana', displayName: 'ANA', platform: 'twitch' })
  })

  it('no puede sacar más ganadores que participantes', () => {
    const result = draw({ tickets: pool, winners: 10, seed: 'x' })
    expect(result.winners).toHaveLength(3)
  })

  it('con un solo participante, gana ese', () => {
    const result = draw({ tickets: tickets('ana', 7), winners: 1, seed: 'x' })
    expect(result.winners[0]?.userId).toBe('ana')
  })

  it('sin papeletas no hay ganadores, y no revienta', () => {
    const result = draw({ tickets: [], winners: 3, seed: 'x' })
    expect(result.winners).toEqual([])
  })

  it('guarda la semilla usada, que es lo que hace verificable el sorteo', () => {
    expect(draw({ tickets: pool, winners: 1, seed: 'la-semilla' }).seed).toBe('la-semilla')
  })
})

describe('probabilidad proporcional a las papeletas', () => {
  /**
   * Quien tiene más papeletas tiene que ganar más veces. Si esto fallara, todo
   * el modelo —una fila por papeleta— no serviría de nada.
   */
  it('quien tiene 9 de cada 10 papeletas gana la mayoría de las veces', () => {
    const desigual = [...tickets('mucho', 90), ...tickets('poco', 10)]

    let ganaMucho = 0
    for (let i = 0; i < 300; i++) {
      if (draw({ tickets: desigual, winners: 1, seed: `seed-${i}` }).winners[0]?.userId === 'mucho') {
        ganaMucho++
      }
    }

    // 90% esperado; se deja margen de sobra para no tener un test frágil.
    expect(ganaMucho).toBeGreaterThan(230)
    expect(ganaMucho).toBeLessThan(300)
  })

  it('el peso por tier cuenta igual que tener más papeletas', () => {
    // Una papeleta de peso 9 debe valer lo mismo que nueve de peso 1.
    const pesado = [...tickets('pesado', 1, 9), ...tickets('ligero', 1, 1)]

    let ganaPesado = 0
    for (let i = 0; i < 300; i++) {
      if (draw({ tickets: pesado, winners: 1, seed: `w-${i}` }).winners[0]?.userId === 'pesado') {
        ganaPesado++
      }
    }

    expect(ganaPesado).toBeGreaterThan(230)
  })

  it('ignora papeletas con peso cero o negativo en vez de romper el reparto', () => {
    const conBasura = [...tickets('ana', 1, 0), ...tickets('bruno', 1, 1)]
    expect(draw({ tickets: conBasura, winners: 1, seed: 'x' }).winners[0]?.userId).toBe('bruno')
  })
})

describe('excluir ganadores anteriores', () => {
  it('deja fuera a quien ya ganó', () => {
    const result = draw({
      tickets: pool,
      winners: 2,
      seed: 'x',
      exclude: [{ platform: 'twitch', userId: 'ana' }],
    })

    expect(result.winners.map((w) => w.userId)).not.toContain('ana')
    expect(result.winners).toHaveLength(2)
  })

  it('excluir a todos deja el sorteo vacío', () => {
    const result = draw({
      tickets: pool,
      winners: 1,
      seed: 'x',
      exclude: [
        { platform: 'twitch', userId: 'ana' },
        { platform: 'twitch', userId: 'bruno' },
        { platform: 'twitch', userId: 'carla' },
      ],
    })
    expect(result.winners).toEqual([])
  })

  it('la exclusión distingue plataformas', () => {
    const mezcla = [...tickets('ana', 1), { ...tickets('ana', 1)[0]!, platform: 'kick', entryId: 'k1' }]
    const result = draw({
      tickets: mezcla,
      winners: 2,
      seed: 'x',
      exclude: [{ platform: 'kick', userId: 'ana' }],
    })

    expect(result.winners).toHaveLength(1)
    expect(result.winners[0]?.platform).toBe('twitch')
  })
})

describe('contrato: función pura', () => {
  it('no modifica las papeletas que recibe', () => {
    const original = structuredClone(pool)
    draw({ tickets: pool, winners: 2, seed: 'x' })
    expect(pool).toEqual(original)
  })

  it('informa de cuántas papeletas y participantes entraron en el sorteo', () => {
    const result = draw({ tickets: pool, winners: 1, seed: 'x' })
    expect(result.pool).toEqual({ tickets: 9, weight: 9, participants: 3 })
  })

  it('el recuento del bote descuenta a los excluidos', () => {
    const result = draw({
      tickets: pool,
      winners: 1,
      seed: 'x',
      exclude: [{ platform: 'twitch', userId: 'ana' }],
    })
    expect(result.pool).toEqual({ tickets: 4, weight: 4, participants: 2 })
  })
})
