/**
 * El streamer puede retirar el acceso desde twitch.tv/settings/connections sin
 * avisar: sin esto el proceso se quedaría escuchando un WebSocket mudo y nadie
 * se enteraría hasta el sorteo. De paso, pedir el token fuerza su refresco.
 */

import { getTokenInfo as twurpleGetTokenInfo, InvalidTokenError } from '@twurple/auth'
import type { AccessTokenWithUserId } from '@twurple/auth'

import type { AppConfig } from '../config.js'
import { withRealTwitch } from './real-twitch.js'
import type { AuthStatus, AuthState } from './status.js'

/** Una hora, que es lo que recomienda Twitch. */
export const DEFAULT_VALIDATION_INTERVAL_MS = 60 * 60_000

export interface ValidatableTokenInfo {
  userId: string | null
  scopes: string[]
  expiryDate: Date | null
}

/** Lo mínimo que necesitamos del proveedor, para poder falsearlo en tests. */
export interface TokenSource {
  getAccessTokenForUser: (
    userId: string,
    ...scopeSets: Array<string[] | undefined>
  ) => Promise<AccessTokenWithUserId | null>
}

export interface ValidationResult {
  state: AuthState
  detail: string
  expiresAt: Date | null
}

export interface TokenValidatorOptions {
  authProvider: TokenSource
  userId: string
  config: AppConfig
  status: AuthStatus
  intervalMs?: number
  deps?: {
    getTokenInfo?: (accessToken: string, clientId?: string) => Promise<ValidatableTokenInfo>
  }
}

export class TokenValidator {
  readonly #options: TokenValidatorOptions
  readonly #intervalMs: number
  readonly #getTokenInfo: (accessToken: string, clientId?: string) => Promise<ValidatableTokenInfo>
  #timer: NodeJS.Timeout | undefined

  constructor(options: TokenValidatorOptions) {
    this.#options = options
    this.#intervalMs = options.intervalMs ?? DEFAULT_VALIDATION_INTERVAL_MS
    this.#getTokenInfo = options.deps?.getTokenInfo ?? twurpleGetTokenInfo
  }

  /** Valida ahora y deja programada la siguiente validación. */
  async start(): Promise<ValidationResult> {
    const first = await this.validateNow()

    this.#timer = setInterval(() => {
      void this.validateNow()
    }, this.#intervalMs)
    // No debe ser lo único que mantiene vivo el proceso.
    this.#timer.unref()

    return first
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  /** Comprueba el token y actualiza `AuthStatus`. Nunca lanza. */
  async validateNow(): Promise<ValidationResult> {
    const { authProvider, userId, config, status } = this.#options
    const scopes = [...config.auth.scopes]

    const report = (result: ValidationResult): ValidationResult => {
      status.set(result.state, result.detail, result.expiresAt)
      return result
    }

    let token: AccessTokenWithUserId | null
    try {
      // `withRealTwitch`: si el token hubiera que refrescarlo, el refresco
      // también es una llamada de autenticación y no puede ir al mock.
      token = await withRealTwitch(async () => await authProvider.getAccessTokenForUser(userId, scopes))
    } catch (error) {
      return report(revocationAware(error, 'no se pudo obtener un token válido'))
    }

    if (!token) {
      return report({
        state: 'revoked',
        detail: 'el proveedor no devolvió ningún token para el streamer. Ejecuta "pnpm auth".',
        expiresAt: null,
      })
    }

    let info: ValidatableTokenInfo
    try {
      info = await withRealTwitch(
        async () => await this.#getTokenInfo(token.accessToken, config.twitch.clientId),
      )
    } catch (error) {
      return report(revocationAware(error, 'la validación contra Twitch falló'))
    }

    const missing = scopes.filter((scope) => !info.scopes.includes(scope))
    if (missing.length > 0) {
      return report({
        state: 'revoked',
        detail: `al token le faltan scopes: ${missing.join(', ')}. Ejecuta "pnpm auth".`,
        expiresAt: info.expiryDate,
      })
    }

    return report({
      state: 'ok',
      detail: info.expiryDate
        ? `token válido hasta ${info.expiryDate.toISOString()}`
        : 'token válido (sin caducidad)',
      expiresAt: info.expiryDate,
    })
  }
}

/**
 * Un 401 de Twitch significa token revocado y hay que volver a autorizar a mano;
 * cualquier otra cosa (red, 5xx) es transitoria y se reintenta en una hora.
 * Distinguirlos importa: no queremos alarmar al streamer por un corte de red.
 */
function revocationAware(error: unknown, prefix: string): ValidationResult {
  const message = error instanceof Error ? error.message : String(error)

  if (error instanceof InvalidTokenError || /401|invalid.*token/i.test(message)) {
    return {
      state: 'revoked',
      detail: `${prefix}: el token ya no es válido (${message}). Ejecuta "pnpm auth".`,
      expiresAt: null,
    }
  }

  return {
    state: 'error',
    detail: `${prefix}: ${message}. Se reintentará en la siguiente validación.`,
    expiresAt: null,
  }
}
