import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getEngagement, generateBrief, type Engagement, type ChecklistItem, type Document, type Reconciliation } from '../api/client'

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  INTAKE_DONE: 'bg-blue-100 text-blue-800',
  COLLECTING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-green-100 text-green-800',
}

const itemStatusColors: Record<string, string> = {
  pending: 'text-gray-500',
  received: 'text-yellow-600',
  complete: 'text-green-600',
}

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>()
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatingBrief, setGeneratingBrief] = useState(false)

  useEffect(() => {
    if (!id) return

    getEngagement(id)
      .then(setEngagement)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  async function handleGenerateBrief() {
    if (!id || !engagement) return

    setGeneratingBrief(true)
    try {
      const result = await generateBrief(id)
      setEngagement({ ...engagement, prepBrief: result.brief })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief')
    } finally {
      setGeneratingBrief(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (error || !engagement) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">Error: {error || 'Engagement not found'}</div>
      </div>
    )
  }

  const checklist = (engagement.checklist as ChecklistItem[]) || []
  const documents = (engagement.documents as Document[]) || []
  const reconciliation = engagement.reconciliation as Reconciliation | null

  // Build a map of checklist item statuses from reconciliation
  const itemStatusMap = new Map<string, { status: string; documentIds: string[] }>()
  if (reconciliation?.itemStatuses) {
    for (const status of reconciliation.itemStatuses) {
      itemStatusMap.set(status.itemId, status)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <Link to="/" className="text-blue-600 hover:underline">
            &larr; Back to Dashboard
          </Link>
        </div>

        <div className="bg-white p-6 rounded-lg border mb-6">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {engagement.clientName}
              </h1>
              <p className="text-gray-600">{engagement.clientEmail}</p>
              <p className="text-sm text-gray-500 mt-1">
                Tax Year: {engagement.taxYear}
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[engagement.status]}`}>
              {engagement.status.replace('_', ' ')}
            </span>
          </div>

          {reconciliation && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="h-3 bg-blue-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{ width: `${reconciliation.completionPercentage}%` }}
                    />
                  </div>
                </div>
                <span className="font-semibold text-blue-800">
                  {reconciliation.completionPercentage}% Complete
                </span>
              </div>
              {reconciliation.issues.length > 0 && (
                <div className="mt-3 text-sm text-red-600">
                  <strong>Issues:</strong> {reconciliation.issues.join(', ')}
                </div>
              )}
            </div>
          )}

          <div className="mt-4 pt-4 border-t text-sm text-gray-500">
            <p>
              Storage ({engagement.storageProvider}):{' '}
              <a href={engagement.storageFolderUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                {engagement.storageFolderUrl}
              </a>
            </p>
            <p>Typeform ID: {engagement.typeformFormId}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Checklist */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">
              Checklist ({checklist.length} items)
            </h2>
            {checklist.length === 0 ? (
              <p className="text-gray-500">
                {engagement.status === 'PENDING'
                  ? 'Waiting for client to complete intake form'
                  : 'No checklist generated yet'}
              </p>
            ) : (
              <ul className="space-y-3">
                {checklist.map(item => {
                  const itemStatus = itemStatusMap.get(item.id)
                  const status = itemStatus?.status || item.status

                  return (
                    <li key={item.id} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <span className={status === 'complete' ? 'line-through text-gray-400' : ''}>
                            {item.title}
                          </span>
                          <span className="ml-2 text-xs text-gray-400">({item.priority})</span>
                        </div>
                        <span className={`text-sm font-medium ${itemStatusColors[status]}`}>
                          {status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{item.why}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Documents */}
          <div className="bg-white p-6 rounded-lg border">
            <h2 className="text-xl font-semibold mb-4">
              Documents ({documents.length})
            </h2>
            {documents.length === 0 ? (
              <p className="text-gray-500">No documents uploaded yet</p>
            ) : (
              <ul className="space-y-3">
                {documents.map(doc => (
                  <li key={doc.id} className="p-3 border rounded-lg">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-medium">{doc.fileName}</p>
                        <p className="text-sm text-gray-600">
                          {doc.documentType} ({Math.round(doc.confidence * 100)}% confidence)
                        </p>
                        {doc.taxYear && (
                          <p className="text-xs text-gray-500">Tax Year: {doc.taxYear}</p>
                        )}
                      </div>
                    </div>
                    {doc.issues.length > 0 && (
                      <div className="mt-2 text-sm text-red-600">
                        {doc.issues.join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Prep Brief */}
        <div className="mt-6 bg-white p-6 rounded-lg border">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Prep Brief</h2>
            {engagement.status === 'READY' && !engagement.prepBrief && (
              <button
                onClick={handleGenerateBrief}
                disabled={generatingBrief}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {generatingBrief ? 'Generating...' : 'Generate Brief'}
              </button>
            )}
          </div>
          {engagement.prepBrief ? (
            <div className="prose prose-sm max-w-none">
              <div className="p-4 bg-gray-50 rounded-lg whitespace-pre-wrap font-mono text-sm">
                {engagement.prepBrief}
              </div>
            </div>
          ) : (
            <p className="text-gray-500">
              {engagement.status === 'READY'
                ? 'Click "Generate Brief" to create an accountant prep brief'
                : 'Brief will be available when all documents are collected'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
