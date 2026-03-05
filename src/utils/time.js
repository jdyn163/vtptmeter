const VN_TZ = 'Asia/Ho_Chi_Minh'

// "04/03/2026 @ 14:35" — used for timestamps throughout the app
export function formatDateTime(dateInput) {
  if (!dateInput) return ''
  const d = new Date(dateInput)
  const date = d.toLocaleDateString('vi-VN', {
    timeZone: VN_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('vi-VN', {
    timeZone: VN_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return `${date} @ ${time}`
}

// "04/03/2026" — used for date-only display (history table)
export function formatDate(dateInput) {
  if (!dateInput) return ''
  const d = new Date(dateInput)
  return d.toLocaleDateString('vi-VN', {
    timeZone: VN_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// Returns current Vietnam time as a Date object
export function nowVN() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: VN_TZ }))
}

// "04/03/2026" from a YYYY-MM-DD string (no timezone conversion needed)
export function formatDateString(yyyymmdd) {
  if (!yyyymmdd) return ''
  const [y, m, d] = yyyymmdd.split('-')
  return `${d}/${m}/${y}`
}
