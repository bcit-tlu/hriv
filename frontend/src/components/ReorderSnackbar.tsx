import { useEffect, useState, useSyncExternalStore } from 'react'
import Fade from '@mui/material/Fade'
import Snackbar from '@mui/material/Snackbar'

import ReorderStatusIndicator, { type ReorderStatusIndicatorProps } from './ReorderStatusIndicator'
import type { TileOrderStatus } from '../tileOrdering'

export interface ReorderSnackbarProps extends ReorderStatusIndicatorProps {
  /** Position in the bottom-right stack (0 = just above the screen edge). */
  offsetIndex: number
}

const NOTIFICATION_STATUSES: ReadonlySet<TileOrderStatus> = new Set(['saved', 'error', 'conflict'])

const TRANSIENT_STATUSES: ReadonlySet<TileOrderStatus> = new Set(['saved'])

interface Notification {
  key: number
  status: TileOrderStatus
  otherScopesFailed: boolean
  open: boolean
}

interface NotificationStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => Notification[]
  update: (status: TileOrderStatus, otherScopesFailed: boolean) => void
  close: (key: number) => void
  remove: (key: number) => void
}

function createNotificationStore(): NotificationStore {
  let notifications: Notification[] = []
  const listeners: (() => void)[] = []
  let previousStatus: TileOrderStatus | '' = ''
  let previousOtherFailed: boolean | undefined = undefined
  let key = 0

  function emit() {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    subscribe(listener) {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index !== -1) listeners.splice(index, 1)
      }
    },
    getSnapshot() {
      return notifications
    },
    update(status, otherScopesFailed) {
      const toAdd: Notification[] = []

      if (previousStatus !== status) {
        if (NOTIFICATION_STATUSES.has(status)) {
          toAdd.push({ key: ++key, status, otherScopesFailed: false, open: true })
        }
        previousStatus = status
      }

      if (previousOtherFailed !== otherScopesFailed) {
        if (otherScopesFailed) {
          toAdd.push({ key: ++key, status: 'idle', otherScopesFailed: true, open: true })
        }
        previousOtherFailed = otherScopesFailed
      }

      if (toAdd.length === 0) return

      notifications = [...notifications, ...toAdd]
      emit()
    },
    close(keyToClose) {
      const next = notifications.map((n) =>
        n.key === keyToClose && n.open ? { ...n, open: false } : n,
      )
      if (next.every((n, i) => n === notifications[i])) return
      notifications = next
      emit()
    },
    remove(keyToRemove) {
      const next = notifications.filter((n) => n.key !== keyToRemove)
      if (next.length === notifications.length) return
      notifications = next
      emit()
    },
  }
}

function useReorderNotifications(
  status: TileOrderStatus,
  otherScopesFailed: boolean,
): { notifications: Notification[]; close: (key: number) => void; remove: (key: number) => void } {
  const [store] = useState(createNotificationStore)

  useEffect(() => {
    store.update(status, otherScopesFailed)
  }, [store, status, otherScopesFailed])

  const notifications = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return { notifications, close: store.close, remove: store.remove }
}

/**
 * Bottom-right snackbar(s) for tile-reorder save state.
 *
 * Only final outcomes are surfaced: "Order saved", "Could not save order",
 * and "Order changed elsewhere". Intermediate "Saving order…" states are
 * intentionally not shown.
 *
 * Each final state becomes its own snackbar so quick successive re-orders stack
 * like the processing/upload snackbars in App.tsx. Success notifications fade
 * out after 1200 ms; error/conflict notifications persist until the user acts
 * on or dismisses them. Stacking uses the same 88 px vertical spacing: pass an
 * `offsetIndex` one greater than the last processing job index.
 */
export default function ReorderSnackbar({ offsetIndex, ...indicatorProps }: ReorderSnackbarProps) {
  const { status, otherScopesFailed } = indicatorProps
  const { notifications, close, remove } = useReorderNotifications(
    status,
    otherScopesFailed ?? false,
  )

  if (notifications.length === 0) {
    return null
  }

  return (
    <>
      {notifications.map((notification, index) => {
        const isTransient = TRANSIENT_STATUSES.has(notification.status)
        return (
          <Snackbar
            key={notification.key}
            open={notification.open}
            autoHideDuration={isTransient ? 1200 : null}
            onClose={(_event, reason) => {
              // Persistent action snackbars must stay reachable. Only timeout
              // (which cannot fire when autoHideDuration is null) and stray
              // clicks outside are suppressed; Escape still dismisses.
              if (!isTransient && (reason === 'timeout' || reason === 'clickaway')) return
              close(notification.key)
            }}
            TransitionProps={{
              onExited: () => remove(notification.key),
            }}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            TransitionComponent={Fade}
            sx={{
              zIndex: 1500,
              bottom: { xs: `${24 + (offsetIndex + index) * 88}px !important` },
            }}
          >
            <ReorderStatusIndicator
              {...indicatorProps}
              status={notification.status}
              otherScopesFailed={notification.otherScopesFailed}
            />
          </Snackbar>
        )
      })}
    </>
  )
}
