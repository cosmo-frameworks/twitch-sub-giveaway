import { useCallback, useMemo, useState } from 'react'

import { GiveawayAdapter } from '@giveaway/application/adapters/giveaway.adapter'
import { GiveawayUseCases } from '@giveaway/infrastructure/usecases/giveaway.usecases'

import { handleErrorResponse } from '@lib/utils'

import type { GiveawayI, ParticipantI, TotalsI } from '@giveaway/domain/models/ParticipantI'
import type { DrawInputT } from '@giveaway/domain/inputs/draw.input'
import type { ManualEntriesInputT } from '@giveaway/domain/inputs/manualEntries.input'
import type { DrawResponseI, VerifyResponseI } from '@giveaway/domain/models/ResponseI'

const EMPTY_TOTALS: TotalsI = { entries: 0, weight: 0, participants: 0 }

export const useGiveaway = (giveawayId: string | null) => {
  const [giveaway, setGiveaway] = useState<GiveawayI | null>(null)
  const [participants, setParticipants] = useState<ParticipantI[]>([])
  const [totals, setTotals] = useState<TotalsI>(EMPTY_TOTALS)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  /** `userId` de quien acaba de sumar papeletas, para resaltarlo un instante. */
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const giveawayUseCases = useMemo(() => {
    const giveawayAdapter = new GiveawayAdapter()
    return new GiveawayUseCases(giveawayAdapter)
  }, [])

  const getEntries = useCallback(async () => {
    if (!giveawayId) return
    setLoading(true)
    try {
      const response = await giveawayUseCases.getEntries(giveawayId)
      setGiveaway(response.giveaway)
      setParticipants(response.participants)
      setTotals(response.totals)
      setError(null)
    } catch (caught) {
      setError(handleErrorResponse(caught))
    } finally {
      setLoading(false)
    }
  }, [giveawayUseCases, giveawayId])

  /**
   * Aplica una papeleta nueva sin volver a pedir la lista entera.
   *
   * El criterio de la fase 6 es que la fila aparezca en menos de un segundo: un
   * refetch por evento no aguantaría un gift bomb de 20 seguidos.
   */
  const applyEntryAdded = useCallback((participant: ParticipantI, newTotals: TotalsI) => {
    setParticipants((current) => {
      const rest = current.filter(
        (p) => !(p.platform === participant.platform && p.userId === participant.userId),
      )
      // Mismo orden que el backend: más papeletas primero, luego por nombre.
      return [...rest, participant].sort(
        (a, b) => b.entries - a.entries || a.displayName.localeCompare(b.displayName, 'es'),
      )
    })
    setTotals(newTotals)
    setJustAdded(participant.userId)
  }, [])

  const clearJustAdded = useCallback(() => setJustAdded(null), [])

  const [drawing, setDrawing] = useState<boolean>(false)
  const [lastDraw, setLastDraw] = useState<DrawResponseI | null>(null)
  const [verification, setVerification] = useState<VerifyResponseI | null>(null)
  const [verifying, setVerifying] = useState<boolean>(false)

  const drawWinners = useCallback(
    async (input: DrawInputT): Promise<boolean> => {
      if (!giveawayId) return false
      setDrawing(true)
      setVerification(null)
      try {
        setLastDraw(await giveawayUseCases.drawWinners(giveawayId, input))
        setError(null)
        return true
      } catch (caught) {
        setError(handleErrorResponse(caught))
        return false
      } finally {
        setDrawing(false)
      }
    },
    [giveawayUseCases, giveawayId],
  )

  /** Rehace la tirada desde la semilla, que es lo que zanja una discusión. */
  const verifyDraw = useCallback(
    async (seed: string): Promise<boolean> => {
      if (!giveawayId) return false
      setVerifying(true)
      try {
        setVerification(await giveawayUseCases.verifyDraw(giveawayId, seed))
        return true
      } catch (caught) {
        setError(handleErrorResponse(caught))
        return false
      } finally {
        setVerifying(false)
      }
    },
    [giveawayUseCases, giveawayId],
  )

  const dismissDraw = useCallback(() => {
    setLastDraw(null)
    setVerification(null)
  }, [])

  const [addingManual, setAddingManual] = useState<boolean>(false)
  const [openingGiveaway, setOpeningGiveaway] = useState<boolean>(false)
  const [notice, setNotice] = useState<string | null>(null)

  const addManualEntries = useCallback(
    async (input: ManualEntriesInputT): Promise<boolean> => {
      if (!giveawayId) return false
      setAddingManual(true)
      try {
        const response = await giveawayUseCases.addManualEntries(giveawayId, input)
        setNotice(
          `Añadidas ${response.added} papeleta${response.added === 1 ? '' : 's'} a ${input.login}.`,
        )
        setError(null)
        return true
      } catch (caught) {
        setError(handleErrorResponse(caught))
        return false
      } finally {
        setAddingManual(false)
      }
    },
    [giveawayUseCases, giveawayId],
  )

  const openGiveaway = useCallback(
    async (name: string): Promise<boolean> => {
      setOpeningGiveaway(true)
      try {
        setNotice((await giveawayUseCases.openGiveaway(name)).message)
        setError(null)
        return true
      } catch (caught) {
        setError(handleErrorResponse(caught))
        return false
      } finally {
        setOpeningGiveaway(false)
      }
    },
    [giveawayUseCases],
  )

  const closeGiveaway = useCallback(async (): Promise<boolean> => {
    if (!giveawayId) return false
    try {
      await giveawayUseCases.closeGiveaway(giveawayId)
      setNotice('Sorteo cerrado. No entrarán papeletas nuevas hasta que lo reabras.')
      return true
    } catch (caught) {
      setError(handleErrorResponse(caught))
      return false
    }
  }, [giveawayUseCases, giveawayId])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return {
    giveaway,
    participants,
    totals,
    loading,
    error,
    justAdded,
    getEntries,
    applyEntryAdded,
    clearJustAdded,
    drawing,
    lastDraw,
    verification,
    verifying,
    drawWinners,
    verifyDraw,
    dismissDraw,
    addingManual,
    openingGiveaway,
    notice,
    addManualEntries,
    openGiveaway,
    closeGiveaway,
    dismissNotice,
  }
}
