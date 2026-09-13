import type { DrawInputT } from '../inputs/draw.input'
import type { ManualEntriesInputT } from '../inputs/manualEntries.input'
import type {
  DefaultResponseI,
  DrawResponseI,
  GetEntriesResponseI,
  ListGiveawaysResponseI,
  ManualEntriesResponseI,
  OpenGiveawayResponseI,
  VerifyResponseI,
} from '../models/ResponseI'

export interface GiveawayPort {
  getEntries: (giveawayId: string) => Promise<GetEntriesResponseI>
  drawWinners: (giveawayId: string, input: DrawInputT) => Promise<DrawResponseI>
  verifyDraw: (giveawayId: string, seed: string) => Promise<VerifyResponseI>
  addManualEntries: (giveawayId: string, input: ManualEntriesInputT) => Promise<ManualEntriesResponseI>
  openGiveaway: (name: string) => Promise<OpenGiveawayResponseI>
  closeGiveaway: (giveawayId: string) => Promise<DefaultResponseI>
  reopenGiveaway: (giveawayId: string) => Promise<DefaultResponseI>
  /** El archivo: todos los sorteos con sus cifras, del más reciente al más antiguo. */
  listGiveaways: () => Promise<ListGiveawaysResponseI>
}
