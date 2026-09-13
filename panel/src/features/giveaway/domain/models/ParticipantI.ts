/** Una fila del tablero: un participante con todas sus papeletas. */
export interface ParticipantI {
  platform: string
  userId: string
  login: string
  displayName: string
  /** Número de papeletas. Es lo que determina cuánto ocupa en el tablero. */
  entries: number
  /** Suma de pesos. Con los pesos por defecto coincide con `entries`. */
  weight: number
  /** De dónde salieron: "sub", "gift_sent", "resub"… separadas por coma. */
  sources: string
  firstEntryAt: string
  lastEntryAt: string
}

export interface GiveawayI {
  id: string
  name: string
  status: 'open' | 'closed' | 'drawn'
  openedAt: string
  closedAt: string | null
}

export interface TotalsI {
  entries: number
  weight: number
  participants: number
}

export interface WinnerI {
  id: string
  giveawayId: string
  platform: string
  userId: string
  position: number
  /** Semilla de la tirada: es lo que permite rehacerla y demostrarla. */
  seed: string
  drawnAt: string
}

/** Un sorteo del archivo: el sorteo y lo que dio de sí. */
export interface ArchivedGiveawayI extends GiveawayI {
  entries: number
  participants: number
  winners: number
}
