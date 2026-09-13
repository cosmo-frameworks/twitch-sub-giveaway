import { BackendClient } from '@lib/backendClient'

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

const backendClient = new BackendClient()

export class GiveawayAdapter implements GiveawayPort {
  async getEntries(giveawayId: string): Promise<GetEntriesResponseI> {
    const { data } = await backendClient.get<GetEntriesResponseI>(
      `/api/giveaways/${giveawayId}/entries`,
    )
    return data
  }

  async drawWinners(giveawayId: string, input: DrawInputT): Promise<DrawResponseI> {
    const { data } = await backendClient.post<DrawResponseI>(
      `/api/giveaways/${giveawayId}/draw`,
      input,
    )
    return data
  }

  async verifyDraw(giveawayId: string, seed: string): Promise<VerifyResponseI> {
    const { data } = await backendClient.get<VerifyResponseI>(
      `/api/giveaways/${giveawayId}/verify?seed=${encodeURIComponent(seed)}`,
    )
    return data
  }

  async addManualEntries(
    giveawayId: string,
    input: ManualEntriesInputT,
  ): Promise<ManualEntriesResponseI> {
    const { data } = await backendClient.post<ManualEntriesResponseI>(
      `/api/giveaways/${giveawayId}/manual-entries`,
      input,
    )
    return data
  }

  async openGiveaway(name: string): Promise<OpenGiveawayResponseI> {
    const { data } = await backendClient.post<OpenGiveawayResponseI>('/api/giveaways', { name })
    return data
  }

  async closeGiveaway(giveawayId: string): Promise<DefaultResponseI> {
    const { data } = await backendClient.post<DefaultResponseI>(
      `/api/giveaways/${giveawayId}/close`,
    )
    return data
  }

  async reopenGiveaway(giveawayId: string): Promise<DefaultResponseI> {
    const { data } = await backendClient.post<DefaultResponseI>(
      `/api/giveaways/${giveawayId}/reopen`,
    )
    return data
  }

  async listGiveaways(): Promise<ListGiveawaysResponseI> {
    const { data } = await backendClient.get<ListGiveawaysResponseI>(`/api/giveaways`)
    return data
  }
}
