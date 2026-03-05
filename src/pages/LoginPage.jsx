import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2 } from 'lucide-react'
import { loginWithPin } from '../lib/auth'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const [digits, setDigits] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRefs = [useRef(), useRef(), useRef(), useRef()]
  const { login } = useAuth()
  const navigate = useNavigate()

  function handleChange(index, value) {
    // Only accept a single digit
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    setError('')

    if (digit && index < 3) {
      inputRefs[index + 1].current.focus()
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs[index - 1].current.focus()
    }
  }

  function handlePaste(e) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted) return
    const next = ['', '', '', '']
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setDigits(next)
    setError('')
    // Focus the next empty box, or the last one
    const focusIndex = Math.min(pasted.length, 3)
    inputRefs[focusIndex].current.focus()
  }

  function handleClear() {
    setDigits(['', '', '', ''])
    setError('')
    inputRefs[0].current.focus()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const pin = digits.join('')
    if (pin.length < 4) {
      setError('Nhập đủ 4 chữ số.')
      return
    }

    setLoading(true)
    setError('')
    const user = await loginWithPin(pin)
    setLoading(false)

    if (!user) {
      setError('PIN không đúng. Thử lại.')
      setDigits(['', '', '', ''])
      inputRefs[0].current.focus()
      return
    }

    login(user)
    navigate('/home')
  }

  const pinComplete = digits.every((d) => d !== '')

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Title */}
        <div className="text-center mb-8">
          <Building2 size={36} className="text-blue-600 mx-auto mb-3" />
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">VTPT Meter</h1>
          <p className="mt-2 text-gray-500 text-sm">Nhập mã PIN 4 chữ số của bạn</p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* PIN inputs */}
          <div className="flex justify-center gap-3 mb-2">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={inputRefs[i]}
                type="tel"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                autoFocus={i === 0}
                className="w-14 h-14 text-center text-2xl font-bold border-2 rounded-xl bg-white
                           border-gray-300 focus:border-gray-900 focus:outline-none
                           transition-colors"
              />
            ))}
          </div>

          {/* Paste tip */}
          <p className="text-center text-xs text-gray-400 mb-4">
            Bạn có thể dán cả 4 chữ số cùng lúc
          </p>

          {/* Error message */}
          {error && (
            <p className="text-center text-sm text-red-500 mb-4">{error}</p>
          )}

          {/* Unlock button */}
          <button
            type="submit"
            disabled={!pinComplete || loading}
            className="w-full py-4 rounded-xl text-white font-semibold text-base
                       bg-gray-900 hover:bg-gray-800 active:bg-gray-950
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? 'Đang kiểm tra...' : 'Mở khoá'}
          </button>

          {/* Clear button */}
          <button
            type="button"
            onClick={handleClear}
            className="w-full mt-3 py-3 rounded-xl text-gray-500 font-medium text-sm
                       bg-transparent hover:bg-gray-200 active:bg-gray-300
                       transition-colors"
          >
            Xoá
          </button>
        </form>

        {/* Session note */}
        <p className="text-center text-xs text-gray-400 mt-6">
          Phiên đăng nhập sẽ kết thúc khi đóng tab
        </p>
      </div>
    </div>
  )
}
