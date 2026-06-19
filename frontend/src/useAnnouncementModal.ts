import { useState, useCallback, useRef } from 'react'
import { fetchAnnouncement, updateAnnouncement, userMessage } from './api'

const DISMISSED_PREFIX = 'dismissed_announcement'

export function useAnnouncementModal(userId?: number) {
  const dismissedKey = userId ? `${DISMISSED_PREFIX}_${userId}` : DISMISSED_PREFIX
  const [announcement, setAnnouncement] = useState('')
  const [annModalOpen, setAnnModalOpen] = useState(false)
  const [annMessage, setAnnMessage] = useState('')
  const [annEnabled, setAnnEnabled] = useState(false)
  const [annDraftMessage, setAnnDraftMessage] = useState('')
  const [annDraftEnabled, setAnnDraftEnabled] = useState(false)
  const [annSaving, setAnnSaving] = useState(false)
  const [annError, setAnnError] = useState<string | null>(null)
  const annUpdatedAt = useRef<string | null>(null)

  const loadAnnouncement = useCallback(async () => {
    try {
      const ann = await fetchAnnouncement()
      annUpdatedAt.current = ann.updated_at
      const dismissed = localStorage.getItem(dismissedKey)
      const visible = ann.enabled && dismissed !== ann.updated_at
      setAnnouncement(visible ? ann.message : '')
      setAnnMessage(ann.message)
      setAnnEnabled(ann.enabled)
    } catch {
      // Silently ignore — announcement is non-critical
    }
  }, [dismissedKey])

  const openAnnModal = useCallback(() => {
    setAnnDraftMessage(annMessage)
    setAnnDraftEnabled(annEnabled)
    setAnnError(null)
    setAnnModalOpen(true)
  }, [annMessage, annEnabled])

  const dismissAnnouncement = useCallback(() => {
    if (annUpdatedAt.current) {
      localStorage.setItem(dismissedKey, annUpdatedAt.current)
    }
    setAnnouncement('')
  }, [dismissedKey])

  const handleAnnSave = useCallback(async () => {
    setAnnSaving(true)
    try {
      const updated = await updateAnnouncement({
        message: annDraftMessage,
        enabled: annDraftEnabled,
      })
      annUpdatedAt.current = updated.updated_at
      localStorage.removeItem(dismissedKey)
      setAnnMessage(updated.message)
      setAnnEnabled(updated.enabled)
      setAnnouncement(updated.enabled ? updated.message : '')
      setAnnModalOpen(false)
    } catch (err) {
      setAnnError(userMessage(err, 'Failed to update announcement'))
    } finally {
      setAnnSaving(false)
    }
  }, [annDraftMessage, annDraftEnabled, dismissedKey])

  return {
    announcement,
    annMessage,
    annEnabled,
    dismissAnnouncement,
    loadAnnouncement,
    annModalOpen,
    setAnnModalOpen,
    annDraftMessage,
    setAnnDraftMessage,
    annDraftEnabled,
    setAnnDraftEnabled,
    annSaving,
    annError,
    setAnnError,
    openAnnModal,
    handleAnnSave,
  }
}
