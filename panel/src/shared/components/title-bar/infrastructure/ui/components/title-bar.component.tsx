import React, { useEffect, useMemo, useState } from 'react'

import { desktopWindow } from '@lib/desktop'

import type { TitleBarPropsI, WindowButtonT } from '../interfaces/TitleBarI'

/** Se exporta porque el contenido tiene que descontarlo. */
export const TITLE_BAR_HEIGHT = 38

const BUTTON_COLOR: Record<WindowButtonT, string> = {
  close: '#ff5f57',
  minimize: '#febc2e',
  zoom: '#28c840',
}

const BUTTON_LABEL: Record<WindowButtonT, string> = {
  close: 'Cerrar',
  minimize: 'Minimizar',
  zoom: 'Maximizar',
}

/** Solo se ven al pasar por encima, como en macOS. */
const GLYPH: Record<WindowButtonT, React.ReactNode> = {
  close: <path d="M2 2 L6 6 M6 2 L2 6" strokeWidth={1.3} strokeLinecap="round" />,
  minimize: <path d="M1.8 4 H6.2" strokeWidth={1.3} strokeLinecap="round" />,
  // Dos puntas con una diagonal de aire: juntas parecen un cuadrado.
  zoom: (
    <>
      <path d="M1.6 1.6 H5 L1.6 5 Z" fill="currentColor" stroke="none" />
      <path d="M6.4 6.4 H3 L6.4 3 Z" fill="currentColor" stroke="none" />
    </>
  ),
}

interface WindowButtonPropsI {
  kind: WindowButtonT
  label: string
  revealed: boolean
  onClick: () => void
}

const WindowButton: React.FC<WindowButtonPropsI> = ({ kind, label, revealed, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    style={{
      width: 12,
      height: 12,
      padding: 0,
      borderRadius: '50%',
      border: 'none',
      background: BUTTON_COLOR[kind],
      // Un aro oscuro: sobre fondo claro los círculos planos se desdibujan.
      boxShadow: 'inset 0 0 0 0.5px rgba(0, 0, 0, 0.25)',
      display: 'grid',
      placeItems: 'center',
      lineHeight: 0,
    }}
  >
    {/* El color se fija aquí: heredado del botón, el relleno saldría color papel. */}
    <svg
      width={8}
      height={8}
      viewBox="0 0 8 8"
      aria-hidden
      fill="none"
      stroke="currentColor"
      style={{
        color: 'rgba(0, 0, 0, 0.62)',
        opacity: revealed ? 1 : 0,
        transition: 'opacity 120ms ease',
      }}
    >
      {GLYPH[kind]}
    </svg>
  </button>
)

/**
 * En el navegador no se pinta: no hay ventana que cerrar. La barra arrastra
 * (`app-region: drag`, en index.css) y por eso los botones van `no-drag`:
 * dentro de una zona de arrastre no llegan ni los clics.
 */
export const TitleBar: React.FC<TitleBarPropsI> = ({ title = 'Sorteo de subs' }) => {
  const controls = useMemo(() => desktopWindow(), [])
  const [maximized, setMaximized] = useState<boolean>(false)
  const [revealed, setRevealed] = useState<boolean>(false)

  useEffect(() => {
    if (!controls) return
    void controls.isMaximized().then(setMaximized)
    // La ventana también se maximiza con doble clic, con Snap o con el teclado.
    return controls.onMaximizedChange(setMaximized)
  }, [controls])

  if (!controls) return null

  return (
    /*
     * Tres columnas en vez de una capa absoluta para centrar el título:
     * `app-region` SE HEREDA, y esa capa heredaba `drag` y se comía los clics de
     * los botones. Chromium calcula el arrastre por geometría, así que
     * `pointer-events: none` no le quitaba ni un píxel.
     */
    <div
      className="titlebar"
      style={{
        flexShrink: 0,
        height: TITLE_BAR_HEIGHT,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        paddingLeft: 13,
        background: 'var(--ink-sunken)',
        borderBottom: '1px solid var(--rule-soft)',
        userSelect: 'none',
      }}
    >
      <div
        className="titlebar__controls"
        style={{ display: 'flex', gap: 8, alignItems: 'center', justifySelf: 'start' }}
        onMouseEnter={() => setRevealed(true)}
        onMouseLeave={() => setRevealed(false)}
        onFocus={() => setRevealed(true)}
        onBlur={() => setRevealed(false)}
      >
        <WindowButton
          kind="close"
          label={BUTTON_LABEL.close}
          revealed={revealed}
          onClick={() => void controls.close()}
        />
        <WindowButton
          kind="minimize"
          label={BUTTON_LABEL.minimize}
          revealed={revealed}
          onClick={() => void controls.minimize()}
        />
        <WindowButton
          kind="zoom"
          label={maximized ? 'Restaurar' : BUTTON_LABEL.zoom}
          revealed={revealed}
          onClick={() => void controls.toggleMaximize().then(setMaximized)}
        />
      </div>

      {/* Sin el recorte, un canal de nombre largo empujaría a los botones. */}
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
          color: 'var(--paper-dim)',
        }}
      >
        {title}
      </span>
    </div>
  )
}
