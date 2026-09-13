import process from 'node:process'

import { describe, expect, it } from 'vitest'

import { withRealTwitch } from '../../src/auth/real-twitch.js'

describe('withRealTwitch', () => {
  /**
   * TWURPLE_MOCK_API_PORT hace falta para probar el listener contra el mock del
   * Twitch CLI, pero Twurple la usa para TODAS sus peticiones — incluido el
   * canje del código OAuth, que acabaría en http://localhost:<puerto>/auth/token
   * y devolvería 404. El mock tampoco puede emitir un token válido para el canal
   * real, así que el OAuth nunca debe pasar por ahí.
   */
  it('quita TWURPLE_MOCK_API_PORT mientras dura la llamada', async () => {
    process.env.TWURPLE_MOCK_API_PORT = '8080'
    try {
      let seen: string | undefined = 'todavía no'
      await withRealTwitch(async () => {
        seen = process.env.TWURPLE_MOCK_API_PORT
      })

      expect(seen).toBeUndefined()
      // Restaurada: el listener sigue necesitándola.
      expect(process.env.TWURPLE_MOCK_API_PORT).toBe('8080')
    } finally {
      delete process.env.TWURPLE_MOCK_API_PORT
    }
  })

  it('la restaura aunque la llamada falle', async () => {
    process.env.TWURPLE_MOCK_API_PORT = '8080'
    try {
      await expect(
        withRealTwitch(async () => {
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')

      expect(process.env.TWURPLE_MOCK_API_PORT).toBe('8080')
    } finally {
      delete process.env.TWURPLE_MOCK_API_PORT
    }
  })

  it('no toca nada si la variable no estaba puesta', async () => {
    delete process.env.TWURPLE_MOCK_API_PORT
    await withRealTwitch(async () => undefined)
    expect('TWURPLE_MOCK_API_PORT' in process.env).toBe(false)
  })
})
