import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { readSettings, SettingsError, SETTINGS_FILENAME, writeSettings } from '../src/settings.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'twitch-settings-'))
})

describe('readSettings', () => {
  it('devuelve ajustes vacíos en el primer arranque', async () => {
    expect(await readSettings(dir)).toEqual({})
  })

  it('recupera lo que escribió la app', async () => {
    await writeSettings(dir, { dbPath: join(dir, 'sorteos.db') })
    expect(await readSettings(dir)).toEqual({ dbPath: join(dir, 'sorteos.db') })
  })

  it('guarda la ruta como absoluta aunque le pasen una relativa', async () => {
    await writeSettings(dir, { dbPath: './mis-sorteos.db' })
    const { dbPath } = await readSettings(dir)
    expect(dbPath).toBeDefined()
    expect(isAbsolute(dbPath as string)).toBe(true)
  })

  /**
   * Si los ajustes están corruptos NO se puede seguir con la ruta por defecto:
   * apuntaríamos a una base vacía y el streamer vería su lista de sorteos a cero
   * sin ningún aviso. Mejor fallar y que se vea.
   */
  it('falla si el fichero está corrupto, en vez de caer a la ruta por defecto', async () => {
    await writeFile(join(dir, SETTINGS_FILENAME), '{ roto')
    await expect(readSettings(dir)).rejects.toThrow(SettingsError)
  })

  it('falla si dbPath no es un texto válido', async () => {
    await writeFile(join(dir, SETTINGS_FILENAME), JSON.stringify({ dbPath: 42 }))
    await expect(readSettings(dir)).rejects.toThrow(SettingsError)
  })

  it('ignora claves que no conoce, para poder añadir ajustes sin romper versiones viejas', async () => {
    await writeFile(join(dir, SETTINGS_FILENAME), JSON.stringify({ dbPath: '/x/y.db', futuro: 1 }))
    await expect(readSettings(dir)).resolves.toMatchObject({ dbPath: '/x/y.db' })
  })
})

describe('writeSettings', () => {
  it('crea la carpeta de datos si no existe', async () => {
    const nested = join(dir, 'no', 'existe')
    await writeSettings(nested, { dbPath: '/x/y.db' })
    expect(await readSettings(nested)).toEqual({ dbPath: '/x/y.db' })
  })

  it('borrar dbPath vuelve a la ruta por defecto', async () => {
    await writeSettings(dir, { dbPath: '/x/y.db' })
    await writeSettings(dir, {})
    expect(await readSettings(dir)).toEqual({})
  })
})
