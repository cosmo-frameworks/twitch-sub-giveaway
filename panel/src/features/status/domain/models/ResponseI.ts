import type { DeviceStateT, PanelStatusI } from './StatusI'

export interface GetStatusResponseI {
  ok: boolean
  status: PanelStatusI
}

export interface DefaultResponseI {
  ok: boolean
}

export interface SaveDbPathResponseI extends DefaultResponseI {
  restartRequired: boolean
  message: string
}

export interface DeviceResponseI extends DefaultResponseI {
  device: DeviceStateT
}
