import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getEngagements, deleteEngagement, type Engagement } from '../api/client'

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  INTAKE_DONE: 'bg-blue-100 text-blue-800',
  COLLECTING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-green-100 text-green-800',
}

export default function Dashboard() {
  const [engagements, setEngagements] = useState<Engagement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async (e: React.MouseEvent, id: string, clientName: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete engagement for ${clientName}? This cannot be undone.`)) {
      return
    }
    try {
      await deleteEngagement(id)
      setEngagements(engagements.filter(eng => eng.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  useEffect(() => {
    getEngagements()
      .then(setEngagements)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">Error: {error}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tax Intake Agent</h1>
            <p className="text-gray-600 mt-1">Demo MVP - Document Collection Dashboard</p>
          </div>
          <Link
            to="/engagements/new"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            New Engagement
          </Link>
        </div>

        {engagements.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border">
            <p className="text-gray-500 mb-4">No engagements yet</p>
            <Link
              to="/engagements/new"
              className="text-blue-600 hover:underline"
            >
              Create your first engagement
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {engagements.map((engagement) => {
              const completion = engagement.reconciliation?.completionPercentage ?? 0

              return (
                <Link
                  key={engagement.id}
                  to={`/engagements/${engagement.id}`}
                  className="block bg-white p-6 rounded-lg border hover:shadow-md transition-shadow"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {engagement.clientName}
                      </h2>
                      <p className="text-gray-600">{engagement.clientEmail}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        Tax Year: {engagement.taxYear}
                      </p>
                    </div>
                    <div className="text-right flex items-start gap-2">
                      <div>
                        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusColors[engagement.status] || statusColors.PENDING}`}>
                          {engagement.status.replace('_', ' ')}
                        </span>
                        {completion > 0 && (
                          <p className="text-sm text-gray-500 mt-2">
                            {completion}% complete
                          </p>
                        )}
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, engagement.id, engagement.clientName)}
                        className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Delete engagement"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
