import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import EngagementDetail from '../EngagementDetail'

// Mock the API client
vi.mock('../../api/client', () => ({
  getEngagement: vi.fn(),
  generateBrief: vi.fn(),
  approveDocument: vi.fn(),
  reclassifyDocument: vi.fn(),
  getEmailPreview: vi.fn(),
  sendDocumentFollowUp: vi.fn(),
  getFriendlyIssues: vi.fn(),
  DOCUMENT_TYPES: ['W-2', '1099-NEC', '1099-MISC', '1099-INT', 'K-1', 'RECEIPT', 'STATEMENT', 'OTHER', 'PENDING'],
}))

import {
  getEngagement,
  generateBrief,
  approveDocument,
  reclassifyDocument,
  getEmailPreview,
  getFriendlyIssues,
} from '../../api/client'

function renderWithRouter(engagementId: string, searchParams = '') {
  return render(
    <MemoryRouter initialEntries={[`/engagements/${engagementId}${searchParams}`]}>
      <Routes>
        <Route path="/engagements/:id" element={<EngagementDetail />} />
      </Routes>
    </MemoryRouter>
  )
}

const mockEngagement = {
  id: 'eng_001',
  clientName: 'Test Client',
  clientEmail: 'test@example.com',
  taxYear: 2025,
  status: 'COLLECTING',
  storageProvider: 'dropbox',
  storageFolderUrl: 'https://dropbox.com/sh/test',
  typeformFormId: 'form_123',
  checklist: [
    {
      id: 'item_001',
      title: 'W-2 from Employer',
      why: 'Required for tax filing',
      priority: 'high',
      status: 'pending',
      documentIds: [],
    },
  ],
  documents: [
    {
      id: 'doc_001',
      fileName: 'w2-2025.pdf',
      storageItemId: 'storage_001',
      documentType: 'W-2',
      confidence: 0.95,
      taxYear: 2025,
      issues: [],
      issueDetails: null,
      classifiedAt: '2025-01-15T00:00:00Z',
      approved: null,
      approvedAt: null,
      override: null,
    },
  ],
  reconciliation: {
    completionPercentage: 50,
    itemStatuses: [
      { itemId: 'item_001', status: 'received', documentIds: ['doc_001'] },
    ],
    issues: [],
    ranAt: '2025-01-15T00:00:00Z',
  },
  prepBrief: null,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-15T00:00:00Z',
}

describe('EngagementDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    vi.mocked(getEngagement).mockImplementation(() => new Promise(() => {}))

    renderWithRouter('eng_001')

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders engagement details after loading', async () => {
    vi.mocked(getEngagement).mockResolvedValueOnce(mockEngagement as any)

    renderWithRouter('eng_001')

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument()
    })

    expect(screen.getByText('test@example.com')).toBeInTheDocument()
    expect(screen.getByText('Tax Year: 2025')).toBeInTheDocument()
    expect(screen.getByText('COLLECTING')).toBeInTheDocument()
    expect(screen.getByText('50% Complete')).toBeInTheDocument()
  })

  it('renders checklist items', async () => {
    vi.mocked(getEngagement).mockResolvedValueOnce(mockEngagement as any)

    renderWithRouter('eng_001')

    await waitFor(() => {
      expect(screen.getByText('W-2 from Employer')).toBeInTheDocument()
    })

    expect(screen.getByText('Required for tax filing')).toBeInTheDocument()
  })

  it('renders document list', async () => {
    vi.mocked(getEngagement).mockResolvedValueOnce(mockEngagement as any)

    renderWithRouter('eng_001')

    await waitFor(() => {
      expect(screen.getByText('w2-2025.pdf')).toBeInTheDocument()
    })
  })

  it('renders error state on API failure', async () => {
    vi.mocked(getEngagement).mockRejectedValueOnce(new Error('Network error'))

    renderWithRouter('eng_001')

    await waitFor(() => {
      expect(screen.getByText('Error: Network error')).toBeInTheDocument()
    })
  })

  it('renders back link to dashboard', async () => {
    vi.mocked(getEngagement).mockResolvedValueOnce(mockEngagement as any)

    renderWithRouter('eng_001')

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument()
    })

    const backLink = screen.getByRole('link', { name: /Back to Dashboard/i })
    expect(backLink).toHaveAttribute('href', '/')
  })

  describe('Document selection', () => {
    it('shows detail pane when document is selected', async () => {
      const user = userEvent.setup()
      vi.mocked(getEngagement).mockResolvedValueOnce(mockEngagement as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('w2-2025.pdf')).toBeInTheDocument()
      })

      // Click on document to select it
      await user.click(screen.getByText('w2-2025.pdf'))

      await waitFor(() => {
        expect(screen.getByText('Document Detail')).toBeInTheDocument()
      })
    })

    it('shows placeholder when no document selected', async () => {
      vi.mocked(getEngagement).mockResolvedValueOnce(mockEngagement as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument()
      })

      expect(screen.getByText('Select a document from the list to view details')).toBeInTheDocument()
    })
  })

  describe('Document actions', () => {
    it('approves document when approve button clicked', async () => {
      const user = userEvent.setup()
      const engagementWithIssues = {
        ...mockEngagement,
        documents: [
          {
            ...mockEngagement.documents[0],
            issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
            issueDetails: [
              {
                original: 'Wrong year',
                friendlyMessage: 'Document is from 2024',
                suggestedAction: 'Request 2025 version',
                severity: 'error' as const,
              },
            ],
          },
        ],
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(engagementWithIssues as any)
      vi.mocked(approveDocument).mockResolvedValueOnce({
        success: true,
        document: { ...engagementWithIssues.documents[0], approved: true },
      } as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('w2-2025.pdf')).toBeInTheDocument()
      })

      // Select document
      await user.click(screen.getByText('w2-2025.pdf'))

      await waitFor(() => {
        expect(screen.getByText('Document Detail')).toBeInTheDocument()
      })

      // Click approve
      await user.click(screen.getByRole('button', { name: /Approve Anyway/i }))

      await waitFor(() => {
        expect(approveDocument).toHaveBeenCalledWith('eng_001', 'doc_001')
      })
    })

    it('reclassifies document when type changed', async () => {
      const user = userEvent.setup()
      const engagementWithIssues = {
        ...mockEngagement,
        documents: [
          {
            ...mockEngagement.documents[0],
            issues: ['[WARNING:low_confidence::] Low confidence'],
            issueDetails: [
              {
                original: 'Low confidence',
                friendlyMessage: 'Not sure about type',
                suggestedAction: 'Verify manually',
                severity: 'warning' as const,
              },
            ],
          },
        ],
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(engagementWithIssues as any)
      vi.mocked(reclassifyDocument).mockResolvedValueOnce({
        success: true,
        document: {
          ...engagementWithIssues.documents[0],
          documentType: '1099-NEC',
          override: { originalType: 'W-2', reason: 'Reclassified' },
        },
      } as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('w2-2025.pdf')).toBeInTheDocument()
      })

      // Select document
      await user.click(screen.getByText('w2-2025.pdf'))

      await waitFor(() => {
        expect(screen.getByRole('combobox')).toBeInTheDocument()
      })

      // Change type
      await user.selectOptions(screen.getByRole('combobox'), '1099-NEC')
      await user.click(screen.getByRole('button', { name: /Reclassify/i }))

      await waitFor(() => {
        expect(reclassifyDocument).toHaveBeenCalledWith('eng_001', 'doc_001', '1099-NEC')
      })
    })
  })

  describe('Generate Brief', () => {
    it('shows generate brief button for READY engagement', async () => {
      const readyEngagement = {
        ...mockEngagement,
        status: 'READY',
        reconciliation: { ...mockEngagement.reconciliation, completionPercentage: 100 },
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(readyEngagement as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('Test Client')).toBeInTheDocument()
      })

      expect(screen.getByRole('button', { name: /Generate Brief/i })).toBeInTheDocument()
    })

    it('generates brief when button clicked', async () => {
      const user = userEvent.setup()
      const readyEngagement = {
        ...mockEngagement,
        status: 'READY',
        reconciliation: { ...mockEngagement.reconciliation, completionPercentage: 100 },
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(readyEngagement as any)
      vi.mocked(generateBrief).mockResolvedValueOnce({
        success: true,
        brief: '# Prep Brief\n\nAll documents collected.',
      })

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Generate Brief/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Generate Brief/i }))

      await waitFor(() => {
        expect(generateBrief).toHaveBeenCalledWith('eng_001')
      })
    })

    it('displays existing prep brief', async () => {
      const engagementWithBrief = {
        ...mockEngagement,
        status: 'READY',
        prepBrief: '# Tax Prep Brief\n\nClient is ready for filing.',
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(engagementWithBrief as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText(/Tax Prep Brief/i)).toBeInTheDocument()
      })
    })
  })

  describe('Issue display', () => {
    it('displays document issues with severity indicators', async () => {
      const engagementWithIssues = {
        ...mockEngagement,
        documents: [
          {
            ...mockEngagement.documents[0],
            issues: ['[ERROR:wrong_year:2025:2024] Document is from 2024'],
            issueDetails: [
              {
                original: 'Wrong year',
                friendlyMessage: 'This document is from 2024, but we need 2025',
                suggestedAction: 'Request the 2025 version',
                severity: 'error' as const,
              },
            ],
          },
        ],
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(engagementWithIssues as any)

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('w2-2025.pdf')).toBeInTheDocument()
      })

      // Select document
      const user = userEvent.setup()
      await user.click(screen.getByText('w2-2025.pdf'))

      await waitFor(() => {
        expect(screen.getByText('This document is from 2024, but we need 2025')).toBeInTheDocument()
      })
    })

    it('fetches friendly issues for legacy documents', async () => {
      const engagementWithIssues = {
        ...mockEngagement,
        documents: [
          {
            ...mockEngagement.documents[0],
            issues: ['[ERROR:wrong_year:2025:2024] Wrong year'],
            issueDetails: null, // No cached issue details
          },
        ],
      }
      vi.mocked(getEngagement).mockResolvedValueOnce(engagementWithIssues as any)
      vi.mocked(getFriendlyIssues).mockResolvedValueOnce({
        issues: [
          {
            original: 'Wrong year',
            friendlyMessage: 'Generated friendly message',
            suggestedAction: 'Request 2025 version',
            severity: 'error' as const,
          },
        ],
      })

      renderWithRouter('eng_001')

      await waitFor(() => {
        expect(screen.getByText('w2-2025.pdf')).toBeInTheDocument()
      })

      const user = userEvent.setup()
      await user.click(screen.getByText('w2-2025.pdf'))

      await waitFor(() => {
        expect(getFriendlyIssues).toHaveBeenCalledWith('eng_001', 'doc_001')
      })
    })
  })
})
