export type AuthStateT = 'ok' | 'pending' | 'unauthenticated' | 'revoked' | 'error'

export interface ActiveGiveawayI {
  id: string
  name: string
  status: 'open' | 'closed' | 'drawn'
}

export type DeviceStateT =
  | { state: 'idle' }
  | { state: 'waiting'; userCode: string; verificationUri: string; expiresAt: string }
  | { state: 'connected'; login: string | null }
  | { state: 'error'; message: string }

export interface PanelStatusI {
  /** `null` mientras no haya ningún canal conectado. */
  broadcaster: string | null
  /** Sorteo al que van las entradas. `null` si todavía no hay ninguno. */
  giveaway: ActiveGiveawayI | null
  auth: {
    state: AuthStateT
    detail: string
    expiresAt: string | null
  }
  eventSub: { connected: boolean }
  device: DeviceStateT
  storage: {
    dataDir: string
    dbPath: string
    dbSource: 'default' | 'settings' | 'env'
  }
}
