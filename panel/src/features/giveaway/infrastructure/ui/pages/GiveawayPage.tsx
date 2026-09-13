import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@shared/components/button'
import { Field } from '@shared/components/field'
import { StatusDot, type StatusToneT } from '@shared/components/status-dot'

import { DrawReveal } from '@giveaway/infrastructure/ui/components/DrawReveal'
import { GiveawayArchive } from '@giveaway/infrastructure/ui/components/GiveawayArchive'
import { GiveawayOperations } from '@giveaway/infrastructure/ui/components/GiveawayOperations'
import { ParticipantRow } from '@giveaway/infrastructure/ui/components/ParticipantRow'
import { StatusPanel } from '@status/infrastructure/ui/components/StatusPanel'

import { useGiveaway } from '@giveaway/infrastructure/ui/hooks/useGiveaway'
import { usePanelStream, type PanelEventT } from '@/hooks/usePanelStream'
import { useStatus } from '@status/infrastructure/ui/hooks/useStatus'

import { formatNumber } from '@lib/utils'

import type { ParticipantI, TotalsI } from '@giveaway/domain/models/ParticipantI'
import type { AuthStateT } from '@status/domain/models/StatusI'

/**
 * Un token revocado gana a todo lo demás: el tablero puede parecer que va bien
 * mientras ya no entra ni un sub, y eso no se puede descubrir al sortear.
 */
const connectionStatus = (
  auth: AuthStateT | undefined,
  eventSubConnected: boolean | undefined,
  streamState: 'connecting' | 'live' | 'reconnecting',
): { tone: StatusToneT; label: string } => {
  if (auth === 'revoked' || auth === 'unauthenticated') {
    return { tone: 'alert', label: 'Twitch desconectado' }
  }
  if (streamState === 'reconnecting') return { tone: 'warn', label: 'Reconectando' }
  if (streamState === 'connecting') return { tone: 'idle', label: 'Conectando' }
  if (eventSubConnected === false) return { tone: 'warn', label: 'Sin eventos de Twitch' }
  return { tone: 'live', label: 'En directo' }
}

export const GiveawayPage: React.FC = () => {
  const [search, setSearch] = useState<string>('')
  const [obsMode, setObsMode] = useState<boolean>(false)
  const [winnerCount, setWinnerCount] = useState<number>(1)
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false)
  const [archiveOpen, setArchiveOpen] = useState<boolean>(false)
  const [archiving, setArchiving] = useState<boolean>(false)

  const statusState = useStatus()
  // El sorteo activo lo dice el backend: el panel no lo elige.
  const giveawayId = statusState.status?.giveaway?.id ?? null
  const giveawayState = useGiveaway(giveawayId)

  const { getStatus } = statusState
  const { getEntries, applyEntryAdded, clearJustAdded, justAdded } = giveawayState

  // Arranque: el estado trae el canal; la lista trae el sorteo abierto.
  useEffect(() => {
    void getStatus()
  }, [getStatus])

  useEffect(() => {
    void getEntries()
  }, [getEntries])

  const onStreamEvent = useCallback(
    (event: PanelEventT) => {
      if (event.type === 'entry.added') {
        applyEntryAdded(event.participant as ParticipantI, event.totals as TotalsI)
        return
      }
      if (event.type === 'auth.status') {
        statusState.applyAuthState(event.state as AuthStateT, event.detail)
        return
      }
      if (event.type === 'eventsub.status') {
        statusState.applyEventSubState(event.connected)
        return
      }
      if (event.type === 'reconciled') void getEntries()
    },
    [applyEntryAdded, getEntries, statusState],
  )

  const { streamState } = usePanelStream(giveawayId, onStreamEvent)

  // El resaltado de "acaba de entrar" dura lo justo para que se vea.
  useEffect(() => {
    if (!justAdded) return
    const timer = window.setTimeout(clearJustAdded, 900)
    return () => window.clearTimeout(timer)
  }, [justAdded, clearJustAdded])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return giveawayState.participants
    return giveawayState.participants.filter(
      (p) =>
        p.displayName.toLowerCase().includes(needle) || p.login.toLowerCase().includes(needle),
    )
  }, [giveawayState.participants, search])

  const connection = connectionStatus(
    statusState.status?.auth.state,
    statusState.status?.eventSub.connected,
    streamState,
  )

  /**
   * El nombre se pone solo con la fecha: después de cantar un ganador en
   * directo nadie quiere teclear. Para uno con nombre propio, Ajustes.
   */
  const archiveAndRestart = useCallback(async () => {
    setArchiving(true)
    try {
      const fecha = new Date().toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
      if (!(await giveawayState.openGiveaway(`Sorteo del ${fecha}`))) return
      giveawayState.dismissDraw()
      await getStatus()
    } finally {
      setArchiving(false)
    }
  }, [giveawayState, getStatus])

  if (archiveOpen) {
    return (
      <GiveawayArchive
        activeGiveawayId={giveawayId}
        onBack={() => setArchiveOpen(false)}
        onChanged={() => void getStatus()}
      />
    )
  }

  return (
    <main style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ flexShrink: 0, borderBottom: '1px solid var(--rule)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'calc(var(--step) * 4)',
            padding: 'calc(var(--step) * 6) calc(var(--step) * 6) 0',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontWeight: 400,
                fontSize: obsMode ? 'var(--t-display)' : 'var(--t-title)',
                lineHeight: 1.15,
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {giveawayState.giveaway?.name ?? 'Sorteo'}
            </h1>

            <p
              style={{
                margin: 'calc(var(--step) * 1.5) 0 0',
                display: 'flex',
                gap: 'calc(var(--step) * 6)',
                color: 'var(--paper-dim)',
                fontSize: obsMode ? 'var(--t-lead)' : 'var(--t-body)',
              }}
            >
              <span>
                <span style={{ color: 'var(--paper)', fontWeight: 600 }}>
                  {formatNumber(giveawayState.totals.entries)}
                </span>{' '}
                papeletas
              </span>
              <span>
                <span style={{ color: 'var(--paper)', fontWeight: 600 }}>
                  {formatNumber(giveawayState.totals.participants)}
                </span>{' '}
                participantes
              </span>
            </p>
          </div>

          <StatusDot
            tone={connection.tone}
            label={connection.label}
            title={statusState.status?.auth.detail}
          />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'calc(var(--step) * 2)',
            padding: 'calc(var(--step) * 4) calc(var(--step) * 6)',
            flexWrap: 'wrap',
          }}
        >
          {!obsMode && (
            <Field
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar participante"
              aria-label="Buscar participante"
              style={{ flex: '1 1 200px', maxWidth: 300 }}
            />
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--step) * 2)',
              marginLeft: 'auto',
            }}
          >
            {!obsMode && (
              <>
                <Field
                  type="number"
                  min={1}
                  max={100}
                  value={winnerCount}
                  onChange={(e) => setWinnerCount(Math.max(1, Number(e.target.value) || 1))}
                  aria-label="Cuántos ganadores sortear"
                  chars={5}
                />
                <span style={{ color: 'var(--paper-dim)', fontSize: 'var(--t-small)' }}>
                  ganador{winnerCount === 1 ? '' : 'es'}
                </span>
              </>
            )}

            <Button
              tone="primary"
              onClick={() =>
                void giveawayState.drawWinners({ winners: winnerCount, excludePastWinners: true })
              }
              disabled={giveawayState.drawing || giveawayState.totals.entries === 0}
              title={
                giveawayState.totals.entries === 0
                  ? 'Todavía no hay papeletas que sortear'
                  : `Sortea ${winnerCount} ganador${winnerCount === 1 ? '' : 'es'}`
              }
            >
              {giveawayState.drawing ? 'Sorteando…' : 'Sortear'}
            </Button>

            <span
              aria-hidden
              style={{
                width: 1,
                height: 18,
                background: 'var(--rule)',
                margin: '0 calc(var(--step) * 1)',
              }}
            />

            <Button
              on={obsMode}
              onClick={() => setObsMode((v) => !v)}
              title="Oculta los controles y agranda la lista para capturarla en OBS"
            >
              {obsMode ? 'Salir de OBS' : 'Modo OBS'}
            </Button>

            {!obsMode && (
              <>
                <Button onClick={() => setArchiveOpen(true)}>Sorteos anteriores</Button>
                <Button on={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
                  Ajustes
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {giveawayState.loading && giveawayState.participants.length === 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <li
                key={i}
                style={{
                  height: 56,
                  borderBottom: '1px solid var(--rule-soft)',
                  background:
                    'linear-gradient(90deg, var(--ink) 0%, var(--ink-raised) 50%, var(--ink) 100%)',
                  opacity: 0.6,
                }}
              />
            ))}
          </ul>
        )}

        {!giveawayState.loading && giveawayState.participants.length === 0 && (
          <div
            style={{
              padding: 'calc(var(--step) * 16) calc(var(--step) * 6)',
              maxWidth: '48ch',
              color: 'var(--paper-dim)',
            }}
          >
            <p style={{ margin: 0, fontSize: 18, color: 'var(--paper)' }}>
              Todavía no hay papeletas.
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 15 }}>
              En cuanto alguien se suscriba, renueve o regale subs, aparecerá aquí sin que tengas
              que refrescar.
            </p>
          </div>
        )}

        {visible.length === 0 && giveawayState.participants.length > 0 && (
          <div style={{ padding: 'calc(var(--step) * 10) calc(var(--step) * 6)', color: 'var(--paper-dim)' }}>
            Nadie coincide con «{search}».
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map((participant) => (
            <ParticipantRow
              key={`${participant.platform}:${participant.userId}`}
              participant={participant}
              highlight={justAdded === participant.userId}
              compact={obsMode}
            />
          ))}
        </ul>
      </div>

      {giveawayState.lastDraw && (
        <DrawReveal
          result={giveawayState.lastDraw}
          participants={giveawayState.participants}
          verification={giveawayState.verification}
          verifying={giveawayState.verifying}
          archiving={archiving}
          onVerify={(seed) => void giveawayState.verifyDraw(seed)}
          onArchive={() => void archiveAndRestart()}
          onClose={giveawayState.dismissDraw}
        />
      )}

      {settingsOpen && !obsMode && giveawayState.giveaway && (
        <GiveawayOperations
          giveaway={giveawayState.giveaway}
          addingManual={giveawayState.addingManual}
          openingGiveaway={giveawayState.openingGiveaway}
          notice={giveawayState.notice}
          onAddManual={(input) => void giveawayState.addManualEntries(input)}
          onOpenGiveaway={(name) => {
            // Se vuelve a pedir el estado: el sorteo activo es otro y el tablero
            // tiene que cambiar sin reiniciar.
            void giveawayState.openGiveaway(name).then((ok) => {
              if (ok) void getStatus()
            })
          }}
          onCloseGiveaway={() => void giveawayState.closeGiveaway()}
          onDismissNotice={giveawayState.dismissNotice}
        />
      )}

      {settingsOpen && !obsMode && statusState.status && (
        <StatusPanel
          status={statusState.status}
          reauthorizing={statusState.reauthorizing}
          saving={statusState.saving}
          notice={statusState.notice}
          error={statusState.error}
          onReauthorize={() => void statusState.reauthorize()}
          onSaveDbPath={(path) => void statusState.saveDbPath(path)}
          onDismissNotice={statusState.dismissNotice}
        />
      )}

      {giveawayState.error && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: 'calc(var(--step) * 3) calc(var(--step) * 6)',
            borderTop: '1px solid var(--rule)',
            color: 'var(--alert)',
            fontSize: 14,
          }}
        >
          {giveawayState.error}
        </p>
      )}

      {/* Referencia de soporte; con ocho caracteres se encuentra. */}
      {!obsMode && giveawayState.giveaway && (
        <footer
          style={{
            padding: 'calc(var(--step) * 2) calc(var(--step) * 6)',
            borderTop: '1px solid var(--rule-soft)',
            color: 'var(--paper-faint)',
            fontSize: 'var(--t-micro)',
          }}
          title={giveawayState.giveaway.id}
        >
          Sorteo {giveawayState.giveaway.id.slice(0, 8)}
        </footer>
      )}
    </main>
  )
}
