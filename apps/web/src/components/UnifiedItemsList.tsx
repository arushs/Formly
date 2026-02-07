import { useMemo, useState } from 'react'
import type { Document, ChecklistItem, Reconciliation, FriendlyIssue } from '../api/client'
import { hasErrors, hasWarnings } from '../utils/issues'

// Unified item types
type ItemType = 'document' | 'checklist'

type ItemStatus = 
  | 'processing'  // Blue - actively being worked on
  | 'missing'     // Red - needs attention
  | 'warning'     // Yellow - review needed
  | 'pending'     // Gray - waiting
  | 'complete'    // Green - done

interface UnifiedItem {
  id: string
  type: ItemType
  title: string
  subtitle: string
  status: ItemStatus
  statusLabel: string
  // Original data for detail view
  document?: Document
  checklistItem?: ChecklistItem
}

interface UnifiedItemsListProps {
  documents: Document[]
  checklist: ChecklistItem[]
  reconciliation: Reconciliation | null
  selectedItemId: string | null
  onSelectItem: (id: string | null) => void
  onCheckForDocs: () => Promise<void>
  checkingForDocs: boolean
  showArchived: boolean
  onShowArchivedChange: (show: boolean) => void
  // Document actions
  onApprove: (docId: string) => Promise<void>
  onReclassify: (docId: string, newType: string) => Promise<void>
  onSendEmail: (docId: string, options: { email: string; subject: string; body: string }) => Promise<void>
  onRetry: (docId: string) => Promise<void>
  onArchive: (docId: string, reason?: string) => Promise<void>
  onUnarchive: (docId: string) => Promise<void>
  actionInProgress: string | null
  engagementId: string
  clientEmail: string
}

// Status pill styling
const statusPillStyles: Record<ItemStatus, string> = {
  processing: 'bg-blue-100 text-blue-800',
  missing: 'bg-red-100 text-red-800',
  warning: 'bg-yellow-100 text-yellow-800',
  pending: 'bg-gray-100 text-gray-800',
  complete: 'bg-green-100 text-green-800',
}

// Filter options
type FilterOption = 'all' | ItemStatus

const filterOptions: { value: FilterOption; label: string; emoji?: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing', emoji: '🔴' },
  { value: 'complete', label: 'Complete', emoji: '🟢' },
  { value: 'processing', label: 'Processing', emoji: '🔵' },
  { value: 'warning', label: 'Warning', emoji: '🟡' },
  { value: 'pending', label: 'Pending', emoji: '⚪' },
]

export default function UnifiedItemsList({
  documents,
  checklist,
  reconciliation,
  selectedItemId,
  onSelectItem,
  onCheckForDocs,
  checkingForDocs,
  showArchived,
  onShowArchivedChange,
  onApprove,
  onReclassify,
  onSendEmail,
  onRetry,
  onArchive,
  onUnarchive,
  actionInProgress,
  engagementId,
  clientEmail,
}: UnifiedItemsListProps) {
  const [activeFilter, setActiveFilter] = useState<FilterOption>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Build item status map from reconciliation
  const itemStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; documentIds: string[] }>()
    if (reconciliation?.itemStatuses) {
      for (const status of reconciliation.itemStatuses) {
        map.set(status.itemId, status)
      }
    }
    return map
  }, [reconciliation])

  // Transform documents and checklist into unified items
  const unifiedItems = useMemo(() => {
    const items: UnifiedItem[] = []

    // Filter documents based on archive state
    const filteredDocs = showArchived ? documents : documents.filter(d => !d.archived)

    // Add documents
    for (const doc of filteredDocs) {
      const status = getDocumentStatus(doc)
      items.push({
        id: `doc-${doc.id}`,
        type: 'document',
        title: doc.fileName,
        subtitle: doc.documentType,
        status,
        statusLabel: getDocumentStatusLabel(doc, status),
        document: doc,
      })
    }

    // Add checklist items
    for (const item of checklist) {
      const reconStatus = itemStatusMap.get(item.id)
      const status = getChecklistStatus(item, reconStatus?.status)
      items.push({
        id: `checklist-${item.id}`,
        type: 'checklist',
        title: item.title,
        subtitle: 'Checklist',
        status,
        statusLabel: getChecklistStatusLabel(status),
        checklistItem: item,
      })
    }

    return items
  }, [documents, checklist, itemStatusMap, showArchived])

  // Apply filters
  const filteredItems = useMemo(() => {
    return unifiedItems.filter(item => {
      // Status filter
      if (activeFilter !== 'all' && item.status !== activeFilter) {
        return false
      }
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        return (
          item.title.toLowerCase().includes(query) ||
          item.subtitle.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [unifiedItems, activeFilter, searchQuery])

  // Get counts for filter badges
  const filterCounts = useMemo(() => {
    const counts: Record<FilterOption, number> = {
      all: unifiedItems.length,
      processing: 0,
      missing: 0,
      warning: 0,
      pending: 0,
      complete: 0,
    }
    for (const item of unifiedItems) {
      counts[item.status]++
    }
    return counts
  }, [unifiedItems])

  // Find selected item
  const selectedItem = selectedItemId 
    ? unifiedItems.find(item => item.id === selectedItemId) 
    : null

  const archivedCount = documents.filter(d => d.archived).length

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left Panel - Items List */}
      <div className="bg-white rounded-lg border flex flex-col">
        {/* Filter Pills */}
        <div className="p-4 border-b">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {filterOptions.map(option => (
              <button
                key={option.value}
                onClick={() => setActiveFilter(option.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  activeFilter === option.value
                    ? option.value === 'all'
                      ? 'bg-gray-900 text-white'
                      : statusPillStyles[option.value as ItemStatus]
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {option.emoji && <span className="mr-1">{option.emoji}</span>}
                {option.label}
                {filterCounts[option.value] > 0 && (
                  <span className="ml-1.5 opacity-75">({filterCounts[option.value]})</span>
                )}
              </button>
            ))}
          </div>
          
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items..."
              className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          </div>
        </div>

        {/* Header */}
        <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">Items ({filteredItems.length})</h2>
            {archivedCount > 0 && (
              <label className="flex items-center gap-1 text-sm text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => onShowArchivedChange(e.target.checked)}
                  className="rounded"
                />
                Archived ({archivedCount})
              </label>
            )}
          </div>
          <button
            onClick={onCheckForDocs}
            disabled={checkingForDocs}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {checkingForDocs ? 'Checking...' : 'Check for Docs'}
          </button>
        </div>

        {/* Processing banner */}
        {documents.some(d => isDocProcessing(d)) && (
          <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-2 text-sm text-blue-800">
            <div className="animate-spin w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
            Processing documents...
          </div>
        )}

        {/* Items List */}
        <div className="divide-y overflow-y-auto flex-1 max-h-[550px]">
          {filteredItems.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              isSelected={item.id === selectedItemId}
              onSelect={() => onSelectItem(item.id)}
            />
          ))}
          {filteredItems.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              {searchQuery || activeFilter !== 'all' ? (
                <>
                  <div className="text-3xl mb-2">🔍</div>
                  <p>No items match your filters</p>
                </>
              ) : (
                <>
                  <div className="text-3xl mb-2">📄</div>
                  <p>No items yet</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Detail View */}
      <div className="bg-white rounded-lg border">
        {selectedItem ? (
          selectedItem.type === 'document' && selectedItem.document ? (
            <DocumentDetail
              doc={selectedItem.document}
              engagementId={engagementId}
              clientEmail={clientEmail}
              onApprove={onApprove}
              onReclassify={onReclassify}
              onSendEmail={onSendEmail}
              onRetry={onRetry}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              actionInProgress={actionInProgress}
            />
          ) : selectedItem.type === 'checklist' && selectedItem.checklistItem ? (
            <ChecklistDetail
              item={selectedItem.checklistItem}
              status={selectedItem.status}
              statusLabel={selectedItem.statusLabel}
            />
          ) : null
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-gray-500">
            <div className="text-5xl mb-3">📋</div>
            <p className="text-lg font-medium">Select an item</p>
            <p className="text-sm">Click on an item from the list to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper functions
function isDocProcessing(doc: Document): boolean {
  if (doc.processingStatus === 'error') return false
  const processingStates = ['pending', 'downloading', 'extracting', 'classifying']
  return processingStates.includes(doc.processingStatus || '') ||
    (doc.documentType === 'PENDING' && doc.processingStatus !== 'classified')
}

function getDocumentStatus(doc: Document): ItemStatus {
  if (doc.archived) return 'pending'
  if (isDocProcessing(doc)) return 'processing'
  if (doc.processingStatus === 'error') return 'missing'
  if (doc.approved) return 'complete'
  if (hasErrors(doc.issues)) return 'missing'
  if (hasWarnings(doc.issues)) return 'warning'
  if (doc.issues.length === 0 && doc.documentType !== 'PENDING') return 'complete'
  return 'pending'
}

function getDocumentStatusLabel(doc: Document, status: ItemStatus): string {
  if (doc.archived) return 'Archived'
  switch (status) {
    case 'processing': return 'Processing'
    case 'missing': return doc.processingStatus === 'error' ? 'Error' : 'Issues'
    case 'warning': return 'Review'
    case 'complete': return 'Complete'
    default: return 'Pending'
  }
}

function getChecklistStatus(item: ChecklistItem, reconStatus?: string): ItemStatus {
  const status = reconStatus || item.status
  switch (status) {
    case 'complete': return 'complete'
    case 'received': return 'warning'
    case 'pending': return 'missing'
    default: return 'pending'
  }
}

function getChecklistStatusLabel(status: ItemStatus): string {
  switch (status) {
    case 'complete': return 'Received'
    case 'warning': return 'Partial'
    case 'missing': return 'Missing'
    default: return 'Pending'
  }
}

// Item Row Component
interface ItemRowProps {
  item: UnifiedItem
  isSelected: boolean
  onSelect: () => void
}

function ItemRow({ item, isSelected, onSelect }: ItemRowProps) {
  const isArchived = item.document?.archived
  
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 transition-all ${
        isArchived ? 'bg-gray-50 opacity-60' :
        isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' :
        'hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Icon */}
          <span className="text-lg flex-shrink-0">
            {item.type === 'document' ? '📄' : '✅'}
          </span>
          
          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className={`font-medium truncate ${isArchived ? 'line-through text-gray-400' : ''}`}>
              {item.title}
            </div>
            <div className="text-sm text-gray-500">{item.subtitle}</div>
          </div>
        </div>
        
        {/* Status Pill */}
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${statusPillStyles[item.status]}`}>
          {item.statusLabel}
        </span>
      </div>
    </button>
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
  onRetry: (docId: string) => Promise<void>
  onArchive: (docId: string, reason?: string) => Promise<void>
  onUnarchive: (docId: string) => Promise<void>
  actionInProgress: string | null
}

// Import API functions for email preview
import { getEmailPreview, DOCUMENT_TYPES } from '../api/client'

function DocumentDetail({
  doc,
  engagementId,
  clientEmail,
  onApprove,
  onReclassify,
  onSendEmail,
  onRetry,
  onArchive,
  onUnarchive,
  actionInProgress,
}: DocumentDetailProps) {
  const [selectedType, setSelectedType] = useState('')
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [loadingEmail, setLoadingEmail] = useState(false)
  const [emailInput, setEmailInput] = useState(clientEmail)
  const [subjectInput, setSubjectInput] = useState('')
  const [bodyInput, setBodyInput] = useState('')
  
  const hasUnresolvedIssues = doc.issues.length > 0 && doc.approved !== true
  const friendlyIssues: FriendlyIssue[] = doc.issueDetails || doc.issues.map(issue => ({
    original: issue,
    friendlyMessage: issue,
    suggestedAction: 'Review and take appropriate action',
    severity: 'warning' as const
  }))

  return (
    <>
      <div className="p-4 border-b bg-gray-50">
        <h2 className="font-semibold">Document Detail</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Archived State */}
        {doc.archived && (
          <div className="p-4 bg-gray-100 border border-gray-300 rounded-lg">
            <div className="flex items-center gap-2 text-gray-700 font-medium">
              <span>📦</span>
              Document Archived
            </div>
            {doc.archivedReason && (
              <p className="mt-1 text-sm text-gray-600">{doc.archivedReason}</p>
            )}
            <button
              onClick={() => onUnarchive(doc.id)}
              disabled={actionInProgress !== null}
              className="mt-3 w-full py-2 px-4 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
            >
              {actionInProgress === 'unarchive' ? 'Restoring...' : '↩️ Restore Document'}
            </button>
          </div>
        )}

        {/* Error State */}
        {!doc.archived && doc.processingStatus === 'error' && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-800 font-medium">
              <span>⚠️</span>
              Processing Failed
            </div>
            <button
              onClick={() => onRetry(doc.id)}
              disabled={actionInProgress !== null}
              className="mt-3 w-full py-2 px-4 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {actionInProgress === 'retry' ? 'Retrying...' : '🔄 Retry Processing'}
            </button>
          </div>
        )}

        {/* File Info */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Uploaded File</h3>
          <p className="mt-1 font-medium">{doc.fileName}</p>
          {doc.classifiedAt && (
            <p className="text-sm text-gray-500">
              Classified {new Date(doc.classifiedAt).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Detected Info */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">System Detected</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div className="p-2 bg-gray-50 rounded">
              <span className="text-gray-500">Type:</span>{' '}
              <span className="font-medium">{doc.documentType}</span>
            </div>
            <div className="p-2 bg-gray-50 rounded">
              <span className="text-gray-500">Year:</span>{' '}
              <span className="font-medium">{doc.taxYear || 'Unknown'}</span>
            </div>
            <div className="p-2 bg-gray-50 rounded">
              <span className="text-gray-500">Confidence:</span>{' '}
              <span className="font-medium">{Math.round(doc.confidence * 100)}%</span>
            </div>
            <div className="p-2 bg-gray-50 rounded">
              <span className="text-gray-500">Status:</span>{' '}
              <span className={`font-medium ${doc.approved ? 'text-green-600' : 'text-gray-600'}`}>
                {doc.approved ? 'Approved' : 'Pending'}
              </span>
            </div>
          </div>
        </div>

        {/* Issues */}
        {doc.issues.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
              Issues {!hasUnresolvedIssues && <span className="text-green-600">(Resolved)</span>}
            </h3>
            <div className="space-y-2">
              {friendlyIssues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-lg border ${
                    !hasUnresolvedIssues ? 'bg-gray-50 border-gray-200' :
                    issue.severity === 'error' ? 'bg-red-50 border-red-200' :
                    'bg-yellow-50 border-yellow-200'
                  }`}
                >
                  <div className="font-medium text-sm">
                    {!hasUnresolvedIssues && <span className="text-green-600 mr-1">✓</span>}
                    {issue.friendlyMessage}
                  </div>
                  <div className="mt-1 text-xs text-blue-600 font-medium">
                    → {issue.suggestedAction}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {hasUnresolvedIssues && !doc.archived && (
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
                } catch {
                  setEmailInput(clientEmail)
                  setSubjectInput(`Action Needed: ${doc.fileName}`)
                  setBodyInput(`Hi,\n\nPlease upload a corrected version of ${doc.fileName}.\n\nThank you.`)
                } finally {
                  setLoadingEmail(false)
                }
              }}
              disabled={actionInProgress !== null}
              className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              📧 Send Follow-up Email
            </button>

            <button
              onClick={() => onApprove(doc.id)}
              disabled={actionInProgress !== null}
              className="w-full py-2 px-4 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {actionInProgress === 'approve' ? 'Approving...' : '✓ Approve Anyway'}
            </button>

            <div className="flex gap-2">
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="flex-1 py-2 px-4 border rounded-lg"
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
                className="py-2 px-4 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                ✎
              </button>
            </div>
          </div>
        )}

        {/* Archive button */}
        {!doc.archived && (
          <div className="pt-4 border-t">
            <button
              onClick={() => onArchive(doc.id, 'Replaced by newer document')}
              disabled={actionInProgress !== null}
              className="w-full py-2 px-4 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              📦 Archive Document
            </button>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                  <input
                    type="text"
                    value={subjectInput}
                    onChange={(e) => setSubjectInput(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                  <textarea
                    value={bodyInput}
                    onChange={(e) => setBodyInput(e.target.value)}
                    rows={6}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
                  />
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
                      onSendEmail(doc.id, { email: emailInput, subject: subjectInput, body: bodyInput })
                      setShowEmailModal(false)
                    }}
                    disabled={!emailInput || !subjectInput || !bodyInput}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send Email
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

// Checklist Detail Component
interface ChecklistDetailProps {
  item: ChecklistItem
  status: ItemStatus
  statusLabel: string
}

function ChecklistDetail({ item, status, statusLabel }: ChecklistDetailProps) {
  return (
    <>
      <div className="p-4 border-b bg-gray-50">
        <h2 className="font-semibold">Checklist Item</h2>
      </div>

      <div className="p-4 space-y-4">
        {/* Title and Status */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-medium">{item.title}</h3>
            <span className={`inline-block mt-1 px-2.5 py-1 rounded-full text-xs font-medium ${statusPillStyles[status]}`}>
              {statusLabel}
            </span>
          </div>
          <span className="text-2xl">✅</span>
        </div>

        {/* Why needed */}
        <div>
          <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">Why It's Needed</h4>
          <p className="text-gray-700">{item.why}</p>
        </div>

        {/* Priority */}
        <div>
          <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">Priority</h4>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
            item.priority === 'high' ? 'bg-red-100 text-red-800' :
            item.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {item.priority.charAt(0).toUpperCase() + item.priority.slice(1)}
          </span>
        </div>

        {/* Linked Documents */}
        {item.documentIds.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
              Linked Documents ({item.documentIds.length})
            </h4>
            <div className="space-y-1">
              {item.documentIds.map(id => (
                <div key={id} className="text-sm text-gray-600 flex items-center gap-2">
                  <span>📄</span>
                  <span className="font-mono text-xs">{id}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
