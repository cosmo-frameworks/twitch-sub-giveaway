/**
 * Sin `Math.random()` ni librerías de PRNG: el sorteo tiene que poder rehacerse
 * delante de quien lo discuta, y con una librería haría falta esa misma versión.
 *
 *     valor(i) = primeros 8 bytes de SHA-256("<semilla>:<i>")  →  entero de 64 bits
 */

import { createHash, randomBytes } from 'node:crypto'

export function generateSeed(): string {
  return randomBytes(16).toString('hex')
}

export function seededValue(seed: string, index: number): bigint {
  const digest = createHash('sha256').update(`${seed}:${index}`, 'utf8').digest()
  return digest.readBigUInt64BE(0)
}

/**
 * Uniforme en `[0, max)` por rechazo, no por módulo: `valor % max` favorece a
 * los números bajos cuando `max` no divide a 2^64.
 */
export function seededInt(seed: string, index: number, max: bigint): bigint {
  if (max <= 0n) throw new RangeError('El rango del sorteo tiene que ser mayor que cero.')

  const range = 1n << 64n
  const limit = range - (range % max)

  for (let attempt = 0; attempt < 1000; attempt++) {
    const value = seededValue(seed, attempt === 0 ? index : index + attempt * 1_000_003)
    if (value < limit) return value % max
  }

  throw new Error('No se pudo generar un número dentro del rango del sorteo.')
}
