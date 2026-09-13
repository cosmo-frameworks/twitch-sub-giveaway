import React, { useEffect, useMemo, useState } from 'react'

import { Button } from '@shared/components/button'

import { desktopUpdate, type UpdateStateT } from '@lib/desktop'

/**
 * Pequeño y abajo porque aparece en mitad de un directo: un cartel grande
 * competiría con la lista de papeletas. Mientras descarga no se enseña nada —un
 * porcentaje no le sirve a quien no puede hacer nada con él.
 */
export const UpdateNotice: React.FC = () => {
  const update = useMemo(() => desktopUpdate(), [])
  const [state, setState] = useState<UpdateStateT>({ state: 'idle' })

  useEffect(() => {
    if (!update) return
    void update.state().then(setState)
    return update.onChange(setState)
  }, [update])

  if (!update || state.state !== 'ready') return null

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--step) * 3)',
        padding: 'calc(var(--step) * 2) calc(var(--step) * 6)',
        borderTop: '1px solid var(--rule-soft)',
        background: 'var(--ink-sunken)',
        color: 'var(--paper-dim)',
        fontSize: 'var(--t-small)',
      }}
    >
      <span>
        Versión {state.version} lista. Se instala sola cuando cierres la aplicación.
      </span>
      <Button
        size="sm"
        onClick={() => void update.installNow()}
        title="Cierra la aplicación e instala ahora. Espera a que termines el directo."
      >
        Instalar ahora
      </Button>
    </div>
  )
}
