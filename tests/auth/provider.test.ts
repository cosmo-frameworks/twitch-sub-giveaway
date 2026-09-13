import type { RefreshingAuthProvider } from '@twurple/auth'
import { describe, expect, it, vi } from 'vitest'

import { parseConfig } from '../../src/config.js'
import { createAuthProvider, MissingTokenError } from '../../src/auth/provider.js'
import { AuthStatus } from '../../src/auth/status.js'
import type { StoredToken } from '../../src/auth/token-store.js'

const config = parseConfig({
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
  TWITCH_BROADCASTER_LOGIN: 'elstreamer',
})

const stored: StoredToken = {
  userId: '123456',
  userLogin: 'elstreamer',
  accessToken: 'access-abc',
  refreshToken: 'refresh-def',
  scope: ['channel:read:subscriptions'],
  expiresIn: 14_400,
  obtainmentTimestamp: Date.now(),
  grant: 'authorization_code',
}

describe('createAuthProvider', () => {
  it('carga el token guardado y registra al streamer', async () => {
    const status = new AuthStatus()
    const auth = await createAuthProvider({
      config,
      status,
      load: async () => stored,
      persist: async () => undefined,
    })

    expect(auth.userId).toBe('123456')
    expect(auth.userLogin).toBe('elstreamer')
    expect((auth.authProvider as RefreshingAuthProvider).hasUser('123456')).toBe(true)
    expect(auth.authProvider.clientId).toBe('client-id')
  })

  // Criterio de aceptación: reiniciar no debe pedir volver a autorizar.
  it('no necesita ningún flujo interactivo si ya hay token', async () => {
    const status = new AuthStatus()
    const load = vi.fn(async () => stored)

    await createAuthProvider({ config, status, load, persist: async () => undefined })

    expect(load).toHaveBeenCalledWith(config.auth.tokensPath)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('explica que hay que ejecutar "pnpm auth" si no hay token', async () => {
    const status = new AuthStatus()

    await expect(
      createAuthProvider({ config, status, load: async () => null, persist: async () => undefined }),
    ).rejects.toThrow(MissingTokenError)

    expect(status.current.state).toBe('unauthenticated')
  })

  it('deja el mensaje con la ruta del fichero de tokens', async () => {
    const status = new AuthStatus()
    await expect(
      createAuthProvider({ config, status, load: async () => null, persist: async () => undefined }),
    ).rejects.toThrow(/tokens\.json[\s\S]*pnpm auth/)
  })

  it('registra los scopes del token guardado', async () => {
    const status = new AuthStatus()
    const auth = await createAuthProvider({
      config,
      status,
      load: async () => stored,
      persist: async () => undefined,
    })

    expect(auth.authProvider.getCurrentScopesForUser('123456')).toEqual([
      'channel:read:subscriptions',
    ])
  })
})
