import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import {
  getEngagement,
  generateBrief,
  approveDocument,
  reclassifyDocument,
  sendDocumentFollowUp,
  getEmailPreview,
  getFriendlyIssues,
  processEngagement,
  DOCUMENT_TYPES,
  type Engagement,
  type ChecklistItem,
  type Document,
  type Reconciliation,
  type FriendlyIssue
} from '../api/client'
import { hasErrors, hasWarnings } from '../utils/issues'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const [engagement, setEngagement] = useState<Engagement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatingBrief, setGeneratingBrief] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [checkingForDocs, setCheckingForDocs] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const selectedDocId = searchParams.get('doc')

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

  function selectDocument(docId: string | null) {
    if (docId) {
      setSearchParams({ doc: docId })
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
  const documents = showArchived ? allDocuments : allDocuments.filter(doc => !doc.archived)
  const archivedCount = allDocuments.filter(doc => doc.archived).length
  const reconciliation = engagement.reconciliation as Reconciliation | null

  function isDocProcessing(doc: Document): boolean {
    return ['downloading', 'extracting', 'classifying'].includes(doc.processingStatus || '') ||
      (doc.documentType === 'PENDING' && doc.processingStatus !== 'classified')
  }
  
  function getProcessingStage(doc: Document): string {
    if (!doc.processingStatus) return 'pending'
    if (doc.processingStatus === 'error') return 'error'
    if (doc.processingStatus === 'classified') return 'completed'
    return doc.processingStatus
  }
  
  function getProcessingProgress(doc: Document): number {
    const stage = doc.processingStatus || 'pending'
    const stageProgress = {
      'pending': 0,
      'downloading': 25,
      'extracting': 50,
      'classifying': 75,
      'classified': 100,
      'error': 0
    }
    return stageProgress[stage] || 0
  }

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
          </div>
        </div>

        {/* Document Review Split View */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Document List */}
          <div className="bg-white rounded-lg border">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold">Documents ({documents.length})</h2>
                {['INTAKE_DONE', 'COLLECTING'].includes(engagement.status) && (
                  <button
                    onClick={handleCheckForDocs}
                    disabled={checkingForDocs}
                    className="text-sm px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checkingForDocs ? 'Checking...' : 'Check for Documents'}
                  </button>
                )}
              </div>
              {archivedCount > 0 && (
                <div className="flex items-center gap-2">
                  <label className="flex items-center text-sm text-gray-600">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                      className="mr-2"
                    />
                    Show archived documents ({archivedCount})
                  </label>
                </div>
              )}
            </div>
            {documents.some(d => isDocProcessing(d)) && (
              <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-2 text-sm text-blue-800">
                <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                Processing documents...
              </div>
            )}
            <div className="divide-y max-h-[600px] overflow-y-auto">
              {documents.map(doc => {
                const processing = isDocProcessing(doc)
                const processingStage = getProcessingStage(doc)
                const processingProgress = getProcessingProgress(doc)
                const docHasErrors = hasErrors(doc.issues)
                const docHasWarnings = hasWarnings(doc.issues)
                const isResolved = doc.issues.length === 0 || doc.approved === true
                const isSelected = doc.id === selectedDocId
                const hasError = processingStage === 'error'

                const bgColor = isSelected
                  ? 'bg-blue-50 border-l-4 border-l-blue-500'
                  : hasError
                  ? 'bg-red-50 border-l-4 border-l-red-500'
                  : processing
                  ? 'bg-gray-50'
                  : docHasErrors && !isResolved
                  ? 'bg-red-50 border-l-4 border-l-red-500'
                  : docHasWarnings && !isResolved
                  ? 'bg-yellow-50 border-l-4 border-l-yellow-500'
                  : 'hover:bg-gray-50'

                return (
                  <button
                    key={doc.id}
                    onClick={() => selectDocument(doc.id)}
                    className={`block w-full text-left p-4 transition-colors ${bgColor}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {hasError ? (
                            <span className="text-red-600">⚠</span>
                          ) : processing ? (
                            <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                          ) : isResolved ? (
                            <span className="text-green-600">✓</span>
                          ) : docHasErrors ? (
                            <span className="text-red-600">✗</span>
                          ) : docHasWarnings ? (
                            <span className="text-yellow-600">⚠</span>
                          ) : null}
                          {doc.fileName}
                        </div>
                        <div className="text-sm text-gray-600">
                          {hasError ? (
                            <span className="text-red-600">Processing Error</span>
                          ) : processing ? (
                            <span className="capitalize">{processingStage}...</span>
                          ) : (
                            doc.documentType
                          )}
                          {!processing && !hasError && doc.taxYear && ` · ${doc.taxYear}`}
                          {doc.override && (
                            <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-1 rounded">
                              overridden
                            </span>
                          )}
                        </div>
                        {processing && (
                          <div className="mt-2">
                            <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-600 transition-all duration-300" 
                                style={{ width: `${processingProgress}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{processingProgress}%</div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {hasError && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCheckForDocs() // Retry processing
                            }}
                            className="text-xs px-2 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200"
                          >
                            Retry
                          </button>
                        )}
                        {doc.issues.length > 0 && !isResolved && !processing && !hasError && (
                          <div className="flex items-center gap-1">
                            {docHasErrors ? (
                              <span className="text-red-600">⚠</span>
                            ) : (
                              <span className="text-yellow-600">⚠</span>
                            )}
                            <span className="text-xs text-gray-600">
                              {doc.issues.length}
                            </span>
                          </div>
                        )}
                        {doc.archived && (
                          <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">
                            Archived
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
              {documents.length === 0 && (
                <div className="p-4 text-gray-500 text-center">
                  No documents uploaded yet
                </div>
              )}
            </div>
          </div>

          {/* Detail Pane */}
          <div className="bg-white rounded-lg border">
            {selectedDocId && documents.find(d => d.id === selectedDocId) ? (
              <DocumentDetail
                doc={documents.find(d => d.id === selectedDocId)!}
                engagementId={id!}
                clientEmail={engagement.clientEmail}
                onApprove={handleApproveDocument}
                onReclassify={handleReclassifyDocument}
                onSendEmail={handleSendFollowUp}
                actionInProgress={actionInProgress}
              />
            ) : (
              <div className="p-6 text-center text-gray-500">
                <div className="text-4xl mb-2">📄</div>
                <p>Select a document from the list to view details</p>
              </div>
            )}
          </div>
        </div>

        {/* Checklist */}
        <div className="bg-white p-6 rounded-lg border mb-6">
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

// Document Detail Component
interface DocumentDetailProps {
  doc: Document
  engagementId: string
  clientEmail: string
  onApprove: (docId: string) => Promise<void>
  onReclassify: (docId: string, newType: string) => Promise<void>
  onSendEmail: (docId: string, options: { email: string; subject: string; body: string }) => Promise<void>
  actionInProgress: string | null
}

function DocumentDetail({
  doc,
  engagementId,
  clientEmail,
  onApprove,
  onReclassify,
  onSendEmail,
  actionInProgress
}: DocumentDetailProps) {
  const [selectedType, setSelectedType] = useState('')
  const [friendlyIssues, setFriendlyIssues] = useState<FriendlyIssue[]>([])
  const [loadingIssues, setLoadingIssues] = useState(false)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [emailInput, setEmailInput] = useState(clientEmail)
  const [subjectInput, setSubjectInput] = useState('')
  const [bodyInput, setBodyInput] = useState('')
  const hasUnresolvedIssues = doc.issues.length > 0 && doc.approved !== true

  // Use cached issue details or fetch them for legacy documents
  useEffect(() => {
    if (doc.issues.length === 0) {
      setFriendlyIssues([])
      return
    }

    // If cached issue details are available, use them immediately
    if (doc.issueDetails && doc.issueDetails.length > 0) {
      setFriendlyIssues(doc.issueDetails)
      setLoadingIssues(false)
      return
    }

    // Fallback: Fetch from API for legacy documents without cached data
    setLoadingIssues(true)
    getFriendlyIssues(engagementId, doc.id)
      .then(result => setFriendlyIssues(result.issues))
      .catch(err => {
        console.error('Failed to load friendly issues:', err)
        // Fallback to basic display
        setFriendlyIssues(doc.issues.map(issue => ({
          original: issue,
          friendlyMessage: issue,
          suggestedAction: 'Review and take appropriate action',
          severity: 'warning' as const
        })))
      })
      .finally(() => setLoadingIssues(false))
  }, [engagementId, doc.id, doc.issues.length, doc.issueDetails])

  return (
    <>
      <div className="p-4 border-b">
        <h2 className="font-semibold">Document Detail</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* File Info */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase">Uploaded File</h3>
          <p className="mt-1 font-medium">{doc.fileName}</p>
          {doc.classifiedAt && (
            <p className="text-sm text-gray-500">
              Classified {new Date(doc.classifiedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Detected Info */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase">System Detected</h3>
          <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-500">Type:</span>{' '}
              <span className="font-medium">{doc.documentType}</span>
              {doc.override && (
                <span className="text-gray-400 line-through ml-2">
                  {doc.override.originalType}
                </span>
              )}
            </div>
            <div>
              <span className="text-gray-500">Tax Year:</span>{' '}
              <span className="font-medium">{doc.taxYear || 'Unknown'}</span>
            </div>
            <div>
              <span className="text-gray-500">Confidence:</span>{' '}
              <span className="font-medium">{Math.round(doc.confidence * 100)}%</span>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>{' '}
              <span className={`font-medium ${
                doc.approved ? 'text-green-600' : 'text-gray-600'
              }`}>
                {doc.approved ? 'Approved' : 'Pending Review'}
              </span>
            </div>
          </div>
        </div>

        {/* Issues */}
        {doc.issues.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase">
              Issues {!hasUnresolvedIssues && <span className="text-green-600">(Resolved)</span>}
            </h3>
            <div className="mt-2 space-y-2">
              {loadingIssues ? (
                <div className="text-sm text-gray-500 italic">Analyzing issues...</div>
              ) : (
                friendlyIssues.map((issue, idx) => (
                  <IssueCard key={idx} issue={issue} resolved={!hasUnresolvedIssues} />
                ))
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        {hasUnresolvedIssues && (
          <div className="pt-4 border-t space-y-2">
            <button
              onClick={async () => {
                setLoadingEmail(true)
                setShowEmailModal(true)
                try {
                  const preview = await getEmailPreview(engagementId, doc.id)
                  setEmailInput(preview.recipientEmail)
                  setSubjectInput(preview.subject)
                  setBodyInput(preview.body)
                } catch (err) {
                  console.error('Failed to load email preview:', err)
                  setEmailInput(clientEmail)
                  setSubjectInput(`Action Needed: Document Issue - ${doc.fileName}`)
                  setBodyInput(`Hi,\n\nWe found some issues with ${doc.fileName} that need your attention.\n\nPlease upload a corrected version.\n\nThank you.`)
                } finally {
                  setLoadingEmail(false)
                }
              }}
              disabled={actionInProgress !== null}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              📧 Send Follow-up Email
            </button>

            <button
              onClick={() => onApprove(doc.id)}
              disabled={actionInProgress !== null}
              className="w-full py-2 px-4 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionInProgress === 'approve' ? 'Approving...' : '✓ Approve Anyway'}
            </button>

            <div className="flex gap-2">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="flex-1 py-2 px-4 border rounded"
              >
                <option value="">Change type to...</option>
                {DOCUMENT_TYPES.filter(t => t !== doc.documentType && t !== 'PENDING').map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <button
                onClick={() => {
                  if (selectedType) {
                    onReclassify(doc.id, selectedType)
                    setSelectedType('')
                  }
                }}
                disabled={!selectedType || actionInProgress !== null}
                className="py-2 px-4 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionInProgress === 'reclassify' ? '...' : '✎ Reclassify'}
              </button>
            </div>
          </div>
        )}

        {/* Override info */}
        {doc.override && (
          <div className="pt-4 border-t">
            <h3 className="text-sm font-medium text-gray-500 uppercase">Override Note</h3>
            <p className="mt-1 text-sm">{doc.override.reason}</p>
          </div>
        )}
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Send Follow-up Email</h3>

            {loadingEmail ? (
              <div className="py-8 text-center text-gray-500">
                <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full mb-2"></div>
                <p>Generating email...</p>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    To
                  </label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="client@example.com"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={subjectInput}
                    onChange={(e) => setSubjectInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Email subject"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Message
                  </label>
                  <textarea
                    value={bodyInput}
                    onChange={(e) => setBodyInput(e.target.value)}
                    rows={8}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                    placeholder="Email body"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    An "Upload Document" button will be added automatically.
                  </p>
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowEmailModal(false)}
                    className="px-4 py-2 text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onSendEmail(doc.id, {
                        email: emailInput,
                        subject: subjectInput,
                        body: bodyInput
                      })
                      setShowEmailModal(false)
                    }}
                    disabled={!emailInput || !subjectInput || !bodyInput || actionInProgress === 'email'}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionInProgress === 'email' ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// Issue Card Component
interface IssueCardProps {
  issue: FriendlyIssue
  resolved: boolean
}

function IssueCard({ issue, resolved }: IssueCardProps) {
  const bgColor = resolved
    ? 'bg-gray-50 border-gray-200'
    : issue.severity === 'error'
    ? 'bg-red-50 border-red-200'
    : 'bg-yellow-50 border-yellow-200'

  return (
    <div className={`p-3 rounded border ${bgColor}`}>
      <div className="font-medium text-sm">
        {resolved && <span className="text-green-600 mr-1">✓</span>}
        {issue.friendlyMessage}
      </div>
      <div className="mt-2 text-xs text-blue-600 font-medium">
        → {issue.suggestedAction}
      </div>
    </div>
  )
}
