// Returns the status of a room for the current cycle based on its reading.
// 'unrecorded' → no icon (not recorded yet)
// 'flagged'    → yellow circle (recorded + note without "resolved")
// 'ok'         → green circle (recorded, no note OR note contains "resolved")
export function getRoomStatus(reading) {
  if (!reading) return 'unrecorded'
  const note = (reading.notes ?? '').trim()
  if (!note) return 'ok'
  if (note.toLowerCase().includes('resolved')) return 'ok'
  return 'flagged'
}
