import React from 'react'

import { TicketBar } from '@shared/components/ticket-bar'

import type { ParticipantI } from '@giveaway/domain/models/ParticipantI'

/** De dónde salió cada papeleta, en el idioma del streamer. */
const SOURCE_LABEL: Record<string, string> = {
  sub: 'se suscribió',
  resub: 'renovó',
  gift_sent: 'regaló subs',
  gift_received: 'le regalaron un sub',
  keyword: 'palabra en el chat',
  manual: 'añadido a mano',
}

const describeSources = (sources: string): string =>
  sources
    .split(',')
    .map((s) => SOURCE_LABEL[s.trim()] ?? s.trim())
    .join(', ')

export interface ParticipantRowPropsI {
  participant: ParticipantI
  highlight: boolean
  compact: boolean
}

export const ParticipantRow: React.FC<ParticipantRowPropsI> = ({
  participant,
  highlight,
  compact,
}) => (
  <li
    style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(10ch, 18ch) 1fr auto',
      alignItems: 'center',
      gap: 'calc(var(--step) * 5)',
      padding: `${compact ? 14 : 10}px calc(var(--step) * 4)`,
      borderBottom: '1px solid var(--rule-soft)',
      background: highlight ? 'var(--ink-raised)' : 'transparent',
      transition: 'background 600ms ease-out',
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: compact ? 20 : 17,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {participant.displayName}
      </div>
      {!compact && (
        <div style={{ fontSize: 13, color: 'var(--paper-faint)' }}>
          {describeSources(participant.sources)}
        </div>
      )}
    </div>

    <TicketBar entries={participant.entries} highlight={highlight} />

    <div
      style={{
        fontSize: compact ? 26 : 20,
        fontWeight: 600,
        minWidth: '4ch',
        textAlign: 'right',
      }}
    >
      {participant.entries}
    </div>
  </li>
)
