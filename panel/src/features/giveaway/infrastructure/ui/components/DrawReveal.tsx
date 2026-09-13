import React, { useEffect, useRef, useState } from 'react'

import { Button } from '@shared/components/button'

import type { ParticipantI } from '@giveaway/domain/models/ParticipantI'
import type { DrawResponseI, VerifyResponseI } from '@giveaway/domain/models/ResponseI'

export interface DrawRevealPropsI {
  result: DrawResponseI
  participants: ParticipantI[]
  verification: VerifyResponseI | null
  verifying: boolean
  archiving: boolean
  onVerify: (seed: string) => void
  /** Guarda este sorteo y deja el tablero vacío para el siguiente. */
  onArchive: () => void
  onClose: () => void
}

/** Cuánto dura el bombo antes de parar en el ganador. */
const SPIN_MS = 2200
const TICK_MS = 70

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * El único momento con movimiento de la aplicación: en directo, un nombre que
 * aparece de golpe no se vive igual que un bombo que para. Los nombres que
 * pasan son los participantes de verdad, así que quien mira se ve pasar.
 */
export const DrawReveal: React.FC<DrawRevealPropsI> = ({
  result,
  participants,
  verification,
  verifying,
  archiving,
  onVerify,
  onArchive,
  onClose,
}) => {
  const alreadySettled = result.alreadyDrawn || prefersReducedMotion()
  const [spinning, setSpinning] = useState<boolean>(!alreadySettled)
  const [rolling, setRolling] = useState<string>('')
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!spinning) return

    const names = participants.map((p) => p.displayName)
    if (names.length === 0) {
      setSpinning(false)
      return
    }

    let i = 0
    const ticker = window.setInterval(() => {
      setRolling(names[i % names.length] ?? '')
      i++
    }, TICK_MS)

    const stop = window.setTimeout(() => {
      window.clearInterval(ticker)
      setSpinning(false)
    }, SPIN_MS)

    return () => {
      window.clearInterval(ticker)
      window.clearTimeout(stop)
    }
  }, [spinning, participants])

  const nameOf = (userId: string): string =>
    participants.find((p) => p.userId === userId)?.displayName ?? userId

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resultado del sorteo"
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'color-mix(in srgb, var(--ink) 92%, transparent)',
        display: 'grid',
        placeItems: 'center',
        padding: 'calc(var(--step) * 6)',
        zIndex: 10,
      }}
    >
      <div style={{ maxWidth: '46rem', width: '100%', textAlign: 'center' }}>
        {spinning ? (
          <p
            aria-live="off"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(2rem, 7vw, 4.5rem)',
              margin: 0,
              lineHeight: 1.05,
              color: 'var(--paper-dim)',
            }}
          >
            {rolling || '…'}
          </p>
        ) : (
          <>
            <ol
              aria-live="polite"
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'calc(var(--step) * 3)' }}
            >
              {result.winners.map((winner) => (
                <li key={winner.id}>
                  {result.winners.length > 1 && (
                    <span style={{ color: 'var(--paper-dim)', fontSize: 15 }}>
                      Puesto {winner.position}
                    </span>
                  )}
                  <p
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'clamp(2.2rem, 8vw, 5rem)',
                      margin: 0,
                      lineHeight: 1.05,
                      letterSpacing: '-0.02em',
                    }}
                  >
                    {nameOf(winner.userId)}
                  </p>
                </li>
              ))}
            </ol>

            <p style={{ color: 'var(--paper-dim)', fontSize: 14, marginTop: 'calc(var(--step) * 6)' }}>
              Semilla de esta tirada
            </p>
            <p
              style={{
                margin: '2px 0 0',
                fontSize: 15,
                wordBreak: 'break-all',
                color: 'var(--paper)',
              }}
            >
              {result.seed}
            </p>
            <p
              style={{
                color: 'var(--paper-faint)',
                fontSize: 13,
                margin: '8px auto 0',
                maxWidth: '48ch',
              }}
            >
              Con esa semilla y estas papeletas, el sorteo sale igual siempre. Si alguien lo
              discute, se rehace delante de todos.
            </p>

            <div
              style={{
                display: 'flex',
                gap: 'calc(var(--step) * 2)',
                justifyContent: 'center',
                marginTop: 'calc(var(--step) * 5)',
                flexWrap: 'wrap',
              }}
            >
              <Button onClick={() => onVerify(result.seed)} disabled={verifying}>
                {verifying ? 'Rehaciendo…' : 'Rehacer el sorteo'}
              </Button>
              <Button onClick={onArchive} disabled={archiving}>
                {archiving ? 'Archivando…' : 'Archivar y empezar de cero'}
              </Button>
              <Button ref={closeRef} tone="primary" onClick={onClose}>
                Cerrar
              </Button>
            </div>

            {verification && (
              <p
                role="status"
                style={{
                  marginTop: 'calc(var(--step) * 4)',
                  fontSize: 14,
                  color: verification.matches ? 'var(--live)' : 'var(--alert)',
                }}
              >
                {verification.matches
                  ? `Sale lo mismo: ${verification.recomputed
                      .map((w) => nameOf(w.userId))
                      .join(', ')} sobre ${verification.pool.tickets} papeletas.`
                  : verification.explanation}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
