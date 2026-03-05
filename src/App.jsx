import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import RoomListPage from './pages/RoomListPage'
import RoomDetailPage from './pages/RoomDetailPage'
import SettingsPage from './pages/SettingsPage'

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/" replace />
}

function AppRoutes() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/home" replace /> : <LoginPage />} />
      <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
      <Route path="/house/:houseId" element={<ProtectedRoute><RoomListPage /></ProtectedRoute>} />
      <Route path="/house/:houseId/room/:roomId" element={<ProtectedRoute><RoomDetailPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
