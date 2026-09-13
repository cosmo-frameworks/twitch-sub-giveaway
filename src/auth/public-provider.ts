/**
 * `RefreshingAuthProvider` exige un client secret en el constructor y la
 * aplicación instalada no tiene ninguno. Twitch sí permite refrescar sin
 * secreto en un cliente público, así que se implementa `AuthProvider` a mano.
 *
 * Es deliberadamente pequeño: solo lo que Twurple necesita para hacer llamadas
 * a Helix y abrir EventSub en nombre de un usuario. Nada de intents ni de app
 * tokens — sin secreto no se puede pedir un app token, y este proyecto no lo
 * usa.
 */

import type {
  AccessToken,
  AccessTokenMaybeWithUserId,
  AccessTokenWithUserId,
  AuthProvider,
} from '@twurple/auth'
import type { UserIdResolvable } from '@twurple/common'

import type { StoredToken } from './token-store.js'

const TOKEN_ENDPOINT = 'https://id.twitch.tv/oauth2/token'

/** Margen antes de dar un token por caducado, para absorber la latencia. */
const EXPIRY_GRACE_MS = 60_000

export interface PublicAuthProviderOptions {
  clientId: string
  token: StoredToken
  /** Se llama con cada token nuevo. Debe persistirlo: Twitch rota el refresh. */
  onRefresh: (token: StoredToken) => void | Promise<void>
  onRefreshFailure?: (error: Error) => void
  /** Inyectable en tests. */
  refresh?: (clientId: string, refreshToken: string) => Promise<AccessToken>
}

/**
 * Refresca contra Twitch sin client secret.
 *
 * Es lo que distingue a un cliente público: `client_secret` sencillamente no va
 * en la petición.
 */
export async function refreshPublicToken(
  clientId: string,
  refreshToken: string,
): Promise<AccessToken> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  const body = (await response.json().catch(() => null)) as Partial<{
    access_token: string
    refresh_token: string
    expires_in: number
    scope: string[]
    message: string
  }> | null

  if (!response.ok || !body?.access_token) {
    throw new Error(
      body?.message ?? `Twitch rechazó el refresco del token (HTTP ${response.status}).`,
    )
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? refreshToken,
    expiresIn: body.expires_in ?? null,
    scope: body.scope ?? [],
    obtainmentTimestamp: Date.now(),
  }
}

export class PublicAuthProvider implements AuthProvider {
  readonly clientId: string

  #token: StoredToken
  readonly #onRefresh: PublicAuthProviderOptions['onRefresh']
  readonly #onRefreshFailure: PublicAuthProviderOptions['onRefreshFailure']
  readonly #refresh: NonNullable<PublicAuthProviderOptions['refresh']>
  /** Evita que varias llamadas simultáneas disparen varios refrescos. */
  #refreshing: Promise<void> | null = null

  constructor(options: PublicAuthProviderOptions) {
    this.clientId = options.clientId
    this.#token = options.token
    this.#onRefresh = options.onRefresh
    this.#onRefreshFailure = options.onRefreshFailure
    this.#refresh = options.refresh ?? refreshPublicToken
  }

  get userId(): string {
    return this.#token.userId
  }

  getCurrentScopesForUser(): string[] {
    return this.#token.scope
  }

  async getAccessTokenForUser(
    _user: UserIdResolvable,
    ..._scopeSets: Array<string[] | undefined>
  ): Promise<AccessTokenWithUserId | null> {
    if (this.#isExpired()) await this.#doRefresh()

    return {
      userId: this.#token.userId,
      accessToken: this.#token.accessToken,
      refreshToken: this.#token.refreshToken,
      scope: this.#token.scope,
      expiresIn: this.#token.expiresIn,
      obtainmentTimestamp: this.#token.obtainmentTimestamp,
    }
  }

  async getAnyAccessToken(): Promise<AccessTokenMaybeWithUserId> {
    const token = await this.getAccessTokenForUser(this.#token.userId)
    // `getAccessTokenForUser` solo devuelve null si no hay usuario, y aquí
    // siempre lo hay.
    if (!token) throw new Error('No hay token disponible.')
    return token
  }

  /** Fuerza un refresco. Twurple la llama al recibir un 401. */
  async refreshAccessTokenForUser(): Promise<AccessTokenWithUserId> {
    await this.#doRefresh()
    return {
      userId: this.#token.userId,
      accessToken: this.#token.accessToken,
      refreshToken: this.#token.refreshToken,
      scope: this.#token.scope,
      expiresIn: this.#token.expiresIn,
      obtainmentTimestamp: this.#token.obtainmentTimestamp,
    }
  }

  #isExpired(): boolean {
    if (this.#token.expiresIn === null) return false
    const expiresAt = this.#token.obtainmentTimestamp + this.#token.expiresIn * 1000
    return Date.now() >= expiresAt - EXPIRY_GRACE_MS
  }

  async #doRefresh(): Promise<void> {
    // Si ya hay un refresco en marcha, esperar a ese en vez de pedir otro:
    // Twitch rota el refresh token y dos peticiones en paralelo invalidarían
    // la una a la otra.
    if (this.#refreshing) return await this.#refreshing

    const refreshToken = this.#token.refreshToken
    if (!refreshToken) {
      const error = new Error('El token guardado no se puede refrescar. Hay que volver a conectar.')
      this.#onRefreshFailure?.(error)
      throw error
    }

    this.#refreshing = (async () => {
      try {
        const fresh = await this.#refresh(this.clientId, refreshToken)

        this.#token = {
          ...this.#token,
          accessToken: fresh.accessToken,
          refreshToken: fresh.refreshToken,
          scope: fresh.scope,
          expiresIn: fresh.expiresIn,
          obtainmentTimestamp: fresh.obtainmentTimestamp,
        }

        await this.#onRefresh(this.#token)
      } catch (error) {
        this.#onRefreshFailure?.(error as Error)
        throw error
      } finally {
        this.#refreshing = null
      }
    })()

    return await this.#refreshing
  }
}
