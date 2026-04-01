import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, X, RefreshCw, Zap, Droplet, ClipboardList } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { formatDateTime, formatDateString, nowVN } from '../utils/time'

function todayVN() {
  const d = nowVN()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ─── Screen 5: Record Reading Modal ───────────────────────────────────────────
function RecordModal({ reading, cycleId, roomId, user, onSave, onClose }) {
  const isEdit = !!reading
  const [dien, setDien] = useState(reading?.dien != null ? String(reading.dien) : '')
  const [nuoc, setNuoc] = useState(reading?.nuoc != null ? String(reading.nuoc) : '')
  const [notes, setNotes] = useState(reading?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')

    const fields = {
      dien: dien !== '' ? Number(dien) : null,
      nuoc: nuoc !== '' ? Number(nuoc) : null,
      notes: notes.trim() || null,
    }

    let err
    if (isEdit) {
      const { error: e } = await supabase
        .from('readings')
        .update(fields)
        .eq('id', reading.id)
      err = e
    } else {
      const { error: e } = await supabase
        .from('readings')
        .insert({
          room_id: roomId,
          cycle_id: cycleId,
          recorded_at: todayVN(),
          created_by: user.id,
          ...fields,
        })
      err = e
    }

    if (err) {
      setError('Lỗi lưu dữ liệu. Thử lại.')
      setSaving(false)
      return
    }

    await supabase.from('logs').insert({
      room_id: roomId,
      action: 'ADD',
      user_id: user.id,
      username: user.display_name,
      snapshot: {
        dien: fields.dien,
        nuoc: fields.nuoc,
        notes: fields.notes,
        recorded_at: reading?.recorded_at ?? todayVN(),
      },
    })

    setSaving(false)
    onSave()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] bg-white rounded-t-3xl p-6 pb-10 modal-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? 'Sửa số điện nước' : 'Ghi Số Điện Nước'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Zap size={11} className="text-amber-400" />Điện (kWh)</label>
            <input
              type="number"
              inputMode="numeric"
              value={dien}
              onChange={(e) => setDien(e.target.value)}
              placeholder="Nhập số điện"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Droplet size={11} className="text-blue-400" />Nước (m³)</label>
            <input
              type="number"
              inputMode="numeric"
              value={nuoc}
              onChange={(e) => setNuoc(e.target.value)}
              placeholder="Nhập số nước"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Ghi chú</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ie. thay đồng hồ"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-200 text-gray-600 font-semibold py-3.5 rounded-xl text-sm"
            >
              Huỷ
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 bg-blue-600 text-white font-semibold py-3.5 rounded-xl text-sm disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Edit / Delete Bottom Sheet (with delete confirmation) ─────────────────────
function EditDeleteSheet({ reading, roomId, user, onEdit, onDeleted, onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setDeleting(true)
    setError('')

    const { error: e } = await supabase.from('readings').delete().eq('id', reading.id)
    if (e) {
      setError('Lỗi xoá. Thử lại.')
      setDeleting(false)
      return
    }

    await supabase.from('logs').insert({
      room_id: roomId,
      action: 'DELETE',
      user_id: user.id,
      username: user.display_name,
      snapshot: {
        recorded_at: reading.recorded_at,
        dien: reading.dien,
        nuoc: reading.nuoc,
      },
    })

    setDeleting(false)
    onDeleted()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] bg-white rounded-t-3xl p-6 pb-10 modal-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-900">
            {formatDateString(reading.recorded_at)}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        {!confirming ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={onEdit}
              className="w-full bg-gray-900 text-white font-semibold py-3.5 rounded-xl text-sm"
            >
              Sửa
            </button>
            <button
              onClick={() => setConfirming(true)}
              className="w-full bg-red-50 text-red-600 font-semibold py-3.5 rounded-xl text-sm"
            >
              Xoá
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm text-gray-600 mb-4 text-center">
              Xác nhận xoá số đọc ngày {formatDateString(reading.recorded_at)}?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirming(false)}
                className="flex-1 border border-gray-200 text-gray-600 font-semibold py-3.5 rounded-xl text-sm"
              >
                Không
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white font-semibold py-3.5 rounded-xl text-sm disabled:opacity-50"
              >
                {deleting ? 'Đang xoá...' : 'Xoá'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function RoomDetailPage() {
  const { houseId, roomId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [activeCycle, setActiveCycle] = useState(null)
  const [currentReading, setCurrentReading] = useState(null)
  const [allReadings, setAllReadings] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('dien')

  // Record modal
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordReading, setRecordReading] = useState(null)
  const [recordCycleId, setRecordCycleId] = useState(null)

  // History row bottom sheet
  const [sheetRow, setSheetRow] = useState(null)

  async function fetchData() {
    setLoading(true)

    const { data: cycleData } = await supabase
      .from('cycles')
      .select('id')
      .eq('status', 'active')
      .single()
    const cycleId = cycleData?.id ?? null
    setActiveCycle(cycleId)

    // Curr reading, all history, and logs in parallel
    const [{ data: curr }, { data: hist }, { data: logsData }] = await Promise.all([
      cycleId
        ? supabase.from('readings').select('id, recorded_at, dien, nuoc, notes, created_at')
            .eq('room_id', roomId).eq('cycle_id', cycleId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('readings').select('id, cycle_id, recorded_at, dien, nuoc, notes')
        .eq('room_id', roomId).order('recorded_at', { ascending: false }),
      supabase.from('logs').select('id, action, username, created_at, snapshot')
        .eq('room_id', roomId).order('created_at', { ascending: false }),
    ])
    setCurrentReading(curr ?? null)
    setAllReadings(hist ?? [])
    setLogs(logsData ?? [])

    setLoading(false)
  }

  async function refreshLogs() {
    setLogsLoading(true)
    const { data: logsData } = await supabase
      .from('logs')
      .select('id, action, username, created_at, snapshot')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
    setLogs(logsData ?? [])
    setLogsLoading(false)
  }

  useEffect(() => { fetchData() }, [roomId])

  function openCardModal() {
    if (!activeCycle) return
    setRecordReading(currentReading)
    setRecordCycleId(activeCycle)
    setRecordOpen(true)
  }

  function openEditFromSheet(reading) {
    setSheetRow(null)
    setRecordReading(reading)
    setRecordCycleId(reading.cycle_id)
    setRecordOpen(true)
  }

  function getHistoryWithDiff(field) {
    const filtered = allReadings.filter((r) => r[field] != null)
    return filtered.map((r, i) => {
      const prev = filtered[i + 1]
      return { ...r, diff: prev != null ? r[field] - prev[field] : null }
    })
  }

  function formatLogLine(log) {
    const ts = formatDateTime(log.created_at)
    const { action, username, snapshot } = log
    const parts = []

    if (action === 'DELETE') {
      if (snapshot.dien != null) parts.push(`dien [${snapshot.dien}]`)
      if (snapshot.nuoc != null) parts.push(`nuoc [${snapshot.nuoc}]`)
      if (snapshot.recorded_at) parts.push(`date [${formatDateString(snapshot.recorded_at)}]`)
    } else {
      // ADD or EDIT
      if (snapshot.dien != null) parts.push(`dien [${snapshot.dien}]`)
      if (snapshot.nuoc != null) parts.push(`nuoc [${snapshot.nuoc}]`)
      if (snapshot.notes) parts.push(`note [${snapshot.notes}]`)
    }

    const fields = parts.join(' ')
    return `[${ts}] ${username} ${action}${fields ? ' ' + fields : ''}`
  }

  const historyRows = activeTab !== 'log' ? getHistoryWithDiff(activeTab) : []

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full max-w-[480px] flex flex-col">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-100 px-4 pt-8 pb-4">
          <div className="flex items-start gap-2">
            <button
              onClick={() => navigate(`/house/${houseId}`)}
              className="p-1.5 -ml-1.5 rounded-xl text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors shrink-0"
              aria-label="Quay lại"
            >
              <ChevronLeft size={22} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900">{roomId}</h1>
                {activeCycle && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                    {activeCycle}
                  </span>
                )}
              </div>
              {currentReading?.created_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Cập nhật lúc {formatDateTime(currentReading.created_at)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pb-12">
          {loading ? (
            <p className="text-center text-gray-400 py-16 text-sm">Đang tải...</p>
          ) : (
            <>
              {/* Section label */}
              <p className="text-base font-bold text-gray-900 mb-3">Ghi Số Điện Nước</p>

              {/* Reading cards — stacked vertically */}
              <div className="flex flex-col gap-3 mb-3">
                <button
                  onClick={openCardModal}
                  disabled={!activeCycle}
                  className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-4 text-left transition active:scale-[0.98] active:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="text-xs text-gray-400 mb-2 flex items-center gap-1"><Zap size={11} className="text-amber-400" />Số Điện</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-gray-900 leading-none">
                      {currentReading?.dien != null ? currentReading.dien : '---.-'}
                    </span>
                    <span className="text-sm text-gray-400">kWh</span>
                  </div>
                </button>

                <button
                  onClick={openCardModal}
                  disabled={!activeCycle}
                  className="w-full bg-white border border-gray-100 rounded-2xl px-4 py-4 text-left transition active:scale-[0.98] active:bg-gray-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <p className="text-xs text-gray-400 mb-2 flex items-center gap-1"><Droplet size={11} className="text-blue-400" />Số Nước</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-gray-900 leading-none">
                      {currentReading?.nuoc != null ? currentReading.nuoc : '---.-'}
                    </span>
                    <span className="text-sm text-gray-400">m³</span>
                  </div>
                </button>
              </div>

              {/* Notes banner */}
              {currentReading?.notes && (() => {
                const resolved = currentReading.notes.toLowerCase().includes('resolved')
                return (
                  <div className={`mb-4 rounded-xl px-4 py-3 border ${resolved ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                    <p className={`text-xs ${resolved ? 'text-green-700' : 'text-amber-700'}`}>{currentReading.notes}</p>
                  </div>
                )
              })()}

              {/* Section label */}
              <p className="text-base font-bold text-gray-900 mb-3 mt-6">Dữ Liệu</p>

              {/* Tab pills — full width segmented control */}
              <div className="flex gap-2 mb-4">
                {[
                  { key: 'dien', label: 'Điện', icon: <Zap size={13} /> },
                  { key: 'nuoc', label: 'Nước', icon: <Droplet size={13} /> },
                  { key: 'log', label: 'Log', icon: <ClipboardList size={13} /> },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
                      activeTab === tab.key
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>

              {/* History card */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden px-4">

                {/* Điện / Nước history table */}
                {activeTab !== 'log' && (
                  historyRows.length === 0 ? (
                    <p className="text-center text-gray-400 py-8 text-sm">Chưa có dữ liệu</p>
                  ) : (
                    <div>
                      <div className="flex py-2 border-b border-gray-100">
                        <span className="flex-1 text-xs font-medium text-gray-400">Ngày</span>
                        <span className="flex-1 text-center text-xs font-medium text-gray-400">Số</span>
                        <span className="flex-1 text-right text-xs font-medium text-gray-400">Chênh Lệch</span>
                      </div>
                      {historyRows.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setSheetRow(r)}
                          className="w-full flex items-center py-3.5 border-b border-gray-100 last:border-b-0 active:bg-gray-50 transition-colors"
                        >
                          <span className="flex-1 text-sm text-gray-700 text-left">
                            {formatDateString(r.recorded_at)}
                          </span>
                          <span className="flex-1 text-center text-sm font-semibold text-gray-900">
                            {r[activeTab]}
                          </span>
                          <span className={`flex-1 text-right text-sm font-semibold ${r.diff == null ? 'text-gray-400' : r.diff >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {r.diff == null ? '--' : r.diff >= 0 ? `+${r.diff}` : `${r.diff}`}
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                )}

                {/* Log tab */}
                {activeTab === 'log' && (
                  <div>
                    <div className="flex items-center justify-between py-2 border-b border-gray-100">
                      <span className="text-xs font-medium text-gray-400">Room Log</span>
                      <button
                        onClick={refreshLogs}
                        disabled={logsLoading}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40"
                      >
                        <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
                        Refresh
                      </button>
                    </div>

                    {logs.length === 0 ? (
                      <p className="text-center text-gray-400 py-8 text-sm">Chưa có dữ liệu</p>
                    ) : (
                      <div>
                        {logs.map((log) => (
                          <div
                            key={log.id}
                            className="py-2 border-b border-gray-100 last:border-b-0"
                          >
                            <p className="text-xs text-gray-500 break-words">
                              {formatLogLine(log)}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Record / edit modal */}
      {recordOpen && (
        <RecordModal
          reading={recordReading}
          cycleId={recordCycleId}
          roomId={roomId}
          user={user}
          onSave={() => {
            setRecordOpen(false)
            setRecordReading(null)
            fetchData()
          }}
          onClose={() => {
            setRecordOpen(false)
            setRecordReading(null)
          }}
        />
      )}

      {/* History row action sheet */}
      {sheetRow && !recordOpen && (
        <EditDeleteSheet
          reading={sheetRow}
          roomId={roomId}
          user={user}
          onEdit={() => openEditFromSheet(sheetRow)}
          onDeleted={() => {
            setSheetRow(null)
            fetchData()
          }}
          onClose={() => setSheetRow(null)}
        />
      )}
    </div>
  )
}
