import type { ChecklistItem, Document, Reconciliation } from '../types.js'

let idCounter = 0
function generateId(prefix: string): string {
  idCounter++
  return `${prefix}_${idCounter.toString().padStart(3, '0')}`
}

export function resetIdCounter(): void {
  idCounter = 0
}

export function createMockChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: generateId('item'),
    title: 'W-2 from Test Employer',
    why: 'Required for tax filing',
    priority: 'high',
    status: 'pending',
    documentIds: [],
    expectedDocumentType: 'W-2',
    ...overrides,
  }
}

export function createMockDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: generateId('doc'),
    fileName: 'test-document.pdf',
    storageItemId: generateId('storage'),
    documentType: 'W-2',
    confidence: 0.95,
    taxYear: 2025,
    issues: [],
    issueDetails: null,
    classifiedAt: new Date().toISOString(),
    processingStatus: 'classified',
    processingStartedAt: null,
    approved: null,
    approvedAt: null,
    override: null,
    ...overrides,
  }
}

export function createMockReconciliation(overrides: Partial<Reconciliation> = {}): Reconciliation {
  return {
    completionPercentage: 100,
    itemStatuses: [],
    issues: [],
    ranAt: new Date().toISOString(),
    ...overrides,
  }
}

export interface MockEngagement {
  id: string
  clientName: string
  clientEmail: string
  taxYear: number
  status: 'PENDING' | 'INTAKE_DONE' | 'COLLECTING' | 'READY'
  typeformFormId: string
  storageProvider: string
  storageFolderUrl: string
  storageFolderId: string | null
  storageDriveId: string | null
  storagePageToken: string | null
  intakeData: unknown
  checklist: ChecklistItem[] | null
  documents: Document[] | null
  reconciliation: Reconciliation | null
  prepBrief: string | null
  lastActivityAt: Date
  createdAt: Date
  updatedAt: Date
}

export function createMockEngagement(overrides: Partial<MockEngagement> = {}): MockEngagement {
  const now = new Date()
  return {
    id: generateId('eng'),
    clientName: 'Test Client',
    clientEmail: 'client@example.com',
    taxYear: 2025,
    status: 'PENDING',
    typeformFormId: 'test-form-id',
    storageProvider: 'dropbox',
    storageFolderUrl: 'https://www.dropbox.com/sh/test123/xyz',
    storageFolderId: '/test-folder',
    storageDriveId: null,
    storagePageToken: null,
    intakeData: null,
    checklist: null,
    documents: null,
    reconciliation: null,
    prepBrief: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createMockIntakeData(): Record<string, unknown> {
  return {
    name: 'Test Client',
    email: 'client@example.com',
    employment_type: 'W-2 Employee',
    has_investments: 'Yes',
    investment_types: ['Stocks', 'Bonds'],
    has_self_employment: 'No',
  }
}
