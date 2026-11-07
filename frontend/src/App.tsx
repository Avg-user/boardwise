import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import PlaceholderPage from './pages/PlaceholderPage.tsx'

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<PlaceholderPage name="issues" />} />
        <Route path="login" element={<PlaceholderPage name="login" />} />
        <Route path="cases/:caseId" element={<PlaceholderPage name="case" />} />
        <Route path="lawyers" element={<PlaceholderPage name="lawyers" />} />
        <Route path="hr" element={<PlaceholderPage name="hr" />} />
        <Route path="firm" element={<PlaceholderPage name="firm" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
