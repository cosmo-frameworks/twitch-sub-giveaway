import type { StatusPort } from '@status/domain/ports/status.port'
import type { SaveDbPathInputT } from '@status/domain/inputs/saveDbPath.input'
import type {
  DefaultResponseI,
  DeviceResponseI,
  GetStatusResponseI,
  SaveDbPathResponseI,
} from '@status/domain/models/ResponseI'

export class StatusUseCases implements StatusPort {
  constructor(private readonly _statusService: StatusPort) {}

  async getStatus(): Promise<GetStatusResponseI> {
    return this._statusService.getStatus()
  }

  async startDeviceConnect(): Promise<DeviceResponseI> {
    return this._statusService.startDeviceConnect()
  }

  async cancelDeviceConnect(): Promise<DefaultResponseI> {
    return this._statusService.cancelDeviceConnect()
  }

  async reauthorize(): Promise<DefaultResponseI> {
    return this._statusService.reauthorize()
  }

  async saveDbPath(input: SaveDbPathInputT): Promise<SaveDbPathResponseI> {
    return this._statusService.saveDbPath(input)
  }
}
