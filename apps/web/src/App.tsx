import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import NewEngagement from './pages/NewEngagement'
import EngagementDetail from './pages/EngagementDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/engagements/new" element={<NewEngagement />} />
        <Route path="/engagements/:id" element={<EngagementDetail />} />
      </Routes>
    </BrowserRouter>
  )
}
