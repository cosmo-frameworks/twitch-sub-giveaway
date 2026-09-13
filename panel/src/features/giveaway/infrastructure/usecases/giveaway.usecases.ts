import type { GiveawayPort } from '@giveaway/domain/ports/giveaway.port'
import type { DrawInputT } from '@giveaway/domain/inputs/draw.input'
import type { ManualEntriesInputT } from '@giveaway/domain/inputs/manualEntries.input'
import type {
  DefaultResponseI,
  DrawResponseI,
  GetEntriesResponseI,
  ListGiveawaysResponseI,
  ManualEntriesResponseI,
  OpenGiveawayResponseI,
  VerifyResponseI,
} from '@giveaway/domain/models/ResponseI'

export class GiveawayUseCases implements GiveawayPort {
  constructor(private readonly _giveawayService: GiveawayPort) {}

  async getEntries(giveawayId: string): Promise<GetEntriesResponseI> {
    return this._giveawayService.getEntries(giveawayId)
  }

  async drawWinners(giveawayId: string, input: DrawInputT): Promise<DrawResponseI> {
    return this._giveawayService.drawWinners(giveawayId, input)
  }

  async verifyDraw(giveawayId: string, seed: string): Promise<VerifyResponseI> {
    return this._giveawayService.verifyDraw(giveawayId, seed)
  }

  async addManualEntries(
    giveawayId: string,
    input: ManualEntriesInputT,
  ): Promise<ManualEntriesResponseI> {
    return this._giveawayService.addManualEntries(giveawayId, input)
  }

  async openGiveaway(name: string): Promise<OpenGiveawayResponseI> {
    return this._giveawayService.openGiveaway(name)
  }

  async closeGiveaway(giveawayId: string): Promise<DefaultResponseI> {
    return this._giveawayService.closeGiveaway(giveawayId)
  }

  async reopenGiveaway(giveawayId: string): Promise<DefaultResponseI> {
    return this._giveawayService.reopenGiveaway(giveawayId)
  }

  async listGiveaways(): Promise<ListGiveawaysResponseI> {
    return this._giveawayService.listGiveaways()
  }
}
