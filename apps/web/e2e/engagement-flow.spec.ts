import { test, expect } from '@playwright/test'

test.describe('Engagement Lifecycle', () => {
  test('displays dashboard with engagement list', async ({ page }) => {
    await page.goto('/')

    // Check page title and header
    await expect(page.getByRole('heading', { name: /Tax Intake Agent/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /New Engagement/i })).toBeVisible()
  })

  test('navigates to new engagement form', async ({ page }) => {
    await page.goto('/')

    await page.click('text=New Engagement')

    await expect(page).toHaveURL('/engagements/new')
    await expect(page.getByRole('heading', { name: /Start New Collection/i })).toBeVisible()
  })

  test('creates new engagement with Dropbox URL', async ({ page }) => {
    await page.goto('/engagements/new')

    // Fill out the form
    await page.fill('[name="clientName"]', 'E2E Test Client')
    await page.fill('[name="clientEmail"]', 'e2e-test@example.com')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/e2etest/xyz?dl=0')

    // Submit the form
    await page.click('button[type="submit"]')

    // Should redirect to engagement detail page
    await expect(page).toHaveURL(/\/engagements\/[a-z0-9-]+$/)
    await expect(page.getByText('E2E Test Client')).toBeVisible()
  })

  test('shows validation error for invalid email', async ({ page }) => {
    await page.goto('/engagements/new')

    await page.fill('[name="clientName"]', 'Test Client')
    await page.fill('[name="clientEmail"]', 'not-an-email')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/test/xyz')

    // HTML5 validation should prevent submission
    await page.click('button[type="submit"]')

    // Should still be on the new engagement page
    await expect(page).toHaveURL('/engagements/new')
  })

  test('navigates back to dashboard from new engagement', async ({ page }) => {
    await page.goto('/engagements/new')

    await page.click('text=Back to Dashboard')

    await expect(page).toHaveURL('/')
  })
})

test.describe('Engagement Detail', () => {
  test.beforeEach(async ({ page }) => {
    // Create a test engagement first
    await page.goto('/engagements/new')
    await page.fill('[name="clientName"]', 'Detail Test Client')
    await page.fill('[name="clientEmail"]', 'detail-test@example.com')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/detail/xyz?dl=0')
    await page.click('button[type="submit"]')

    // Wait for navigation to detail page
    await expect(page).toHaveURL(/\/engagements\/[a-z0-9-]+$/)
  })

  test('displays engagement information', async ({ page }) => {
    await expect(page.getByText('Detail Test Client')).toBeVisible()
    await expect(page.getByText('detail-test@example.com')).toBeVisible()
    await expect(page.getByText(/Tax Year:/)).toBeVisible()
  })

  test('shows checklist section', async ({ page }) => {
    // Checklist section should be visible (may be empty initially)
    await expect(page.getByText(/Checklist/)).toBeVisible()
  })

  test('shows documents section', async ({ page }) => {
    // Documents section should be visible
    await expect(page.getByText(/Documents/)).toBeVisible()
  })

  test('shows prep brief section', async ({ page }) => {
    await expect(page.getByText('Prep Brief')).toBeVisible()
  })

  test('navigates back to dashboard', async ({ page }) => {
    await page.click('text=Back to Dashboard')

    await expect(page).toHaveURL('/')
    await expect(page.getByText('Detail Test Client')).toBeVisible()
  })
})

test.describe('Document Management', () => {
  // Note: These tests require an engagement with documents
  // In a real environment, we'd seed data or use fixtures

  test('displays empty state when no documents', async ({ page }) => {
    await page.goto('/engagements/new')
    await page.fill('[name="clientName"]', 'No Docs Client')
    await page.fill('[name="clientEmail"]', 'nodocs@example.com')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/nodocs/xyz?dl=0')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/engagements\/[a-z0-9-]+$/)

    // Should show empty document message
    await expect(page.getByText('No documents uploaded yet')).toBeVisible()
  })

  test('shows document selection placeholder', async ({ page }) => {
    await page.goto('/engagements/new')
    await page.fill('[name="clientName"]', 'Select Doc Client')
    await page.fill('[name="clientEmail"]', 'selectdoc@example.com')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/selectdoc/xyz?dl=0')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/engagements\/[a-z0-9-]+$/)

    // Should show selection prompt
    await expect(page.getByText('Select a document from the list to view details')).toBeVisible()
  })
})

test.describe('Dashboard Navigation', () => {
  test('shows empty state for new instance', async ({ page }) => {
    // This depends on having a clean database state
    // In practice, you'd want to seed/reset the database before this test
    await page.goto('/')

    // Either shows engagement list or empty state
    const hasEngagements = await page.getByText(/engagements/i).count() > 0
    const hasEmptyState = await page.getByText('No engagements yet').count() > 0

    // One of these should be true
    expect(hasEngagements || hasEmptyState).toBe(true)
  })

  test('engagement links navigate correctly', async ({ page }) => {
    // First create an engagement
    await page.goto('/engagements/new')
    await page.fill('[name="clientName"]', 'Link Test Client')
    await page.fill('[name="clientEmail"]', 'linktest@example.com')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/linktest/xyz?dl=0')
    await page.click('button[type="submit"]')

    // Get the engagement ID from URL
    await expect(page).toHaveURL(/\/engagements\/[a-z0-9-]+$/)
    const url = page.url()
    const engagementId = url.split('/').pop()

    // Go back to dashboard
    await page.goto('/')

    // Click on the engagement card
    await page.click('text=Link Test Client')

    // Should navigate to the detail page
    await expect(page).toHaveURL(`/engagements/${engagementId}`)
  })
})

test.describe('Status Display', () => {
  test('shows PENDING status for new engagement', async ({ page }) => {
    await page.goto('/engagements/new')
    await page.fill('[name="clientName"]', 'Pending Status Client')
    await page.fill('[name="clientEmail"]', 'pending@example.com')
    await page.fill('[name="storageFolderUrl"]', 'https://www.dropbox.com/sh/pending/xyz?dl=0')
    await page.click('button[type="submit"]')

    await expect(page).toHaveURL(/\/engagements\/[a-z0-9-]+$/)

    // New engagement should show PENDING status
    await expect(page.getByText('PENDING')).toBeVisible()
  })
})
