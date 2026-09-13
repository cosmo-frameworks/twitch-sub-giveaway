import { useCallback, useMemo, useState } from 'react'

import { StatusAdapter } from '@status/application/adapters/status.adapter'
import { StatusUseCases } from '@status/infrastructure/usecases/status.usecases'

import { handleErrorResponse } from '@lib/utils'

import type { AuthStateT, PanelStatusI } from '@status/domain/models/StatusI'

export const useStatus = () => {
  const [status, setStatus] = useState<PanelStatusI | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [reauthorizing, setReauthorizing] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const statusUseCases = useMemo(() => {
    const statusAdapter = new StatusAdapter()
    return new StatusUseCases(statusAdapter)
  }, [])

  const getStatus = useCallback(async () => {
    setLoading(true)
    try {
      const response = await statusUseCases.getStatus()
      setStatus(response.status)
      setError(null)
    } catch (caught) {
      setError(handleErrorResponse(caught))
    } finally {
      setLoading(false)
    }
  }, [statusUseCases])

  const [connecting, setConnecting] = useState<boolean>(false)

  const startDeviceConnect = useCallback(async (): Promise<boolean> => {
    setConnecting(true)
    try {
      const response = await statusUseCases.startDeviceConnect()
      setStatus((current) => (current ? { ...current, device: response.device } : current))
      setError(null)
      return true
    } catch (caught) {
      setError(handleErrorResponse(caught))
      return false
    } finally {
      setConnecting(false)
    }
  }, [statusUseCases])

  const cancelDeviceConnect = useCallback(async (): Promise<boolean> => {
    try {
      await statusUseCases.cancelDeviceConnect()
      setStatus((current) => (current ? { ...current, device: { state: 'idle' } } : current))
      return true
    } catch (caught) {
      setError(handleErrorResponse(caught))
      return false
    }
  }, [statusUseCases])

  const reauthorize = useCallback(async (): Promise<boolean> => {
    setReauthorizing(true)
    try {
      await statusUseCases.reauthorize()
      setNotice('Se ha abierto el navegador. Autoriza con la cuenta del canal.')
      return true
    } catch (caught) {
      setError(handleErrorResponse(caught))
      return false
    } finally {
      setReauthorizing(false)
    }
  }, [statusUseCases])

  const saveDbPath = useCallback(
    async (dbPath: string | null): Promise<boolean> => {
      setSaving(true)
      try {
        const response = await statusUseCases.saveDbPath({ dbPath })
        setNotice(response.message)
        return true
      } catch (caught) {
        setError(handleErrorResponse(caught))
        return false
      } finally {
        setSaving(false)
      }
    },
    [statusUseCases],
  )

  /** El stream manda el estado de auth antes de que se note en el endpoint. */
  const applyAuthState = useCallback((state: AuthStateT, detail: string) => {
    setStatus((current) => (current ? { ...current, auth: { ...current.auth, state, detail } } : current))
  }, [])

  const applyEventSubState = useCallback((connected: boolean) => {
    setStatus((current) => (current ? { ...current, eventSub: { connected } } : current))
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    status,
    loading,
    reauthorizing,
    saving,
    error,
    notice,
    connecting,
    getStatus,
    startDeviceConnect,
    cancelDeviceConnect,
    reauthorize,
    saveDbPath,
    applyAuthState,
    applyEventSubState,
    dismissNotice,
  }
}
