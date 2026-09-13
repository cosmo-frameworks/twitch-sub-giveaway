import React from 'react'

import type { TicketBarPropsI } from '../interfaces/TicketBarI'

/** Muescas que se dibujan de verdad antes de resumir con "+N". */
const MAX_NOTCHES = 24

/**
 * Las papeletas de un participante, dibujadas como muescas contables.
 *
 * La base de datos guarda una fila por papeleta, no un contador, y el tablero
 * lo enseña igual: quien regaló veinte subs OCUPA más sitio que quien tiene
 * una. Desde el otro lado de la habitación —o en una captura de OBS— se ve
 * quién domina el sorteo sin leer un solo número.
 *
 * Muescas discretas, no una barra continua: son papeletas, se cuentan.
 */
export const TicketBar: React.FC<TicketBarPropsI> = ({ entries, highlight = false }) => {
  const drawn = Math.min(entries, MAX_NOTCHES)
  const rest = entries - drawn

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'calc(var(--step) * 2)' }}
      aria-label={`${entries} papeleta${entries === 1 ? '' : 's'}`}
    >
      <span style={{ display: 'inline-flex', gap: 3 }} aria-hidden>
        {Array.from({ length: drawn }, (_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 22,
              background: 'var(--paper)',
              borderRadius: 'var(--radius)',
              // Las papeletas recién añadidas entran atenuadas y suben a plena
              // opacidad: el movimiento responde a algo que ha pasado de verdad.
              opacity: highlight ? 0.55 : 1,
              transition: 'opacity 420ms ease-out',
            }}
          />
        ))}
      </span>

      {rest > 0 && (
        <span style={{ color: 'var(--paper-dim)', fontSize: 13 }} aria-hidden>
          +{rest}
        </span>
      )}
    </span>
  )
}
