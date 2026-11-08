import { Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.tsx'
import RequireRole from './auth/RequireRole.tsx'
import AppLayout from './components/AppLayout.tsx'
import CasePage from './pages/CasePage.tsx'
import CasesPage from './pages/CasesPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import FirmProfilePage from './pages/FirmProfilePage.tsx'
import LawyerDetailPage from './pages/LawyerDetailPage.tsx'
import LawyersPage from './pages/LawyersPage.tsx'
import PartnerHomePage from './pages/PartnerHomePage.tsx'
import PartnerLoginPage from './pages/PartnerLoginPage.tsx'
import SignupPage from './pages/SignupPage.tsx'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="partners/login" element={<PartnerLoginPage />} />
        <Route path="partners/signup" element={<SignupPage audience="partner" />} />
        <Route element={<RequireAuth />}>
          {/* Shared cases open here for every role; the API decides who can see each case. */}
          <Route path="cases/:caseId" element={<CasePage />} />
          <Route element={<RequireRole roles={['victim']} />}>
            <Route index element={<CasesPage />} />
            <Route path="lawyers" element={<LawyersPage />} />
            <Route path="lawyers/:firmId" element={<LawyerDetailPage />} />
          </Route>
          <Route element={<RequireRole roles={['hr']} />}>
            <Route path="hr" element={<PartnerHomePage kind="hr" />} />
          </Route>
          <Route element={<RequireRole roles={['law_firm']} />}>
            <Route path="firm" element={<PartnerHomePage kind="firm" />} />
            <Route path="firm/profile" element={<FirmProfilePage />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
