import { useState, useRef, useCallback, useMemo } from 'react'
import { updateUser as apiUpdateUser, userMessage } from './api'
import type { ApiUser } from './api'
import type { User } from './types'

export interface UseUserProfileDeps {
  currentUser: User | null
  setErrorSnack: React.Dispatch<React.SetStateAction<string | null>>
  loadPrograms: () => Promise<void>
  /** Called after a successful profile save. Defaults to window.location.reload(). */
  onProfileSaved?: () => void
}

export function useUserProfile(deps: UseUserProfileDeps) {
  const { currentUser, setErrorSnack, loadPrograms, onProfileSaved } = deps

  const avatarRef = useRef<HTMLButtonElement>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)

  const currentApiUser: ApiUser | null = useMemo(
    () =>
      currentUser
        ? {
            id: currentUser.id,
            name: currentUser.name,
            email: currentUser.email,
            role: currentUser.role,
            program_ids: currentUser.program_ids ?? [],
            program_names: currentUser.program_names ?? [],
            group_ids: currentUser.group_ids ?? [],
            group_names: currentUser.group_names ?? [],
            last_access: currentUser.lastAccess ?? null,
            metadata_extra: null,
            created_at: '',
            updated_at: '',
          }
        : null,
    [currentUser],
  )

  const openEditProfile = useCallback(() => {
    setProfileOpen(false)
    loadPrograms()
    setEditModalOpen(true)
  }, [loadPrograms])

  const handleSaveProfile = useCallback(
    async (data: {
      name?: string
      email?: string
      role?: string
      password?: string
      program_ids?: number[]
    }) => {
      if (!currentUser) return
      try {
        await apiUpdateUser(currentUser.id, data)
        setEditModalOpen(false)
        if (onProfileSaved) {
          onProfileSaved()
        } else {
          window.location.reload()
        }
      } catch (err) {
        console.error('Failed to update profile', err)
        setErrorSnack(userMessage(err, 'Failed to update profile.'))
      }
    },
    [currentUser, setErrorSnack, onProfileSaved],
  )

  return {
    avatarRef,
    profileOpen,
    setProfileOpen,
    editModalOpen,
    setEditModalOpen,
    currentApiUser,
    openEditProfile,
    handleSaveProfile,
  }
}
