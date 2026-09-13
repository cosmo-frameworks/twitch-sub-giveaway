import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BUNDLED_CLIENT_ID, ConfigError, DEFAULT_ENTRY_RULES, parseConfig } from '../src/config.js'
import { DEFAULT_DB_FILENAME, TOKENS_FILENAME } from '../src/paths.js'

/** Carpeta de datos fija, para que los tests no dependan del sistema real. */
const DATA_DIR = join('/datos', 'twitch-sorteos')

const validEnv = {
  TWITCH_CLIENT_ID: 'abc123clientid',
  TWITCH_CLIENT_SECRET: 'shhh-secret',
  TWITCH_BROADCASTER_LOGIN: 'elstreamer',
}

describe('parseConfig', () => {
  it('acepta el mínimo obligatorio y aplica los defaults', () => {
    const config = parseConfig(validEnv, { defaultDataDir: DATA_DIR })

    expect(config.twitch.clientId).toBe('abc123clientid')
    expect(config.twitch.expectedBroadcasterLogin).toBe('elstreamer')
    expect(config.twitch.eventSubUrl).toBeUndefined()
    expect(config.server.port).toBe(3000)
    expect(config.logLevel).toBe('info')
  })

  it('deriva el redirect del OAuth a partir de PORT', () => {
    expect(parseConfig(validEnv).auth.redirectUri).toBe('http://localhost:3000/callback')
    expect(parseConfig({ ...validEnv, PORT: '4100' }).auth.redirectUri).toBe(
      'http://localhost:4100/callback',
    )
  })

  it('pide el scope channel:read:subscriptions', () => {
    expect(parseConfig(validEnv).auth.scopes).toContain('channel:read:subscriptions')
  })

  it('normaliza el login del canal a minúsculas', () => {
    const config = parseConfig({ ...validEnv, TWITCH_BROADCASTER_LOGIN: '  ElStreamer  ' })
    expect(config.twitch.expectedBroadcasterLogin).toBe('elstreamer')
  })

  /**
   * Ya no hay variables obligatorias.
   *
   * El client id va compilado, el secreto solo hace falta para el flujo por
   * navegador, y el canal es quien autorice. Es lo que permite que el cliente
   * final abra la aplicación sin tocar nada.
   */
  it('arranca sin ninguna variable de entorno', () => {
    const config = parseConfig({}, { defaultDataDir: DATA_DIR })

    expect(config.twitch.clientId).toBe(BUNDLED_CLIENT_ID)
    expect(config.twitch.clientSecret).toBeUndefined()
    expect(config.twitch.expectedBroadcasterLogin).toBeNull()
  })

  it('una variable presente pero inválida sigue fallando con mensaje claro', () => {
    try {
      parseConfig({ PORT: 'tresmil' })
      expect.unreachable('debería haber lanzado ConfigError')
    } catch (error) {
      expect((error as ConfigError).problems.join()).toContain('PORT')
      expect((error as ConfigError).message).toContain('.env.example')
    }
  })

  it('rechaza un login de canal con caracteres inválidos', () => {
    try {
      parseConfig({ ...validEnv, TWITCH_BROADCASTER_LOGIN: 'el streamer!' })
      expect.unreachable('debería haber lanzado ConfigError')
    } catch (error) {
      expect((error as ConfigError).problems.join()).toContain('login de Twitch válido')
    }
  })

  it('acepta la URL del mock del Twitch CLI y rechaza una que no sea websocket', () => {
    const config = parseConfig({ ...validEnv, TWITCH_WS_URL: 'ws://127.0.0.1:8080/ws' })
    expect(config.twitch.eventSubUrl).toBe('ws://127.0.0.1:8080/ws')

    try {
      parseConfig({ ...validEnv, TWITCH_WS_URL: 'http://127.0.0.1:8080/ws' })
      expect.unreachable('debería haber lanzado ConfigError')
    } catch (error) {
      expect((error as ConfigError).problems.join()).toContain('ws://')
    }
  })

  it('acumula todos los problemas en un solo error, no solo el primero', () => {
    try {
      parseConfig({ PORT: '99999', TWITCH_BROADCASTER_LOGIN: 'x', TWITCH_WS_URL: 'nope' })
      expect.unreachable('debería haber lanzado ConfigError')
    } catch (error) {
      expect((error as ConfigError).problems.length).toBeGreaterThan(1)
    }
  })

  it('valida también las reglas de entrada escritas en código', () => {
    expect(() =>
      parseConfig(validEnv, {
        rules: { ...DEFAULT_ENTRY_RULES, giftSent: { mode: 'per_gift', entries: 1 } },
      }),
    ).toThrow(ConfigError)
  })
})

describe('resolución de rutas', () => {
  const at = (env = {}, options = {}) =>
    parseConfig({ ...validEnv, ...env }, { defaultDataDir: DATA_DIR, ...options })

  it('sin configurar nada, todo va a la carpeta de datos del sistema', () => {
    const config = at()

    expect(config.dataDir).toBe(DATA_DIR)
    expect(config.db.path).toBe(join(DATA_DIR, DEFAULT_DB_FILENAME))
    expect(config.auth.tokensPath).toBe(join(DATA_DIR, TOKENS_FILENAME))
    expect(config.db.source).toBe('default')
  })

  it('usa la ruta que el streamer eligió en la app', () => {
    const config = at({}, { settings: { dbPath: 'D:/sorteos/enero.db' } })

    expect(config.db.path).toBe('D:/sorteos/enero.db')
    expect(config.db.source).toBe('settings')
  })

  it('DB_PATH gana a lo que el streamer eligió', () => {
    const config = at({ DB_PATH: '/tmp/prueba.db' }, { settings: { dbPath: 'D:/sorteos/enero.db' } })

    expect(config.db.path).toBe('/tmp/prueba.db')
    expect(config.db.source).toBe('env')
  })

  /**
   * Decisión deliberada: la base de datos se puede mover, los tokens no.
   * Son credenciales de Twitch y un selector de carpeta acabaría dejándolas en
   * el escritorio o en una carpeta sincronizada.
   */
  it('los tokens NO se mueven aunque settings.json lo pidiera', () => {
    const config = at(
      {},
      { settings: { dbPath: 'D:/sorteos/enero.db', tokensPath: 'D:/dropbox/tokens.json' } },
    )

    expect(config.auth.tokensPath).toBe(join(DATA_DIR, TOKENS_FILENAME))
  })

  it('TWITCH_SORTEOS_DATA_DIR mueve la carpeta entera', () => {
    const config = at({ TWITCH_SORTEOS_DATA_DIR: '/portable' })

    expect(config.dataDir).toBe('/portable')
    expect(config.db.path).toBe(join('/portable', DEFAULT_DB_FILENAME))
    expect(config.auth.tokensPath).toBe(join('/portable', TOKENS_FILENAME))
  })

  it('TOKENS_PATH sigue existiendo como override de desarrollo', () => {
    expect(at({ TOKENS_PATH: '/tmp/t.json' }).auth.tokensPath).toBe('/tmp/t.json')
  })

  // El problema original: una ruta relativa depende del directorio de arranque.
  it('las rutas por defecto son absolutas, no relativas al directorio de arranque', () => {
    const config = at()

    expect(config.db.path).not.toMatch(/^\.{1,2}[/\\]/)
    expect(config.auth.tokensPath).not.toMatch(/^\.{1,2}[/\\]/)
  })
})

describe('DEFAULT_ENTRY_RULES', () => {
  // Tabla de decisiones de la sección 2 del plan.
  it('coincide con los defaults acordados en el plan', () => {
    expect(DEFAULT_ENTRY_RULES).toEqual({
      // Sub normal: 1 entrada.
      sub: { entries: 1 },
      // Los resubs cuentan: 1 entrada.
      resub: { entries: 1 },
      // Gift bomb de N subs: N entradas para el regalador.
      giftSent: { mode: 'per_sub', entries: 1 },
      // El receptor de un sub regalado no entra.
      giftReceived: { entries: 0 },
      // Los gifts anónimos se descartan.
      anonymousGift: 'ignore',
      anonymousBucketUserId: '__anonymous__',
      // El tier no afecta al peso: todos valen 1.
      tierWeights: { '1000': 1, '2000': 1, '3000': 1 },
    })
  })
})
