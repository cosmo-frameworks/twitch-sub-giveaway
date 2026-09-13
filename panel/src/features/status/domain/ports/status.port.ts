import type { SaveDbPathInputT } from '../inputs/saveDbPath.input'
import type {
  DefaultResponseI,
  DeviceResponseI,
  GetStatusResponseI,
  SaveDbPathResponseI,
} from '../models/ResponseI'

export interface StatusPort {
  getStatus: () => Promise<GetStatusResponseI>
  startDeviceConnect: () => Promise<DeviceResponseI>
  cancelDeviceConnect: () => Promise<DefaultResponseI>
  reauthorize: () => Promise<DefaultResponseI>
  saveDbPath: (input: SaveDbPathInputT) => Promise<SaveDbPathResponseI>
}
