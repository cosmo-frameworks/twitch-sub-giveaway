import React, { useEffect } from 'react'

import { TitleBar } from '@shared/components/title-bar'
import { UpdateNotice } from '@shared/components/update-notice'

import { ConnectScreen } from '@status/infrastructure/ui/components/ConnectScreen'
import { GiveawayPage } from '@giveaway/infrastructure/ui/pages/GiveawayPage'

import { useStatus } from '@status/infrastructure/ui/hooks/useStatus'

/**
 * Mientras no haya canal conectado, lo único que se ve es la pantalla de
 * conectar. El tablero no tendría ni sorteo que enseñar.
 */
const App: React.FC = () => {
  const status = useStatus()
  const { getStatus, status: current } = status

  useEffect(() => {
    void getStatus()
  }, [getStatus])

  // Mientras se espera el código, se pregunta cada dos segundos: el streamer
  // está en otra pestaña y el cambio tiene que notarse al volver.
  const waiting = current?.device.state === 'waiting'
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => void getStatus(), 2000)
    return () => window.clearInterval(timer)
  }, [waiting, getStatus])

  const content = (): React.ReactNode => {
    if (!current) return null

    if (!current.broadcaster) {
      return (
        <ConnectScreen
          device={current.device}
          starting={status.connecting}
          onStart={() => void status.startDeviceConnect()}
          onCancel={() => void status.cancelDeviceConnect()}
        />
      )
    }

    return <GiveawayPage />
  }

  // La barra se pinta siempre, incluso sin datos: si esperase, habría un
  // instante con una ventana que no se puede ni mover ni cerrar.
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TitleBar title={current?.broadcaster ?? undefined} />
      {/* `hidden`: cada pantalla lleva su propio scroll. Si este también
          desplazara, saldrían dos barras anidadas. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{content()}</div>
      <UpdateNotice />
    </div>
  )
}

export default App
