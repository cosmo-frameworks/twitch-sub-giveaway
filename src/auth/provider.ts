/**
 * Twurple refresca el token solo, pero en memoria. Twitch invalida el refresh
 * token anterior cada vez que se usa, así que `onRefresh` escribe a disco
 * SIEMPRE: si no, al reiniciar tendríamos uno ya muerto.
 */

import { RefreshingAuthProvider } from '@twurple/auth'
import type { AuthProvider } from '@twurple/auth'

import type { AppConfig } from '../config.js'
import { PublicAuthProvider } from './public-provider.js'
import type { AuthStatus } from './status.js'
import { readToken, writeToken, type StoredToken } from './token-store.js'

export class MissingTokenError extends Error {
  override readonly name = 'MissingTokenError'

  constructor(tokensPath: string) {
    super(
      `No hay ningún token guardado en ${tokensPath}.\n` +
        'Ejecuta "pnpm auth" y autoriza con la cuenta del streamer.',
    )
  }
}

/** El token guardado exige secreto y no hay ninguno configurado. */
export class MissingSecretError extends Error {
  override readonly name = 'MissingSecretError'
  constructor() {
    super(
      'El token guardado se obtuvo con el flujo de navegador, que necesita ' +
        'TWITCH_CLIENT_SECRET para refrescarse. Vuelve a conectar la aplicación con ' +
        'Twitch para obtener uno nuevo con el flujo de dispositivo.',
    )
  }
}

export interface AuthContext {
  authProvider: AuthProvider
  /** ID del streamer. Es lo que pide EventSub y Helix; el login puede cambiar, esto no. */
  userId: string
  userLogin: string | null
}

export interface CreateAuthProviderOptions {
  config: AppConfig
  status: AuthStatus
  /** Sobrescribible en tests. */
  persist?: (token: StoredToken) => Promise<void>
  load?: (path: string) => Promise<StoredToken | null>
}

export async function createAuthProvider(options: CreateAuthProviderOptions): Promise<AuthContext> {
  const { config, status } = options
  const load = options.load ?? readToken
  const persist =
    options.persist ?? ((token: StoredToken) => writeToken(config.auth.tokensPath, token))

  const stored = await load(config.auth.tokensPath)
  if (!stored) {
    status.set('unauthenticated', 'no hay token guardado')
    throw new MissingTokenError(config.auth.tokensPath)
  }

  /**
   * Qué proveedor usar depende de cómo se obtuvo el token.
   *
   * Un token del flujo de dispositivo pertenece a un cliente PÚBLICO y se
   * refresca sin secreto; `RefreshingAuthProvider` de Twurple exige uno en el
   * constructor, así que para esos se usa `PublicAuthProvider`.
   */
  if (stored.grant === 'device') {
    const publicProvider = new PublicAuthProvider({
      clientId: config.twitch.clientId,
      token: stored,
      onRefresh: (token) => persist(token),
      onRefreshFailure: (error) => {
        status.set(
          'revoked',
          `no se pudo refrescar el token (${error.message}). ` +
            'Vuelve a conectar la aplicación con Twitch.',
        )
      },
    })

    status.set('pending', `token cargado para ${stored.userLogin ?? stored.userId}, sin validar`)
    return { authProvider: publicProvider, userId: stored.userId, userLogin: stored.userLogin }
  }

  if (!config.twitch.clientSecret) {
    throw new MissingSecretError()
  }

  const authProvider = new RefreshingAuthProvider({
    clientId: config.twitch.clientId,
    clientSecret: config.twitch.clientSecret,
    redirectUri: config.auth.redirectUri,
  })

  authProvider.onRefresh((userId, token) => {
    void persist({
      userId,
      // `userLogin` no viene en el refresco; conservamos el que teníamos.
      userLogin: stored.userLogin,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      scope: token.scope,
      expiresIn: token.expiresIn,
      obtainmentTimestamp: token.obtainmentTimestamp,
      grant: stored.grant,
    }).catch((error: unknown) => {
      // Si no podemos escribir, el proceso sigue vivo con el token en memoria,
      // pero el siguiente arranque fallará. Hay que gritarlo.
      status.set(
        'error',
        `el token se refrescó pero no se pudo guardar en ${config.auth.tokensPath}: ` +
          `${(error as Error).message}`,
      )
    })
  })

  authProvider.onRefreshFailure((_userId, error) => {
    status.set(
      'revoked',
      `no se pudo refrescar el token (${error.message}). ` +
        'Lo más probable es que el streamer haya retirado el acceso: vuelve a ejecutar "pnpm auth".',
    )
  })

  authProvider.addUser(stored.userId, {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    scope: stored.scope,
    expiresIn: stored.expiresIn,
    obtainmentTimestamp: stored.obtainmentTimestamp,
  })

  // Hay token, pero todavía no lo hemos contrastado con Twitch: hasta que el
  // validador hable, lo honesto es "pending", no "ok".
  status.set('pending', `token cargado para ${stored.userLogin ?? stored.userId}, sin validar`)

  return { authProvider, userId: stored.userId, userLogin: stored.userLogin }
}
