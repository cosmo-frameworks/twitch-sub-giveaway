import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describe, expect, it } from 'vitest'

import { parseConfig, type AppConfig } from '../../src/config.js'
import { AuthError, buildAuthorizeUrl, runOAuthFlow, type OAuthDeps } from '../../src/auth/oauth-server.js'

/** Pide al SO un puerto libre y lo suelta. */
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

function configFor(port: number): AppConfig {
  return parseConfig({
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_CLIENT_SECRET: 'client-secret',
    TWITCH_BROADCASTER_LOGIN: 'elstreamer',
    OAUTH_REDIRECT_URI: `http://localhost:${port}/callback`,
  })
}

const accessToken = {
  accessToken: 'access-abc',
  refreshToken: 'refresh-def',
  scope: ['channel:read:subscriptions'],
  expiresIn: 14_400,
  obtainmentTimestamp: 1_700_000_000_000,
}

function depsFor(overrides: Partial<OAuthDeps> = {}): Partial<OAuthDeps> {
  return {
    exchangeCode: async () => accessToken,
    getTokenInfo: async () => ({
      userId: '123456',
      userName: 'ElStreamer',
      scopes: ['channel:read:subscriptions'],
    }),
    ...overrides,
  }
}

/**
 * Arranca el flujo, espera a tener la URL de autorización y golpea el callback
 * como haría el navegador al volver de Twitch.
 */
async function driveFlow(
  config: AppConfig,
  deps: Partial<OAuthDeps>,
  callbackQuery: (state: string) => string,
): Promise<{ token: Awaited<ReturnType<typeof runOAuthFlow>>; httpStatus: number }> {
  let resolveUrl!: (url: string) => void
  const urlReady = new Promise<string>((r) => {
    resolveUrl = r
  })

  const flow = runOAuthFlow({ config, deps, timeoutMs: 5_000, onAuthorizeUrl: resolveUrl })
  // Evita un unhandled rejection si el test espera un fallo.
  flow.catch(() => undefined)

  const authorizeUrl = await urlReady
  const state = new URL(authorizeUrl).searchParams.get('state') ?? ''

  const response = await fetch(`${config.auth.redirectUri}?${callbackQuery(state)}`)
  await response.text()

  return { token: await flow, httpStatus: response.status }
}

describe('buildAuthorizeUrl', () => {
  it('monta la URL con los parámetros del Authorization Code flow', () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: 'abc',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['channel:read:subscriptions'],
        state: 'xyz',
      }),
    )

    expect(url.origin + url.pathname).toBe('https://id.twitch.tv/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('abc')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback')
    expect(url.searchParams.get('scope')).toBe('channel:read:subscriptions')
    expect(url.searchParams.get('state')).toBe('xyz')
    // Para que el streamer vea con qué cuenta está autorizando.
    expect(url.searchParams.get('force_verify')).toBe('true')
  })
})

describe('runOAuthFlow', () => {
  it('canjea el código y devuelve el token listo para guardar', async () => {
    const config = configFor(await freePort())
    const { token, httpStatus } = await driveFlow(config, depsFor(), (s) => `code=el-codigo&state=${s}`)

    expect(httpStatus).toBe(200)
    expect(token).toEqual({
      userId: '123456',
      userLogin: 'ElStreamer',
      accessToken: 'access-abc',
      refreshToken: 'refresh-def',
      scope: ['channel:read:subscriptions'],
      expiresIn: 14_400,
      obtainmentTimestamp: 1_700_000_000_000,
      grant: 'authorization_code',
    })
  })

  it('pasa a exchangeCode el mismo redirect_uri que se usó al autorizar', async () => {
    const config = configFor(await freePort())
    const seen: string[] = []

    await driveFlow(
      config,
      depsFor({
        exchangeCode: async (_id, _secret, code, redirectUri) => {
          seen.push(code, redirectUri)
          return accessToken
        },
      }),
      (s) => `code=el-codigo&state=${s}`,
    )

    expect(seen).toEqual(['el-codigo', config.auth.redirectUri])
  })

  it('rechaza un state que no coincide (CSRF)', async () => {
    const config = configFor(await freePort())
    await expect(
      driveFlow(config, depsFor(), () => 'code=el-codigo&state=me-lo-invento'),
    ).rejects.toThrow(/state/i)
  })

  it('rechaza si no llega ningún state', async () => {
    const config = configFor(await freePort())
    await expect(driveFlow(config, depsFor(), () => 'code=el-codigo')).rejects.toThrow(AuthError)
  })

  it('informa cuando el streamer pulsa "Cancelar" en Twitch', async () => {
    const config = configFor(await freePort())
    await expect(
      driveFlow(
        config,
        depsFor(),
        (s) => `error=access_denied&error_description=The+user+denied+you+access&state=${s}`,
      ),
    ).rejects.toThrow(/denegó la autorización/)
  })

  // Trampa 5 de la sección 6: el scope solo vale si lo concede el propio streamer.
  it('rechaza si se autoriza con una cuenta distinta a TWITCH_BROADCASTER_LOGIN', async () => {
    const config = configFor(await freePort())

    await expect(
      driveFlow(
        config,
        depsFor({
          getTokenInfo: async () => ({
            userId: '999',
            userName: 'CuentaDelBot',
            scopes: ['channel:read:subscriptions'],
          }),
        }),
        (s) => `code=el-codigo&state=${s}`,
      ),
    ).rejects.toThrow(/CuentaDelBot.*elstreamer/s)
  })

  it('acepta la cuenta correcta aunque Twitch devuelva el nombre con mayúsculas', async () => {
    const config = configFor(await freePort())
    const { token } = await driveFlow(
      config,
      depsFor({
        getTokenInfo: async () => ({
          userId: '123456',
          userName: 'ELSTREAMER',
          scopes: ['channel:read:subscriptions'],
        }),
      }),
      (s) => `code=el-codigo&state=${s}`,
    )
    expect(token.userId).toBe('123456')
  })

  it('rechaza un token al que le falta channel:read:subscriptions', async () => {
    const config = configFor(await freePort())

    await expect(
      driveFlow(
        config,
        depsFor({
          getTokenInfo: async () => ({ userId: '123456', userName: 'ElStreamer', scopes: [] }),
        }),
        (s) => `code=el-codigo&state=${s}`,
      ),
    ).rejects.toThrow(/faltan scopes.*channel:read:subscriptions/)
  })

  it('propaga un fallo al canjear el código', async () => {
    const config = configFor(await freePort())

    await expect(
      driveFlow(
        config,
        depsFor({
          exchangeCode: async () => {
            throw new Error('invalid client secret')
          },
        }),
        (s) => `code=el-codigo&state=${s}`,
      ),
    ).rejects.toThrow(/invalid client secret/)
  })

  it('libera el puerto al terminar', async () => {
    const port = await freePort()
    const config = configFor(port)
    await driveFlow(config, depsFor(), (s) => `code=el-codigo&state=${s}`)

    // Si el servidor siguiera escuchando, esto lanzaría EADDRINUSE.
    await expect(
      new Promise<void>((resolve, reject) => {
        const probe = createServer()
        probe.on('error', reject)
        probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()))
      }),
    ).resolves.toBeUndefined()
  })

  it('redirige a Twitch desde la raíz, para poder abrir localhost a mano', async () => {
    const config = configFor(await freePort())

    let resolveUrl!: (url: string) => void
    const urlReady = new Promise<string>((r) => {
      resolveUrl = r
    })
    const flow = runOAuthFlow({
      config,
      deps: depsFor(),
      timeoutMs: 5_000,
      onAuthorizeUrl: resolveUrl,
    })
    flow.catch(() => undefined)

    const authorizeUrl = await urlReady
    const root = new URL(config.auth.redirectUri).origin
    const response = await fetch(root, { redirect: 'manual' })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(authorizeUrl)

    // Cierra el flujo para que el test no quede colgado.
    const state = new URL(authorizeUrl).searchParams.get('state') ?? ''
    await (await fetch(`${config.auth.redirectUri}?code=x&state=${state}`)).text()
    await flow
  })

  it('corta el flujo si nadie autoriza dentro del timeout', async () => {
    const config = configFor(await freePort())
    await expect(
      runOAuthFlow({ config, deps: depsFor(), timeoutMs: 150 }),
    ).rejects.toThrow(/Nadie autorizó/)
  })
})
