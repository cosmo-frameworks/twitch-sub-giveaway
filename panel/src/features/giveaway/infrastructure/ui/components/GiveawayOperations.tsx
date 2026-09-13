import React, { useState } from 'react'

import { Button } from '@shared/components/button'
import { Field } from '@shared/components/field'

import type { GiveawayI } from '@giveaway/domain/models/ParticipantI'
import type { ManualEntriesInputT } from '@giveaway/domain/inputs/manualEntries.input'

export interface GiveawayOperationsPropsI {
  giveaway: GiveawayI
  addingManual: boolean
  openingGiveaway: boolean
  notice: string | null
  onAddManual: (input: ManualEntriesInputT) => void
  onOpenGiveaway: (name: string) => void
  onCloseGiveaway: () => void
  onDismissNotice: () => void
}

const heading: React.CSSProperties = {
  fontSize: 'var(--t-body)',
  fontWeight: 600,
  marginBottom: 'calc(var(--step) * 2)',
}

const explain: React.CSSProperties = {
  margin: '0 0 calc(var(--step) * 3)',
  color: 'var(--paper-dim)',
  fontSize: 'var(--t-small)',
  maxWidth: '64ch',
}

export const GiveawayOperations: React.FC<GiveawayOperationsPropsI> = ({
  giveaway,
  addingManual,
  openingGiveaway,
  notice,
  onAddManual,
  onOpenGiveaway,
  onCloseGiveaway,
  onDismissNotice,
}) => {
  const [login, setLogin] = useState('')
  const [entries, setEntries] = useState(1)
  const [reason, setReason] = useState('')
  const [newName, setNewName] = useState('')

  const exportUrl = (what: string, format: string): string =>
    `/api/giveaways/${giveaway.id}/export?what=${what}&format=${format}`

  return (
    <section
      style={{
        borderTop: '1px solid var(--rule)',
        background: 'var(--ink-sunken)',
        padding: 'calc(var(--step) * 5) calc(var(--step) * 6)',
        display: 'grid',
        gap: 'calc(var(--step) * 6)',
      }}
    >
      <div>
        <div style={heading}>Descargar la lista</div>
        <div style={{ display: 'flex', gap: 'calc(var(--step) * 2)', flexWrap: 'wrap' }}>
          {/* Enlaces de verdad, no botones: es una descarga, y el servidor ya
              manda `content-disposition`. No hace falta pasar por el adapter. */}
          <a className="btn btn--quiet" href={exportUrl('participantes', 'csv')} download>
            Participantes (CSV)
          </a>
          <a className="btn btn--quiet" href={exportUrl('participantes', 'json')} download>
            Participantes (JSON)
          </a>
          <a className="btn btn--quiet" href={exportUrl('ganadores', 'csv')} download>
            Ganadores (CSV)
          </a>
        </div>
      </div>

      <div>
        <div style={heading}>Añadir papeletas a mano</div>
        <p style={explain}>
          Para cuando alguien se suscribió con la aplicación cerrada y la comprobación automática
          no lo recuperó. El motivo se guarda: es lo único que explicará esas papeletas si alguien
          pregunta.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onAddManual({ login: login.trim(), entries, reason: reason.trim() })
            setLogin('')
            setReason('')
            setEntries(1)
          }}
          style={{ display: 'flex', gap: 'calc(var(--step) * 2)', flexWrap: 'wrap' }}
        >
          <Field
            required
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            placeholder="Nombre del canal"
            aria-label="Nombre del canal"
            style={{ flex: '1 1 16ch' }}
          />
          <Field
            required
            type="number"
            min={1}
            max={100}
            value={entries}
            onChange={(e) => setEntries(Math.max(1, Number(e.target.value) || 1))}
            aria-label="Cuántas papeletas"
            chars={7}
          />
          <Field
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo"
            aria-label="Motivo"
            style={{ flex: '2 1 24ch' }}
          />
          <Button type="submit" disabled={addingManual}>
            {addingManual ? 'Añadiendo…' : 'Añadir'}
          </Button>
        </form>
      </div>

      <div>
        <div style={heading}>Sorteos</div>
        <p style={explain}>
          Ahora mismo: «{giveaway.name}» ({giveaway.status === 'open' ? 'abierto' : 'cerrado'}).
          Abrir uno nuevo cierra este y empieza la lista de cero.
        </p>
        <div style={{ display: 'flex', gap: 'calc(var(--step) * 2)', flexWrap: 'wrap' }}>
          <Field
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nombre del sorteo nuevo"
            aria-label="Nombre del sorteo nuevo"
            style={{ flex: '1 1 24ch' }}
          />
          <Button
            disabled={openingGiveaway || newName.trim() === ''}
            onClick={() => {
              onOpenGiveaway(newName.trim())
              setNewName('')
            }}
          >
            {openingGiveaway ? 'Abriendo…' : 'Abrir sorteo nuevo'}
          </Button>
          {giveaway.status === 'open' && <Button onClick={onCloseGiveaway}>Cerrar este</Button>}
        </div>
      </div>

      {notice && (
        <p
          role="status"
          onClick={onDismissNotice}
          style={{ margin: 0, fontSize: 'var(--t-small)', color: 'var(--live)', cursor: 'pointer' }}
        >
          {notice}
        </p>
      )}
    </section>
  )
}
