/** Dialog title matching what `ImageNotesContent` shows for these values. */
export function imageNotesTitle(description?: string | null, instructorNote?: string | null) {
  const hasDescription = !!description?.trim()
  const hasInstructorNote = !!instructorNote?.trim()
  if (hasDescription && hasInstructorNote) return 'Description & instructor note'
  return hasInstructorNote ? 'Instructor note' : 'Description'
}
