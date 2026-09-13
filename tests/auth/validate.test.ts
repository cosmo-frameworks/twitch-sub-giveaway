import { InvalidTokenError } from '@twurple/auth'
import type { AccessTokenWithUserId } from '@twurple/auth'
import { describe, expect, it, vi } from 'vitest'

import { parseConfig } from '../../src/config.js'
import { AuthStatus, type AuthStatusSnapshot } from '../../src/auth/status.js'
import { TokenValidator, type TokenSource, type ValidatableTokenInfo } from '../../src/auth/validate.js'

const config = parseConfig({
  TWITCH_CLIENT_ID: 'client-id',
  TWITCH_CLIENT_SECRET: 'client-secret',
  TWITCH_BROADCASTER_LOGIN: 'elstreamer',
})

const token: AccessTokenWithUserId = {
  userId: '123456',
  accessToken: 'access-abc',
  refreshToken: 'refresh-def',
  scope: ['channel:read:subscriptions'],
  expiresIn: 14_400,
  obtainmentTimestamp: Date.now(),
}

const expiry = new Date('2030-01-01T00:00:00.000Z')

function validator(options: {
  getAccessTokenForUser?: TokenSource['getAccessTokenForUser']
  getTokenInfo?: (accessToken: string, clientId?: string) => Promise<ValidatableTokenInfo>
}): { validator: TokenValidator; status: AuthStatus; changes: AuthStatusSnapshot[] } {
  const status = new AuthStatus()
  const changes: AuthStatusSnapshot[] = []
  status.on('change', (s) => changes.push(s))

  return {
    status,
    changes,
    validator: new TokenValidator({
      config,
      status,
      userId: '123456',
      authProvider: {
        getAccessTokenForUser: options.getAccessTokenForUser ?? (async () => token),
      },
      deps: {
        getTokenInfo:
          options.getTokenInfo ??
          (async () => ({
            userId: '123456',
            scopes: ['channel:read:subscriptions'],
            expiryDate: expiry,
          })),
      },
    }),
  }
}

describe('TokenValidator.validateNow', () => {
  it('marca "ok" y publica la caducidad cuando el token es válido', async () => {
    const { validator: v, status } = validator({})
    const result = await v.validateNow()

    expect(result.state).toBe('ok')
    expect(result.expiresAt).toEqual(expiry)
    expect(status.current.state).toBe('ok')
  })

  it('pide el token con el scope requerido, lo que fuerza el refresco si toca', async () => {
    const spy = vi.fn(async () => token)
    const { validator: v } = validator({ getAccessTokenForUser: spy })
    await v.validateNow()

    expect(spy).toHaveBeenCalledWith('123456', ['channel:read:subscriptions'])
  })

  it('marca "revoked" si el proveedor no devuelve token', async () => {
    const { validator: v } = validator({ getAccessTokenForUser: async () => null })
    const result = await v.validateNow()

    expect(result.state).toBe('revoked')
    expect(result.detail).toMatch(/pnpm auth/)
  })

  // El streamer puede retirar el acceso desde twitch.tv/settings/connections.
  it('marca "revoked" ante un InvalidTokenError', async () => {
    const { validator: v } = validator({
      getTokenInfo: async () => {
        throw new InvalidTokenError()
      },
    })
    const result = await v.validateNow()

    expect(result.state).toBe('revoked')
    expect(result.detail).toMatch(/pnpm auth/)
  })

  it('marca "revoked" ante un 401 aunque no sea un InvalidTokenError', async () => {
    const { validator: v } = validator({
      getTokenInfo: async () => {
        throw new Error('HTTP 401 Unauthorized')
      },
    })
    expect((await v.validateNow()).state).toBe('revoked')
  })

  // Un corte de red no es una revocación: no hay que alarmar al streamer.
  it('marca "error" (no "revoked") ante un fallo transitorio', async () => {
    const { validator: v } = validator({
      getTokenInfo: async () => {
        throw new Error('getaddrinfo ENOTFOUND id.twitch.tv')
      },
    })
    const result = await v.validateNow()

    expect(result.state).toBe('error')
    expect(result.detail).toMatch(/reintentará/)
  })

  it('marca "revoked" si el token perdió el scope por el camino', async () => {
    const { validator: v } = validator({
      getTokenInfo: async () => ({ userId: '123456', scopes: ['user:read:email'], expiryDate: null }),
    })
    const result = await v.validateNow()

    expect(result.state).toBe('revoked')
    expect(result.detail).toMatch(/channel:read:subscriptions/)
  })

  it('no lanza nunca: siempre devuelve un resultado', async () => {
    const { validator: v } = validator({
      getAccessTokenForUser: async () => {
        throw new Error('boom')
      },
    })
    await expect(v.validateNow()).resolves.toMatchObject({ state: 'error' })
  })

  it('emite un único cambio de estado si se valida dos veces con el mismo resultado', async () => {
    const { validator: v, changes } = validator({})
    await v.validateNow()
    await v.validateNow()

    expect(changes).toHaveLength(1)
    expect(changes[0]?.state).toBe('ok')
  })
})

describe('TokenValidator.start / stop', () => {
  it('valida inmediatamente y luego reprograma', async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const { validator: v } = validator({
        getAccessTokenForUser: async () => {
          calls.push('check')
          return token
        },
      })

      await v.start()
      expect(calls).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(calls).toHaveLength(2)

      v.stop()
      await vi.advanceTimersByTimeAsync(3 * 60 * 60_000)
      expect(calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('AuthStatus', () => {
  it('conserva "since" mientras no cambie el estado', async () => {
    const status = new AuthStatus()
    status.set('ok', 'primera', expiry)
    const first = status.current.since

    status.set('ok', 'segunda', expiry)
    expect(status.current.since).toBe(first)

    status.set('revoked', 'fuera')
    expect(status.current.since).not.toBe(first)
  })
})
