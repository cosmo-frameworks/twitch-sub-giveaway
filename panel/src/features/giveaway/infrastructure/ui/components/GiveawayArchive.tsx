import React, { useEffect } from 'react'

import { Button } from '@shared/components/button'

import { useArchive } from '@giveaway/infrastructure/ui/hooks/useArchive'

import { formatNumber } from '@lib/utils'

import type { ArchivedGiveawayI } from '@giveaway/domain/models/ParticipantI'

export interface GiveawayArchivePropsI {
  /** Para marcar cuál es el de ahora mismo. */
  activeGiveawayId: string | null
  onBack: () => void
  /** Se avisa al reabrir uno: el tablero tiene que cambiar de sorteo. */
  onChanged: () => void
}

const STATE_LABEL: Record<ArchivedGiveawayI['status'], string> = {
  open: 'en curso',
  closed: 'archivado',
  drawn: 'sorteado',
}

const hour = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

const exportUrl = (id: string, what: string): string =>
  `/api/giveaways/${id}/export?what=${what}&format=csv`


export const GiveawayArchive: React.FC<GiveawayArchivePropsI> = ({
  activeGiveawayId,
  onBack,
  onChanged,
}) => {
  const archive = useArchive()
  const { load } = archive

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          flexShrink: 0,
          borderBottom: '1px solid var(--rule)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'calc(var(--step) * 4)',
          padding: 'calc(var(--step) * 5) calc(var(--step) * 6)',
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 'var(--t-title)',
            lineHeight: 1.15,
          }}
        >
          Sorteos anteriores
        </h1>
        <Button onClick={onBack}>Volver al tablero</Button>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {archive.error && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: 'calc(var(--step) * 4) calc(var(--step) * 6)',
              color: 'var(--alert)',
              fontSize: 'var(--t-small)',
            }}
          >
            {archive.error}
          </p>
        )}

        {!archive.loading && archive.days.length === 0 && (
          <div
            style={{
              padding: 'calc(var(--step) * 16) calc(var(--step) * 6)',
              maxWidth: '48ch',
              color: 'var(--paper-dim)',
            }}
          >
            <p style={{ margin: 0, fontSize: 'var(--t-lead)', color: 'var(--paper)' }}>
              Aquí todavía no hay nada.
            </p>
            <p style={{ margin: 'calc(var(--step) * 2) 0 0', fontSize: 'var(--t-body)' }}>
              Cuando archives el sorteo de hoy, pasará a esta lista con sus papeletas y sus
              ganadores.
            </p>
          </div>
        )}

        {archive.days.map((day) => (
          <section key={day.key}>
            <h2
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 1,
                margin: 0,
                padding: 'calc(var(--step) * 3) calc(var(--step) * 6)',
                background: 'var(--ink-sunken)',
                borderBottom: '1px solid var(--rule-soft)',
                color: 'var(--paper-dim)',
                fontSize: 'var(--t-small)',
                fontWeight: 500,
              }}
            >
              {day.label}
            </h2>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {day.giveaways.map((giveaway) => (
                <li
                  key={giveaway.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 'calc(var(--step) * 4)',
                    alignItems: 'center',
                    padding: 'calc(var(--step) * 3) calc(var(--step) * 6)',
                    borderBottom: '1px solid var(--rule-soft)',
                    background:
                      giveaway.id === activeGiveawayId ? 'var(--ink-raised)' : 'transparent',
                  }}
                >
                  <span style={{ color: 'var(--paper-faint)', fontSize: 'var(--t-small)' }}>
                    {hour(giveaway.openedAt)}
                  </span>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 'var(--t-body)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {giveaway.name}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 'calc(var(--step) * 4)',
                        flexWrap: 'wrap',
                        color: 'var(--paper-dim)',
                        fontSize: 'var(--t-small)',
                      }}
                    >
                      <span>{formatNumber(giveaway.entries)} papeletas</span>
                      <span>{formatNumber(giveaway.participants)} participantes</span>
                      {giveaway.winners > 0 && (
                        <span style={{ color: 'var(--paper)' }}>
                          {giveaway.winners} ganador{giveaway.winners === 1 ? '' : 'es'}
                        </span>
                      )}
                      <span
                        style={{
                          color:
                            giveaway.status === 'open' ? 'var(--live)' : 'var(--paper-faint)',
                        }}
                      >
                        {STATE_LABEL[giveaway.status]}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 'calc(var(--step) * 2)',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      justifyContent: 'flex-end',
                    }}
                  >
                    {giveaway.entries > 0 && (
                      <a
                        className="btn btn--ghost btn--sm"
                        href={exportUrl(giveaway.id, 'participantes')}
                        download
                      >
                        Participantes
                      </a>
                    )}
                    {giveaway.winners > 0 && (
                      <a
                        className="btn btn--ghost btn--sm"
                        href={exportUrl(giveaway.id, 'ganadores')}
                        download
                      >
                        Ganadores
                      </a>
                    )}
                    {giveaway.status !== 'open' && (
                      <Button
                        size="sm"
                        disabled={archive.busyId === giveaway.id}
                        title="Vuelve a admitir papeletas en este sorteo y archiva el que esté en curso"
                        onClick={() => {
                          void archive.reopen(giveaway.id).then((ok) => {
                            if (ok) onChanged()
                          })
                        }}
                      >
                        {archive.busyId === giveaway.id ? 'Reabriendo…' : 'Reabrir'}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  )
}
