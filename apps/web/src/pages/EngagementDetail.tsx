import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import {
  getEngagement,
  generateBrief,
  approveDocument,
  reclassifyDocument,
  sendDocumentFollowUp,
  processEngagement,
  retryDocument,
  archiveDocument,
  unarchiveDocument,
  type Engagement,
  type ChecklistItem,
  type Document,
  type Reconciliation,
} from '../api/client'
import UnifiedItemsList from '../components/UnifiedItemsList'

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-800',
  INTAKE_DONE: 'bg-blue-100 text-blue-800',
  COLLECTING: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-green-100 text-green-800',
}

export default function EngagementDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [checkingForDocs, setCheckingForDocs] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const selectedItemId = searchParams.get('item')

  useEffect(() => {
    if (!id) return

    getEngagement(id)
      .then(setEngagement)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  // Auto-poll while engagement is actively processing
  useEffect(() => {
    if (!id || !engagement) return
    if (!['INTAKE_DONE', 'COLLECTING'].includes(engagement.status)) return

    const interval = setInterval(() => {
      getEngagement(id).then(setEngagement).catch(() => {})
    }, 3000)

    return () => clearInterval(interval)
  }, [id, engagement?.status])

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

  async function handleApproveDocument(docId: string) {
    if (!id || !engagement) return

    setActionInProgress('approve')
    try {
      const result = await approveDocument(id, docId)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleReclassifyDocument(docId: string, newType: string) {
    if (!id || !engagement || !newType) return

    setActionInProgress('reclassify')
    try {
      const result = await reclassifyDocument(id, docId, newType)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reclassify document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleSendFollowUp(docId: string, options: { email: string; subject: string; body: string }) {
    if (!id || !engagement) return

    setActionInProgress('email')
    try {
      const result = await sendDocumentFollowUp(id, docId, options)
      setError(null) // Clear any previous errors
      alert(result.message || 'Follow-up email sent successfully')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleCheckForDocs() {
    if (!id || !engagement) return

    setCheckingForDocs(true)
    try {
      await processEngagement(id)
      const updated = await getEngagement(id)
      setEngagement(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for documents')
    } finally {
      setCheckingForDocs(false)
    }
  }

  async function handleRetryDocument(docId: string) {
    if (!id || !engagement) return

    setActionInProgress('retry')
    try {
      const result = await retryDocument(id, docId)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleArchiveDocument(docId: string, reason?: string) {
    if (!id || !engagement) return

    setActionInProgress('archive')
    try {
      const result = await archiveDocument(id, docId, reason)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive document')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleUnarchiveDocument(docId: string) {
    if (!id || !engagement) return

    setActionInProgress('unarchive')
    try {
      const result = await unarchiveDocument(id, docId)
      const documents = (engagement.documents || []).map(d =>
        d.id === docId ? result.document : d
      )
      setEngagement({ ...engagement, documents })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore document')
    } finally {
      setActionInProgress(null)
    }
  }

  function selectItem(itemId: string | null) {
    if (itemId) {
      setSearchParams({ item: itemId })
    } else {
      setSearchParams({})
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
  const allDocuments = (engagement.documents as Document[]) || []
  const reconciliation = engagement.reconciliation as Reconciliation | null

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
          </div>
        </div>

        {/* Unified Items View */}
        <div className="mb-6">
          <UnifiedItemsList
            documents={allDocuments}
            checklist={checklist}
            reconciliation={reconciliation}
            selectedItemId={selectedItemId}
            onSelectItem={selectItem}
            onCheckForDocs={handleCheckForDocs}
            checkingForDocs={checkingForDocs}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            onApprove={handleApproveDocument}
            onReclassify={handleReclassifyDocument}
            onSendEmail={handleSendFollowUp}
            onRetry={handleRetryDocument}
            onArchive={handleArchiveDocument}
            onUnarchive={handleUnarchiveDocument}
            actionInProgress={actionInProgress}
            engagementId={id!}
            clientEmail={engagement.clientEmail}
          />
        </div>

        {/* Prep Brief */}
        <div className="bg-white p-6 rounded-lg border">
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
            <div className="prep-brief p-4 bg-gray-50 rounded-lg">
              <Markdown>{engagement.prepBrief}</Markdown>
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
