/**
 * Una sola espera a la vez: pulsar dos veces "Conectar" devuelve el mismo
 * código, porque si no el primero quedaría huérfano y podría teclearse el que
 * ya no vale.
 */

import { getTokenInfo } from '@twurple/auth'

import type { AppConfig } from '../config.js'
import {
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  requestDeviceToken,
  type DeviceCodeStartT,
  type DeviceTokenT,
} from './device-flow.js'
import { withRealTwitch } from './real-twitch.js'
import type { StoredToken } from './token-store.js'

export type DeviceSessionStateT =
  | { state: 'idle' }
  | {
      state: 'waiting'
      userCode: string
      verificationUri: string
      expiresAt: string
    }
  | { state: 'connected'; login: string | null }
  | { state: 'error'; message: string }

export interface DeviceSessionOptions {
  config: AppConfig
  /** Se llama con el token ya identificado. Debe guardarlo y arrancar el listener. */
  onConnected: (token: StoredToken) => Promise<void>
  /** Inyectables en tests. */
  deps?: {
    requestDeviceCode?: (input: {
      clientId: string
      scopes: readonly string[]
    }) => Promise<DeviceCodeStartT>
    requestDeviceToken?: typeof requestDeviceToken
    identify?: (accessToken: string, clientId: string) => Promise<{ userId: string; login: string | null }>
    sleep?: (ms: number) => Promise<void>
    now?: () => Date
  }
}

const defaultSleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/** Averigua de quién es el token. El canal ES quien acaba de autorizar. */
const defaultIdentify = async (
  accessToken: string,
  clientId: string,
): Promise<{ userId: string; login: string | null }> => {
  const info = await withRealTwitch(async () => await getTokenInfo(accessToken, clientId))
  if (!info.userId) {
    throw new DeviceFlowError('El token que ha devuelto Twitch no pertenece a ninguna cuenta.')
  }
  return { userId: info.userId, login: info.userName }
}

export class DeviceSession {
  #state: DeviceSessionStateT = { state: 'idle' }
  #abort: AbortController | null = null
  readonly #options: DeviceSessionOptions

  constructor(options: DeviceSessionOptions) {
    this.#options = options
  }

  get state(): DeviceSessionStateT {
    return this.#state
  }

  /**
   * Pide un código y se queda esperando en segundo plano.
   *
   * Devuelve en cuanto tiene el código: el sondeo sigue por su cuenta, porque
   * el streamer puede tardar minutos y la petición HTTP no puede esperarlo.
   */
  async start(): Promise<DeviceSessionStateT> {
    if (this.#state.state === 'waiting') return this.#state

    const deps = this.#options.deps ?? {}
    const clientId = this.#options.config.twitch.clientId
    const scopes = this.#options.config.auth.scopes

    let start: DeviceCodeStartT
    try {
      start = await (deps.requestDeviceCode ?? requestDeviceCode)({ clientId, scopes })
    } catch (error) {
      this.#state = { state: 'error', message: (error as Error).message }
      return this.#state
    }

    this.#state = {
      state: 'waiting',
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresAt: start.expiresAt.toISOString(),
    }

    this.#abort = new AbortController()
    void this.#waitInBackground(start, this.#abort.signal)

    return this.#state
  }

  cancel(): void {
    this.#abort?.abort()
    this.#abort = null
    if (this.#state.state === 'waiting') this.#state = { state: 'idle' }
  }

  async #waitInBackground(start: DeviceCodeStartT, signal: AbortSignal): Promise<void> {
    const deps = this.#options.deps ?? {}
    const clientId = this.#options.config.twitch.clientId
    const scopes = this.#options.config.auth.scopes

    let token: DeviceTokenT
    try {
      token = await pollForToken(start, {
        poll: async () =>
          await (deps.requestDeviceToken ?? requestDeviceToken)({
            clientId,
            deviceCode: start.deviceCode,
            scopes,
          }),
        sleep: deps.sleep ?? defaultSleep,
        now: deps.now ?? (() => new Date()),
        signal,
      })
    } catch (error) {
      // Cancelar no es un error que enseñar: vuelve a "sin conectar".
      this.#state = signal.aborted
        ? { state: 'idle' }
        : { state: 'error', message: (error as Error).message }
      return
    }

    try {
      const who = await (deps.identify ?? defaultIdentify)(token.accessToken, clientId)

      // El canal esperado solo se comprueba si está configurado a mano. Para el
      // usuario final no lo está: el canal es quien acaba de autorizar.
      const expected = this.#options.config.twitch.expectedBroadcasterLogin
      if (expected !== null && who.login?.toLowerCase() !== expected) {
        this.#state = {
          state: 'error',
          message: `Has conectado la cuenta "${who.login ?? '?'}", pero la configurada es "${expected}".`,
        }
        return
      }

      await this.#options.onConnected({
        userId: who.userId,
        userLogin: who.login,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        scope: token.scope,
        expiresIn: token.expiresIn,
        obtainmentTimestamp: token.obtainmentTimestamp,
        grant: 'device',
      })

      this.#state = { state: 'connected', login: who.login }
    } catch (error) {
      this.#state = { state: 'error', message: (error as Error).message }
    }
  }
}
