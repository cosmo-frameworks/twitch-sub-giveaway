import React from 'react'

import type { StatusDotPropsI } from '../interfaces/StatusDotI'

const TONE_COLOR: Record<StatusDotPropsI['tone'], string> = {
  live: 'var(--live)',
  warn: 'var(--warn)',
  alert: 'var(--alert)',
  idle: 'var(--paper-faint)',
}

/**
 * Indicador de estado. El color nunca va solo: siempre lleva su palabra al
 * lado, porque un punto verde no le dice nada a quien no distingue el verde.
 */
export const StatusDot: React.FC<StatusDotPropsI> = ({ tone, label, title }) => (
  <span
    title={title ?? label}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'calc(var(--step) * 2)',
      color: tone === 'idle' ? 'var(--paper-dim)' : TONE_COLOR[tone],
      fontSize: 14,
      fontWeight: 500,
    }}
  >
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: TONE_COLOR[tone],
        boxShadow: tone === 'live' ? `0 0 0 3px color-mix(in srgb, ${TONE_COLOR.live} 20%, transparent)` : 'none',
        flexShrink: 0,
      }}
    />
    {label}
  </span>
)
