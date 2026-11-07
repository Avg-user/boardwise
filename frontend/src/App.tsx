import { Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.tsx'
import AppLayout from './components/AppLayout.tsx'
import CasePage from './pages/CasePage.tsx'
import CasesPage from './pages/CasesPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import PlaceholderPage from './pages/PlaceholderPage.tsx'
import SignupPage from './pages/SignupPage.tsx'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route element={<RequireAuth />}>
          <Route index element={<CasesPage />} />
          <Route path="cases/:caseId" element={<CasePage />} />
          <Route path="lawyers" element={<PlaceholderPage name="lawyers" />} />
          <Route path="hr" element={<PlaceholderPage name="hr" />} />
          <Route path="firm" element={<PlaceholderPage name="firm" />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
