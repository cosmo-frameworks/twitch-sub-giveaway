import { BackendClient } from '@lib/backendClient'

import type { StatusPort } from '@status/domain/ports/status.port'
import type { SaveDbPathInputT } from '@status/domain/inputs/saveDbPath.input'
import type {
  DefaultResponseI,
  DeviceResponseI,
  GetStatusResponseI,
  SaveDbPathResponseI,
} from '@status/domain/models/ResponseI'

const backendClient = new BackendClient()

export class StatusAdapter implements StatusPort {
  async getStatus(): Promise<GetStatusResponseI> {
    const { data } = await backendClient.get<GetStatusResponseI>('/api/status')
    return data
  }

  async startDeviceConnect(): Promise<DeviceResponseI> {
    const { data } = await backendClient.post<DeviceResponseI>('/api/auth/device')
    return data
  }

  async cancelDeviceConnect(): Promise<DefaultResponseI> {
    const { data } = await backendClient.delete<DefaultResponseI>('/api/auth/device')
    return data
  }

  async reauthorize(): Promise<DefaultResponseI> {
    const { data } = await backendClient.post<DefaultResponseI>('/api/auth/reauthorize')
    return data
  }

  async saveDbPath(input: SaveDbPathInputT): Promise<SaveDbPathResponseI> {
    const { data } = await backendClient.put<SaveDbPathResponseI>('/api/settings/db-path', input)
    return data
  }
}
