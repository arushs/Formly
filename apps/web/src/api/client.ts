const API_URL = import.meta.env.VITE_API_URL || ''

interface Engagement {
  id: string
  clientName: string
  clientEmail: string
  taxYear: number
  status: string
  storageProvider: string
  storageFolderUrl: string
  typeformFormId: string
  checklist: ChecklistItem[] | null
  documents: Document[] | null
  reconciliation: Reconciliation | null
  prepBrief: string | null
  createdAt: string
  updatedAt: string
}

interface ChecklistItem {
  id: string
  title: string
  why: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'received' | 'complete'
  documentIds: string[]
}

interface Document {
  id: string
  fileName: string
  storageItemId: string
  sharepointItemId?: string
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
  classifiedAt: string | null
}

interface Reconciliation {
  completionPercentage: number
  itemStatuses: Array<{
    itemId: string
    status: 'pending' | 'received' | 'complete'
    documentIds: string[]
  }>
  issues: string[]
  ranAt: string
}

interface CreateEngagementData {
  clientName: string
  clientEmail: string
  taxYear: number
  storageFolderUrl: string
  typeformFormId: string
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

export async function getEngagements(): Promise<Engagement[]> {
  return fetchApi('/api/engagements')
}

export async function getEngagement(id: string): Promise<Engagement> {
  return fetchApi(`/api/engagements/${id}`)
}

export async function createEngagement(data: CreateEngagementData): Promise<Engagement> {
  return fetchApi('/api/engagements', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function generateBrief(id: string): Promise<{ success: boolean; brief: string }> {
  return fetchApi(`/api/engagements/${id}/brief`, {
    method: 'POST',
  })
}

export type { Engagement, ChecklistItem, Document, Reconciliation, CreateEngagementData }
