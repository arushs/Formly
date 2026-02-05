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
    expect(screen.getByLabelText(/Dropbox Folder URL/i)).toBeInTheDocument()
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
      screen.getByLabelText(/Dropbox Folder URL/i),
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
      screen.getByLabelText(/Dropbox Folder URL/i),
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
      screen.getByLabelText(/Dropbox Folder URL/i),
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
      screen.getByLabelText(/Dropbox Folder URL/i),
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
    const urlInput = screen.getByLabelText(/Dropbox Folder URL/i)

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

    const urlInput = screen.getByLabelText(/Dropbox Folder URL/i)
    expect(urlInput).toHaveAttribute('type', 'url')
  })
})
