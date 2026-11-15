import { useState } from 'react'
import { fetchBoard, replaceBoardOwners, transferBoard } from '../api'
import type { ApiBoard, CollectionOwner, Program } from '../types'
import CollectionOwnersDialog from './CollectionOwnersDialog'

export interface BoardOwnersDialogProps {
  board: ApiBoard
  programs?: Program[]
  onClose: () => void
  onSaved: () => void
}

export default function BoardOwnersDialog({
  board,
  programs,
  onClose,
  onSaved,
}: BoardOwnersDialogProps) {
  const [current, setCurrent] = useState(board)
  const owners: CollectionOwner[] = current.owners.flatMap((owner): CollectionOwner[] =>
    owner.user_id != null
      ? [
          {
            kind: 'user',
            userId: owner.user_id,
            name: owner.name,
            ...(owner.role ? { role: owner.role } : {}),
          },
        ]
      : owner.program_id != null
        ? [{ kind: 'program', programId: owner.program_id, name: owner.name }]
        : [],
  )
  return (
    <CollectionOwnersDialog
      key={current.version}
      open
      collection={{ id: current.id, name: current.name, owners }}
      entityLabel="Board"
      programs={programs}
      onClose={onClose}
      onReloadConflict={async () => {
        setCurrent(await fetchBoard(current.id))
      }}
      onSaveOwners={async (id, user_ids) => {
        await replaceBoardOwners(id, { user_ids, version: current.version })
        onSaved()
      }}
      onTransfer={async (id, program_id) => {
        await transferBoard(id, { program_id, version: current.version })
        onSaved()
      }}
    />
  )
}
