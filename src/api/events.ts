/** Quien publica aquí no sabe nada de WebSockets: el servidor reenvía. */

import { EventEmitter } from 'node:events'

import type { AuthState } from '../auth/status.js'
import type { ParticipantEntriesRow } from '../db/repositories/entries.js'

/** Lo que el panel puede recibir por el stream. */
export type PanelEvent =
  | {
      type: 'entry.added'
      giveawayId: string
      /** Fila ya agregada del participante, para que el panel no recalcule. */
      participant: ParticipantEntriesRow
      /** Papeletas que ha sumado este evento. */
      added: number
      totals: { entries: number; weight: number; participants: number }
    }
  | {
      type: 'winner.drawn'
      giveawayId: string
      position: number
      platform: string
      userId: string
      displayName: string
      seed: string
    }
  | {
      type: 'auth.status'
      state: AuthState
      detail: string
    }
  | {
      type: 'eventsub.status'
      connected: boolean
      detail: string
    }
  | {
      type: 'reconciled'
      giveawayId: string
      entriesAdded: number
      totals: { entries: number; weight: number; participants: number }
    }

export class PanelEvents extends EventEmitter<{ event: [PanelEvent] }> {
  publish(event: PanelEvent): void {
    this.emit('event', event)
  }
}
