/** Observable para que el panel pinte el estado sin sondear nada. */

import { EventEmitter } from 'node:events'

export type AuthState =
  /** Token válido y con los scopes necesarios. */
  | 'ok'
  /** Hay token cargado pero todavía no se ha validado contra Twitch. */
  | 'pending'
  /** Aún no se ha ejecutado `pnpm auth`. */
  | 'unauthenticated'
  /** El streamer retiró el acceso, o el token dejó de valer. Requiere `pnpm auth`. */
  | 'revoked'
  /** Fallo transitorio (red, 5xx de Twitch). Se reintenta en la siguiente validación. */
  | 'error'

export interface AuthStatusSnapshot {
  state: AuthState
  /** Desde cuándo está en este estado. */
  since: Date
  /** Texto para el log y para el panel. */
  detail: string
  /** Caducidad del token actual, si se conoce. */
  expiresAt: Date | null
}

export class AuthStatus extends EventEmitter<{ change: [AuthStatusSnapshot] }> {
  #snapshot: AuthStatusSnapshot = {
    state: 'unauthenticated',
    since: new Date(),
    detail: 'sin token',
    expiresAt: null,
  }

  get current(): AuthStatusSnapshot {
    return this.#snapshot
  }

  /** Actualiza el estado. Solo emite `change` si algo cambió de verdad. */
  set(state: AuthState, detail: string, expiresAt: Date | null = null): void {
    const prev = this.#snapshot
    const sameExpiry = prev.expiresAt?.getTime() === expiresAt?.getTime()
    if (prev.state === state && prev.detail === detail && sameExpiry) return

    this.#snapshot = {
      state,
      detail,
      expiresAt,
      since: prev.state === state ? prev.since : new Date(),
    }
    this.emit('change', this.#snapshot)
  }
}
