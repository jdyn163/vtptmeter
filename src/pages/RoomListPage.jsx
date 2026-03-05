import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, CheckCircle, CircleAlert, Zap, Droplet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDateTime } from '../utils/time'
import { getRoomStatus } from '../utils/roomStatus'

function StatusDot({ status }) {
  if (status === 'ok') {
    return <CheckCircle size={15} className="text-green-500 shrink-0" />
  }
  if (status === 'flagged') {
    return <CircleAlert size={15} className="text-amber-400 shrink-0" />
  }
  return null // not yet recorded — no space reserved
}

export default function RoomListPage() {
  const { houseId } = useParams()
  const navigate = useNavigate()

  const [rooms, setRooms] = useState([])
  const [activeCycle, setActiveCycle] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError('')

      // 1. Active cycle
      const { data: cycleData, error: cycleErr } = await supabase
        .from('cycles')
        .select('id')
        .eq('status', 'active')
        .single()

      if (cycleErr || !cycleData) {
        setError('Không tìm thấy chu kỳ đang hoạt động.')
        setLoading(false)
        return
      }
      const cycleId = cycleData.id
      setActiveCycle(cycleId)

      // 2. All rooms for this house
      const { data: roomsData, error: roomsErr } = await supabase
        .from('rooms')
        .select('id')
        .eq('house_id', houseId)
        .order('id')

      if (roomsErr || !roomsData) {
        setError('Không tải được danh sách phòng.')
        setLoading(false)
        return
      }

      // 3. All readings for this house + current cycle
      const { data: readingsData } = await supabase
        .from('readings')
        .select('room_id, dien, nuoc, notes')
        .eq('cycle_id', cycleId)
        .like('room_id', `${houseId}-%`)

      // 4. Previous cycle (most recent closed cycle before the active one)
      const { data: prevCycleData } = await supabase
        .from('cycles')
        .select('id')
        .eq('status', 'closed')
        .lt('id', cycleId)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle()

      const prevReadingsByRoom = {}
      if (prevCycleData) {
        const { data: prevReadingsData } = await supabase
          .from('readings')
          .select('room_id, dien, nuoc')
          .eq('cycle_id', prevCycleData.id)
          .like('room_id', `${houseId}-%`)
        prevReadingsData?.forEach((r) => { prevReadingsByRoom[r.room_id] = r })
      }

      // 5. Merge readings into rooms
      const readingsByRoom = {}
      readingsData?.forEach((r) => { readingsByRoom[r.room_id] = r })

      setRooms(roomsData.map((room) => ({
        id: room.id,
        reading: readingsByRoom[room.id] ?? null,
        prevReading: prevReadingsByRoom[room.id] ?? null,
      })))
      setFetchedAt(new Date())
      setLoading(false)
    }

    fetchData()
  }, [houseId])

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full max-w-[480px] flex flex-col">

        {/* Header */}
        <div className="sticky top-0 z-10 bg-gray-100 px-4 pt-8 pb-4">
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => navigate('/home')}
              className="p-1.5 -ml-1.5 rounded-xl text-gray-500 hover:bg-gray-200 active:bg-gray-300 transition-colors"
              aria-label="Quay lại"
            >
              <ChevronLeft size={22} />
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Dãy {houseId}</h1>
            {activeCycle && (
              <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                {activeCycle}
              </span>
            )}
          </div>
          {fetchedAt && (
            <p className="text-xs text-gray-400 pl-8">
              Cập nhật lúc {formatDateTime(fetchedAt)}
            </p>
          )}
        </div>

        {/* Room list */}
        <div className="px-4 pb-8">
          {loading && (
            <p className="text-center text-gray-400 py-16 text-sm">Đang tải...</p>
          )}

          {error && (
            <p className="text-center text-red-500 py-16 text-sm">{error}</p>
          )}

          {!loading && !error && (
            <div className="flex flex-col gap-2">
              {rooms.map(({ id, reading, prevReading }) => {
                const status = getRoomStatus(reading, prevReading)
                return (
                  <button
                    key={id}
                    onClick={() => navigate(`/house/${houseId}/room/${id}`)}
                    className="w-full flex items-center gap-3 px-5 py-4 bg-white rounded-2xl border border-gray-100 shadow-sm text-left transition active:scale-[0.98] active:bg-gray-50"
                  >
                    {/* Left: status + room ID */}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <StatusDot status={status} />
                      <span className="font-bold text-gray-900 text-base truncate">{id}</span>
                    </div>

                    {/* Middle: Điện */}
                    <div className="flex flex-col items-center w-16 shrink-0">
                      <span className="flex items-center gap-0.5 text-[10px] text-gray-400 leading-none mb-1"><Zap size={10} className="text-amber-400" />Điện</span>
                      <span className="font-bold text-gray-900 text-base leading-none">
                        {reading?.dien != null ? reading.dien : '---'}
                      </span>
                    </div>

                    {/* Right: Nước */}
                    <div className="flex flex-col items-center w-16 shrink-0">
                      <span className="flex items-center gap-0.5 text-[10px] text-gray-400 leading-none mb-1"><Droplet size={10} className="text-blue-400" />Nước</span>
                      <span className="font-bold text-gray-900 text-base leading-none">
                        {reading?.nuoc != null ? reading.nuoc : '---'}
                      </span>
                    </div>

                    <ChevronLeft size={16} className="text-gray-300 rotate-180 shrink-0" />
                  </button>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
