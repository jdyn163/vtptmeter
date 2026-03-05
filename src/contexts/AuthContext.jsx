import { createContext, useContext, useState, useCallback } from 'react'

const SESSION_KEY = 'vtpt_user'

const AuthContext = createContext(null)

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readSession())

  const login = useCallback((userData) => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(userData))
    setUser(userData)
  }, [])

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
