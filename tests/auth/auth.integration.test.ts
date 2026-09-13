/**
 * Criterios de aceptación de la fase 1, de punta a punta contra el disco real:
 *
 *  1. Tras `pnpm auth`, reiniciar el proceso no pide volver a autorizar.
 *  2. Un token caducado se refresca solo — y el nuevo se persiste.
 *
 * Lo único falseado es la red (Twitch): el resto es el código de verdad,
 * escribiendo y leyendo un `tokens.json` en un directorio temporal.
 */

import { createServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AccessToken, RefreshingAuthProvider } from '@twurple/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseConfig, type AppConfig } from '../../src/config.js'
import { runOAuthFlow, type OAuthDeps } from '../../src/auth/oauth-server.js'
import { createAuthProvider } from '../../src/auth/provider.js'
import { AuthStatus } from '../../src/auth/status.js'
import { readToken, writeToken } from '../../src/auth/token-store.js'

let config: AppConfig

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo
      probe.close(() => resolve(port))
    })
  })
}

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'twitch-auth-'))
  config = parseConfig({
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_CLIENT_SECRET: 'client-secret',
    TWITCH_BROADCASTER_LOGIN: 'elstreamer',
    TOKENS_PATH: join(dir, 'tokens.json'),
    OAUTH_REDIRECT_URI: `http://localhost:${await freePort()}/callback`,
  })
})

/** Simula el `pnpm auth` completo: navegador incluido, Twitch falseado. */
async function runPnpmAuth(token: Partial<AccessToken> = {}): Promise<void> {
  const issued: AccessToken = {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    scope: ['channel:read:subscriptions'],
    expiresIn: 14_400,
    obtainmentTimestamp: Date.now(),
    ...token,
  }

  const deps: Partial<OAuthDeps> = {
    exchangeCode: async () => issued,
    getTokenInfo: async () => ({
      userId: '123456',
      userName: 'ElStreamer',
      scopes: ['channel:read:subscriptions'],
    }),
  }

  let resolveUrl!: (url: string) => void
  const urlReady = new Promise<string>((r) => {
    resolveUrl = r
  })

  const flow = runOAuthFlow({ config, deps, timeoutMs: 5_000, onAuthorizeUrl: resolveUrl })
  const state = new URL(await urlReady).searchParams.get('state') ?? ''
  await (await fetch(`${config.auth.redirectUri}?code=el-codigo&state=${state}`)).text()

  await writeToken(config.auth.tokensPath, await flow)
}

/**
 * Dispara el evento `onRefresh` de Twurple como lo haría un refresco real.
 * `emit` es `protected` en la clase base, de ahí el cast: lo que se comprueba
 * es nuestro handler, no el de Twurple.
 */
function simulateTwitchRefresh(
  authProvider: Awaited<ReturnType<typeof createAuthProvider>>['authProvider'],
  userId: string,
  token: AccessToken,
): void {
  const emitter = authProvider as unknown as {
    emit: (event: unknown, ...args: unknown[]) => void
  }
  emitter.emit((authProvider as RefreshingAuthProvider).onRefresh, userId, token)
}

describe('fase 1 — criterio 1: reiniciar no pide volver a autorizar', () => {
  it('arranca solo con lo que dejó "pnpm auth" en disco', async () => {
    await runPnpmAuth()

    // "Reinicio": nada en memoria, solo el fichero.
    const status = new AuthStatus()
    const auth = await createAuthProvider({ config, status })

    expect(auth.userId).toBe('123456')
    expect(auth.userLogin).toBe('ElStreamer')
    expect((auth.authProvider as RefreshingAuthProvider).hasUser('123456')).toBe(true)
    expect(status.current.state).not.toBe('unauthenticated')
  })

  it('sobrevive a varios reinicios seguidos', async () => {
    await runPnpmAuth()

    for (let i = 0; i < 3; i++) {
      const auth = await createAuthProvider({ config, status: new AuthStatus() })
      expect((auth.authProvider as RefreshingAuthProvider).hasUser('123456')).toBe(true)
    }
  })
})

describe('fase 1 — criterio 2: un token caducado se refresca solo', () => {
  it('persiste el token nuevo cuando Twurple lo refresca', async () => {
    await runPnpmAuth({ accessToken: 'access-1', refreshToken: 'refresh-1' })

    const auth = await createAuthProvider({ config, status: new AuthStatus() })

    const refreshed: AccessToken = {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      scope: ['channel:read:subscriptions'],
      expiresIn: 14_400,
      obtainmentTimestamp: Date.now(),
    }
    simulateTwitchRefresh(auth.authProvider, '123456', refreshed)

    // `onRefresh` escribe de forma asíncrona.
    await vi.waitFor(async () => {
      const onDisk = await readToken(config.auth.tokensPath)
      expect(onDisk?.accessToken).toBe('access-2')
    })

    const onDisk = await readToken(config.auth.tokensPath)
    expect(onDisk?.refreshToken).toBe('refresh-2')
    // El login no viene en el refresco: hay que conservar el que ya teníamos.
    expect(onDisk?.userLogin).toBe('ElStreamer')
    expect(onDisk?.userId).toBe('123456')
  })

  /**
   * Twitch invalida el refresh token anterior cada vez que se usa. Si no
   * persistiéramos el nuevo, el siguiente arranque intentaría refrescar con uno
   * ya muerto y el streamer tendría que re-autorizar — justo lo que el criterio
   * de aceptación prohíbe.
   */
  it('el siguiente arranque usa el refresh token rotado, no el original', async () => {
    await runPnpmAuth({ accessToken: 'access-1', refreshToken: 'refresh-1' })

    const auth = await createAuthProvider({ config, status: new AuthStatus() })
    simulateTwitchRefresh(auth.authProvider, '123456', {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      scope: ['channel:read:subscriptions'],
      expiresIn: 14_400,
      obtainmentTimestamp: Date.now(),
    })

    await vi.waitFor(async () => {
      expect((await readToken(config.auth.tokensPath))?.refreshToken).toBe('refresh-2')
    })

    const afterRestart = await readToken(config.auth.tokensPath)
    expect(afterRestart?.refreshToken).toBe('refresh-2')
    expect(afterRestart?.accessToken).toBe('access-2')
  })

  it('avisa por AuthStatus si el refresco se guarda mal', async () => {
    await runPnpmAuth()

    const status = new AuthStatus()
    const auth = await createAuthProvider({
      config,
      status,
      persist: async () => {
        throw new Error('disco lleno')
      },
    })

    simulateTwitchRefresh(auth.authProvider, '123456', {
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      scope: ['channel:read:subscriptions'],
      expiresIn: 14_400,
      obtainmentTimestamp: Date.now(),
    })

    await vi.waitFor(() => {
      expect(status.current.state).toBe('error')
      expect(status.current.detail).toMatch(/no se pudo guardar/)
    })
  })

  it('marca el token como revocado si el refresco falla', async () => {
    await runPnpmAuth()

    const status = new AuthStatus()
    const auth = await createAuthProvider({ config, status })

    const emitter = auth.authProvider as unknown as {
      emit: (event: unknown, ...args: unknown[]) => void
    }
    emitter.emit((auth.authProvider as RefreshingAuthProvider).onRefreshFailure, '123456', new Error('invalid refresh token'))

    expect(status.current.state).toBe('revoked')
    expect(status.current.detail).toMatch(/pnpm auth/)
  })
})
