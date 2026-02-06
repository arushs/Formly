import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom'
import NewEngagement from '../NewEngagement'

// Mock the API client
vi.mock('../../api/client', () => ({
  createEngagement: vi.fn(),
}))

import { createEngagement } from '../../api/client'

// Mock useNavigate
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function renderWithRouter(component: React.ReactNode) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('NewEngagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
  })

  it('renders form with all required fields', () => {
    renderWithRouter(<NewEngagement />)

    expect(screen.getByLabelText(/Client Name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Client Email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Storage Folder URL/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Engagement/i })).toBeInTheDocument()
  })

  it('renders back link to dashboard', () => {
    renderWithRouter(<NewEngagement />)

    const backLink = screen.getByRole('link', { name: /Back to Dashboard/i })
    expect(backLink).toHaveAttribute('href', '/')
  })

  it('submits form with valid data', async () => {
    const user = userEvent.setup()
    const mockEngagement = { id: 'eng_new' }
    vi.mocked(createEngagement).mockResolvedValueOnce(mockEngagement as any)

    renderWithRouter(<NewEngagement />)

    await user.type(screen.getByLabelText(/Client Name/i), 'Test Client')
    await user.type(screen.getByLabelText(/Client Email/i), 'test@example.com')
    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://www.dropbox.com/sh/test123/xyz'
    )

    await user.click(screen.getByRole('button', { name: /Create Engagement/i }))

    await waitFor(() => {
      expect(createEngagement).toHaveBeenCalledWith({
        clientName: 'Test Client',
        clientEmail: 'test@example.com',
        storageFolderUrl: 'https://www.dropbox.com/sh/test123/xyz',
      })
    })

    expect(mockNavigate).toHaveBeenCalledWith('/engagements/eng_new')
  })

  it('shows loading state while submitting', async () => {
    const user = userEvent.setup()
    vi.mocked(createEngagement).mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 1000))
    )

    renderWithRouter(<NewEngagement />)

    await user.type(screen.getByLabelText(/Client Name/i), 'Test Client')
    await user.type(screen.getByLabelText(/Client Email/i), 'test@example.com')
    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://www.dropbox.com/sh/test123/xyz'
    )

    await user.click(screen.getByRole('button', { name: /Create Engagement/i }))

    expect(screen.getByRole('button', { name: /Creating.../i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Creating.../i })).toBeDisabled()
  })

  it('displays error message on API failure', async () => {
    const user = userEvent.setup()
    vi.mocked(createEngagement).mockRejectedValueOnce(new Error('Invalid email address'))

    renderWithRouter(<NewEngagement />)

    await user.type(screen.getByLabelText(/Client Name/i), 'Test Client')
    // Use a valid email format to pass HTML5 validation - API will still reject
    await user.type(screen.getByLabelText(/Client Email/i), 'test@example.com')
    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://www.dropbox.com/sh/test123/xyz'
    )

    await user.click(screen.getByRole('button', { name: /Create Engagement/i }))

    await waitFor(() => {
      expect(screen.getByText('Invalid email address')).toBeInTheDocument()
    })
  })

  it('clears error on new submission attempt', async () => {
    const user = userEvent.setup()
    vi.mocked(createEngagement)
      .mockRejectedValueOnce(new Error('First error'))
      .mockResolvedValueOnce({ id: 'eng_new' } as any)

    renderWithRouter(<NewEngagement />)

    await user.type(screen.getByLabelText(/Client Name/i), 'Test Client')
    await user.type(screen.getByLabelText(/Client Email/i), 'test@example.com')
    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://www.dropbox.com/sh/test123/xyz'
    )

    // First submission - error
    await user.click(screen.getByRole('button', { name: /Create Engagement/i }))

    await waitFor(() => {
      expect(screen.getByText('First error')).toBeInTheDocument()
    })

    // Second submission - clear error first
    await user.click(screen.getByRole('button', { name: /Create Engagement/i }))

    await waitFor(() => {
      expect(screen.queryByText('First error')).not.toBeInTheDocument()
    })
  })

  it('requires all fields', () => {
    renderWithRouter(<NewEngagement />)

    const nameInput = screen.getByLabelText(/Client Name/i)
    const emailInput = screen.getByLabelText(/Client Email/i)
    const urlInput = screen.getByLabelText(/Storage Folder URL/i)

    expect(nameInput).toHaveAttribute('required')
    expect(emailInput).toHaveAttribute('required')
    expect(urlInput).toHaveAttribute('required')
  })

  it('validates email input type', () => {
    renderWithRouter(<NewEngagement />)

    const emailInput = screen.getByLabelText(/Client Email/i)
    expect(emailInput).toHaveAttribute('type', 'email')
  })

  it('validates URL input type', () => {
    renderWithRouter(<NewEngagement />)

    const urlInput = screen.getByLabelText(/Storage Folder URL/i)
    expect(urlInput).toHaveAttribute('type', 'url')
  })

  it('shows supported providers help text', () => {
    renderWithRouter(<NewEngagement />)

    expect(screen.getByText(/Supported: Dropbox, Google Drive, SharePoint\/OneDrive/i)).toBeInTheDocument()
  })

  it('detects Dropbox provider from URL', async () => {
    const user = userEvent.setup()
    renderWithRouter(<NewEngagement />)

    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://www.dropbox.com/sh/test123/xyz'
    )

    // Check detection indicator appears (green checkmark + "Detected:" text)
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText(/Detected:/)).toBeInTheDocument()
  })

  it('detects Google Drive provider from URL', async () => {
    const user = userEvent.setup()
    renderWithRouter(<NewEngagement />)

    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://drive.google.com/drive/folders/abc123'
    )

    // Check detection indicator appears (green checkmark + "Detected:" text)
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText(/Detected:/)).toBeInTheDocument()
  })

  it('detects SharePoint provider from URL', async () => {
    const user = userEvent.setup()
    renderWithRouter(<NewEngagement />)

    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://company.sharepoint.com/sites/documents'
    )

    // Check that detection shows up (green checkmark + "Detected:" text)
    expect(screen.getByText('✓')).toBeInTheDocument()
    expect(screen.getByText(/Detected:/)).toBeInTheDocument()
  })

  it('shows warning for unrecognized URL', async () => {
    const user = userEvent.setup()
    renderWithRouter(<NewEngagement />)

    await user.type(
      screen.getByLabelText(/Storage Folder URL/i),
      'https://unknown-service.com/folder'
    )

    expect(screen.getByText(/Unable to detect provider/)).toBeInTheDocument()
  })

  // Phase 2: Provider Selector Tests
  describe('Provider Selector', () => {
    it('renders provider selection buttons', () => {
      renderWithRouter(<NewEngagement />)

      expect(screen.getByRole('button', { name: 'Dropbox' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Google Drive' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'SharePoint/OneDrive' })).toBeInTheDocument()
    })

    it('shows provider-specific placeholder when Dropbox selected', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Dropbox' }))

      const urlInput = screen.getByLabelText(/Storage Folder URL/i)
      expect(urlInput).toHaveAttribute('placeholder', expect.stringContaining('dropbox.com'))
    })

    it('shows provider-specific placeholder when Google Drive selected', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Google Drive' }))

      const urlInput = screen.getByLabelText(/Storage Folder URL/i)
      expect(urlInput).toHaveAttribute('placeholder', expect.stringContaining('drive.google.com'))
    })

    it('shows provider-specific placeholder when SharePoint selected', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'SharePoint/OneDrive' }))

      const urlInput = screen.getByLabelText(/Storage Folder URL/i)
      expect(urlInput).toHaveAttribute('placeholder', expect.stringContaining('sharepoint.com'))
    })

    it('shows help text for selected provider', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Google Drive' }))

      expect(screen.getByText(/Get link/)).toBeInTheDocument()
    })

    it('shows mismatch error when URL does not match selected provider', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      // Select Dropbox
      await user.click(screen.getByRole('button', { name: 'Dropbox' }))

      // Enter Google Drive URL
      await user.type(
        screen.getByLabelText(/Storage Folder URL/i),
        'https://drive.google.com/drive/folders/abc123'
      )

      expect(screen.getByText(/URL is for Google Drive, but you selected Dropbox/)).toBeInTheDocument()
    })

    it('clears URL when switching to incompatible provider', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      // Enter Dropbox URL first
      await user.type(
        screen.getByLabelText(/Storage Folder URL/i),
        'https://www.dropbox.com/sh/test123/xyz'
      )

      // Now select Google Drive - should clear the URL
      await user.click(screen.getByRole('button', { name: 'Google Drive' }))

      const urlInput = screen.getByLabelText(/Storage Folder URL/i)
      expect(urlInput).toHaveValue('')
    })

    it('disables submit button when URL mismatches provider', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.type(screen.getByLabelText(/Client Name/i), 'Test Client')
      await user.type(screen.getByLabelText(/Client Email/i), 'test@example.com')

      // Select Dropbox
      await user.click(screen.getByRole('button', { name: 'Dropbox' }))

      // Enter SharePoint URL
      await user.type(
        screen.getByLabelText(/Storage Folder URL/i),
        'https://company.sharepoint.com/sites/test'
      )

      expect(screen.getByRole('button', { name: /Create Engagement/i })).toBeDisabled()
    })

    it('highlights selected provider button', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      const dropboxBtn = screen.getByRole('button', { name: 'Dropbox' })
      
      await user.click(dropboxBtn)

      expect(dropboxBtn).toHaveClass('border-blue-500')
      expect(dropboxBtn).toHaveClass('bg-blue-50')
    })
  })

  // Phase 3: OAuth Flow Tests
  describe('OAuth Flow', () => {
    it('shows input mode tabs when provider is selected', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Dropbox' }))

      expect(screen.getByRole('button', { name: 'Paste URL' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Connect Account' })).toBeInTheDocument()
    })

    it('shows URL input by default', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Dropbox' }))

      // URL input should be visible
      expect(screen.getByLabelText(/Storage Folder URL/i)).toBeInTheDocument()
    })

    it('shows Connect button in OAuth mode', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Dropbox' }))
      await user.click(screen.getByRole('button', { name: 'Connect Account' }))

      expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toBeInTheDocument()
    })

    it('shows Connect button for each provider', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      // Test Dropbox
      await user.click(screen.getByRole('button', { name: 'Dropbox' }))
      await user.click(screen.getByRole('button', { name: 'Connect Account' }))
      expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toBeInTheDocument()

      // Test Google Drive
      await user.click(screen.getByRole('button', { name: 'Google Drive' }))
      expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument()

      // Test SharePoint
      await user.click(screen.getByRole('button', { name: 'SharePoint/OneDrive' }))
      expect(screen.getByRole('button', { name: 'Connect SharePoint/OneDrive' })).toBeInTheDocument()
    })

    it('switches between URL and OAuth modes', async () => {
      const user = userEvent.setup()
      renderWithRouter(<NewEngagement />)

      await user.click(screen.getByRole('button', { name: 'Dropbox' }))
      
      // Start in URL mode
      expect(screen.getByLabelText(/Storage Folder URL/i)).toBeInTheDocument()
      
      // Switch to OAuth mode
      await user.click(screen.getByRole('button', { name: 'Connect Account' }))
      expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toBeInTheDocument()
      
      // Switch back to URL mode
      await user.click(screen.getByRole('button', { name: 'Paste URL' }))
      expect(screen.getByLabelText(/Storage Folder URL/i)).toBeInTheDocument()
    })
  })
})
