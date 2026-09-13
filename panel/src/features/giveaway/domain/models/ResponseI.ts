import type { ArchivedGiveawayI, GiveawayI, ParticipantI, TotalsI, WinnerI } from './ParticipantI'

export interface GetEntriesResponseI {
  ok: boolean
  giveaway: GiveawayI
  participants: ParticipantI[]
  totals: TotalsI
}

export interface DrawResponseI {
  ok: boolean
  alreadyDrawn: boolean
  seed: string
  drawnAt?: string
  pool?: { tickets: number; weight: number; participants: number }
  winners: WinnerI[]
}

export interface VerifyResponseI {
  ok: boolean
  matches: boolean
  seed: string
  explanation: string
  pool: { tickets: number; weight: number; participants: number }
  stored: Array<{ position: number; platform: string; userId: string }>
  recomputed: Array<{ position: number; platform: string; userId: string }>
}

export interface DefaultResponseI {
  ok: boolean
}

export interface ManualEntriesResponseI extends DefaultResponseI {
  added: number
  participant: ParticipantI | null
}

export interface OpenGiveawayResponseI extends DefaultResponseI {
  giveaway: GiveawayI
  closed: GiveawayI | null
  restartRequired: boolean
  message: string
}

export interface ListGiveawaysResponseI {
  ok: boolean
  giveaways: ArchivedGiveawayI[]
}

export interface WinnersResponseI {
  ok: boolean
  winners: WinnerI[]
}
