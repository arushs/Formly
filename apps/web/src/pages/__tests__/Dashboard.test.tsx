import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import Dashboard from '../Dashboard'

// Mock the API client
vi.mock('../../api/client', () => ({
  getEngagements: vi.fn(),
}))

import { getEngagements } from '../../api/client'

function renderWithRouter(component: React.ReactNode) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    vi.mocked(getEngagements).mockImplementation(() => new Promise(() => {}))

    renderWithRouter(<Dashboard />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders engagement list after loading', async () => {
    const mockEngagements = [
      {
        id: 'eng_001',
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        taxYear: 2025,
        status: 'COLLECTING',
        storageProvider: 'dropbox',
        storageFolderUrl: 'https://dropbox.com/sh/test',
        typeformFormId: 'form_123',
        checklist: null,
        documents: null,
        reconciliation: { completionPercentage: 50 },
        prepBrief: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      },
    ]
    vi.mocked(getEngagements).mockResolvedValueOnce(mockEngagements)

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument()
    })

    expect(screen.getByText('test@example.com')).toBeInTheDocument()
    expect(screen.getByText('Tax Year: 2025')).toBeInTheDocument()
    expect(screen.getByText('COLLECTING')).toBeInTheDocument()
    expect(screen.getByText('50% complete')).toBeInTheDocument()
  })

  it('renders empty state when no engagements', async () => {
    vi.mocked(getEngagements).mockResolvedValueOnce([])

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('No engagements yet')).toBeInTheDocument()
    })

    expect(screen.getByText('Create your first engagement')).toBeInTheDocument()
  })

  it('renders error state on API failure', async () => {
    vi.mocked(getEngagements).mockRejectedValueOnce(new Error('Network error'))

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Error: Network error')).toBeInTheDocument()
    })
  })

  it('links to engagement detail page', async () => {
    const mockEngagements = [
      {
        id: 'eng_001',
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        taxYear: 2025,
        status: 'PENDING',
        storageProvider: 'dropbox',
        storageFolderUrl: 'https://dropbox.com/sh/test',
        typeformFormId: 'form_123',
        checklist: null,
        documents: null,
        reconciliation: null,
        prepBrief: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      },
    ]
    vi.mocked(getEngagements).mockResolvedValueOnce(mockEngagements)

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Test Client')).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: /Test Client/i })
    expect(link).toHaveAttribute('href', '/engagements/eng_001')
  })

  it('links to new engagement page', async () => {
    vi.mocked(getEngagements).mockResolvedValueOnce([])

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('No engagements yet')).toBeInTheDocument()
    })

    const newEngagementLink = screen.getByRole('link', { name: /New Engagement/i })
    expect(newEngagementLink).toHaveAttribute('href', '/engagements/new')
  })

  it('displays multiple engagements', async () => {
    const mockEngagements = [
      {
        id: 'eng_001',
        clientName: 'Client One',
        clientEmail: 'one@example.com',
        taxYear: 2025,
        status: 'PENDING',
        storageProvider: 'dropbox',
        storageFolderUrl: 'https://dropbox.com/sh/1',
        typeformFormId: 'form_1',
        checklist: null,
        documents: null,
        reconciliation: null,
        prepBrief: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      },
      {
        id: 'eng_002',
        clientName: 'Client Two',
        clientEmail: 'two@example.com',
        taxYear: 2025,
        status: 'READY',
        storageProvider: 'dropbox',
        storageFolderUrl: 'https://dropbox.com/sh/2',
        typeformFormId: 'form_2',
        checklist: null,
        documents: null,
        reconciliation: { completionPercentage: 100 },
        prepBrief: null,
        createdAt: '2025-01-01',
        updatedAt: '2025-01-01',
      },
    ]
    vi.mocked(getEngagements).mockResolvedValueOnce(mockEngagements)

    renderWithRouter(<Dashboard />)

    await waitFor(() => {
      expect(screen.getByText('Client One')).toBeInTheDocument()
    })

    expect(screen.getByText('Client Two')).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(screen.getByText('READY')).toBeInTheDocument()
  })
})
