import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { APP_DIR_NAME, appDataDir, resolveDataDir } from '../src/paths.js'

describe('appDataDir', () => {
  it('usa %APPDATA% en Windows', () => {
    const dir = appDataDir({
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\streamer\\AppData\\Roaming' },
      home: 'C:\\Users\\streamer',
    })
    expect(dir).toBe(join('C:\\Users\\streamer\\AppData\\Roaming', APP_DIR_NAME))
  })

  it('cae al Roaming del home si %APPDATA% no está definida', () => {
    const dir = appDataDir({ platform: 'win32', env: {}, home: 'C:\\Users\\streamer' })
    expect(dir).toBe(join('C:\\Users\\streamer', 'AppData', 'Roaming', APP_DIR_NAME))
  })

  it('usa Application Support en macOS', () => {
    const dir = appDataDir({ platform: 'darwin', env: {}, home: '/Users/streamer' })
    expect(dir).toBe(join('/Users/streamer', 'Library', 'Application Support', APP_DIR_NAME))
  })

  it('respeta XDG_DATA_HOME en Linux', () => {
    const dir = appDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data' }, home: '/home/s' })
    expect(dir).toBe(join('/data', APP_DIR_NAME))
  })

  it('usa ~/.local/share en Linux sin XDG_DATA_HOME', () => {
    const dir = appDataDir({ platform: 'linux', env: {}, home: '/home/streamer' })
    expect(dir).toBe(join('/home/streamer', '.local', 'share', APP_DIR_NAME))
  })

  // El motivo de todo esto: una ruta relativa depende del directorio de arranque,
  // y con un acceso directo o un .exe empaquetado ese directorio es impredecible.
  it('siempre devuelve una ruta absoluta', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const dir = appDataDir({ platform, env: {}, home: platform === 'win32' ? 'C:\\h' : '/h' })
      expect(dir).not.toMatch(/^\.{1,2}[/\\]/)
    }
  })

  it('sin argumentos usa el entorno real y no revienta', () => {
    expect(appDataDir()).toContain(APP_DIR_NAME)
  })
})

/**
 * El log de arranque se escribe antes de cargar la configuración, así que no
 * puede preguntarle a `config.dataDir` dónde va. Si esta función no mirara la
 * variable de entorno, una copia portable dejaría el log en `%APPDATA%` y la
 * base de datos en otro sitio: justo el log que hace falta para diagnosticar
 * esa copia acabaría en la carpeta equivocada.
 */
describe('resolveDataDir', () => {
  it('gana la variable de entorno', () => {
    expect(resolveDataDir({ TWITCH_SORTEOS_DATA_DIR: 'D:/portable' })).toBe('D:/portable')
  })

  it('le quita los espacios de los lados', () => {
    expect(resolveDataDir({ TWITCH_SORTEOS_DATA_DIR: '  D:/portable  ' })).toBe('D:/portable')
  })

  it('una variable vacía no cuenta: cae a la carpeta del sistema', () => {
    const conVacia = resolveDataDir({ TWITCH_SORTEOS_DATA_DIR: '   ', APPDATA: 'C:/datos' })
    const sinNada = resolveDataDir({ APPDATA: 'C:/datos' })

    expect(conVacia).toBe(sinNada)
  })
})
