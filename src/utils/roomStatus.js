// Returns the status of a room for the current cycle based on its reading.
// 'unrecorded' → no icon (not recorded yet)
// 'flagged'    → yellow circle (recorded + note without "resolved", OR negative diff vs prev)
// 'ok'         → green circle (recorded, no note OR note contains "resolved", no negative diff)
export function getRoomStatus(reading, prevReading) {
  if (!reading) return 'unrecorded'
  const note = (reading.notes ?? '').trim()
  const resolved = note.toLowerCase().includes('resolved')
  if (resolved) return 'ok'
  if (note) return 'flagged'
  // Flag negative difference when there's no note
  if (prevReading) {
    if (reading.dien != null && prevReading.dien != null && reading.dien < prevReading.dien) return 'flagged'
    if (reading.nuoc != null && prevReading.nuoc != null && reading.nuoc < prevReading.nuoc) return 'flagged'
  }
  return 'ok'
}
