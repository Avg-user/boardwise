import { Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth.tsx'
import RequireRole, { RequireStaff } from './auth/RequireRole.tsx'
import AppLayout from './components/AppLayout.tsx'
import CasePage from './pages/CasePage.tsx'
import HomeRoute from './pages/HomeRoute.tsx'
import LoginPage from './pages/LoginPage.tsx'
import MessagesPage from './pages/MessagesPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import FirmProfilePage from './pages/FirmProfilePage.tsx'
import HrHomePage from './pages/HrHomePage.tsx'
import LawyerDetailPage from './pages/LawyerDetailPage.tsx'
import LawyersPage from './pages/LawyersPage.tsx'
import PartnerHomePage from './pages/PartnerHomePage.tsx'
import PartnerLoginPage from './pages/PartnerLoginPage.tsx'
import SignupPage from './pages/SignupPage.tsx'
import StaffPage from './pages/StaffPage.tsx'
import ThreadPage from './pages/ThreadPage.tsx'
import WorkplacePage from './pages/WorkplacePage.tsx'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="partners/login" element={<PartnerLoginPage />} />
        <Route path="partners/signup" element={<SignupPage audience="partner" />} />
        {/* The landing page for visitors; signed-in people get their own home. */}
        <Route index element={<HomeRoute />} />
        <Route element={<RequireAuth />}>
          {/* Shared cases open here for every role; the API decides who can see each case. */}
          <Route path="cases/:caseId" element={<CasePage />} />
          <Route element={<RequireRole roles={['victim']} />}>
            <Route path="lawyers" element={<LawyersPage />} />
            <Route path="lawyers/:firmId" element={<LawyerDetailPage />} />
            <Route path="workplace" element={<WorkplacePage />} />
          </Route>
          {/* Conversations between workers and law firms. */}
          <Route element={<RequireRole roles={['victim', 'law_firm']} />}>
            <Route path="messages" element={<MessagesPage />} />
            <Route path="messages/:threadId" element={<ThreadPage />} />
          </Route>
          <Route element={<RequireStaff />}>
            <Route path="staff" element={<StaffPage />} />
          </Route>
          <Route element={<RequireRole roles={['hr']} />}>
            <Route path="hr" element={<HrHomePage />} />
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
