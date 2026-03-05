import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDateTime } from '../utils/time'

const HOUSES = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6']

export default function HomePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeCycle, setActiveCycle] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchCycle() {
      const { data, error } = await supabase
        .from('cycles')
        .select('id')
        .eq('status', 'active')
        .single()

      if (error || !data) {
        setError('Không tìm thấy chu kỳ đang hoạt động.')
        return
      }
      setActiveCycle(data.id)
      setFetchedAt(new Date())
    }
    fetchCycle()
  }, [])

  function handleChange() {
    logout()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-gray-100 flex justify-center">
      <div className="w-full max-w-[480px] flex flex-col px-4 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">VTPT Meter</h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Cycle badge */}
            {activeCycle ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                {activeCycle}
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                {error || 'Đang tải...'}
              </span>
            )}

            {/* User badge */}
            {user && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-900 text-white">
                {user.role === 'admin' ? 'Admin' : user.display_name}
              </span>
            )}
          </div>

          {/* Last fetched timestamp */}
          {fetchedAt && (
            <p className="mt-2.5 text-xs text-gray-400">
              Cập nhật lúc {formatDateTime(fetchedAt)}
            </p>
          )}
        </div>

        {/* Icon buttons */}
        <div className="flex items-center gap-1 mt-1">
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-200 active:bg-gray-300 transition-colors"
            aria-label="Cài đặt"
          >
            <Settings size={20} />
          </button>
          <button
            onClick={handleChange}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-200 active:bg-gray-300 transition-colors"
            aria-label="Đăng xuất"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* House buttons */}
      <div className="flex flex-col gap-3">
        {HOUSES.map((house) => (
          <button
            key={house}
            onClick={() => navigate(`/house/${house}`)}
            className="w-full flex items-center justify-between px-5 py-4 bg-white rounded-2xl
                       shadow-sm border border-gray-100 active:bg-gray-50
                       text-left transition-colors"
          >
            <span className="text-xl font-bold text-gray-900">{house}</span>
            <svg
              className="w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
      </div>
    </div>
  )
}
