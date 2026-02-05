import { describe, it, expect } from 'vitest'
import {
  parseIssue,
  getSuggestedAction,
  hasErrors,
  hasWarnings,
  type ParsedIssue,
} from '../issues'

describe('parseIssue', () => {
  describe('new format parsing', () => {
    it('parses standard format with all fields', () => {
      const result = parseIssue('[ERROR:wrong_year:2025:2024] Document is from 2024')

      expect(result).toEqual({
        severity: 'error',
        type: 'wrong_year',
        expected: '2025',
        detected: '2024',
        description: 'Document is from 2024',
      })
    })

    it('parses format with empty expected/detected', () => {
      const result = parseIssue('[WARNING:low_confidence::] Classification confidence below 70%')

      expect(result).toEqual({
        severity: 'warning',
        type: 'low_confidence',
        expected: null,
        detected: null,
        description: 'Classification confidence below 70%',
      })
    })

    it('normalizes severity to lowercase', () => {
      const result = parseIssue('[WARNING:other::] Warning message')
      expect(result.severity).toBe('warning')
    })
  })

  describe('legacy format parsing', () => {
    it('parses legacy format and infers error severity', () => {
      const result = parseIssue('[wrong_year] Wrong year detected')

      expect(result).toEqual({
        severity: 'error',
        type: 'wrong_year',
        expected: null,
        detected: null,
        description: 'Wrong year detected',
      })
    })

    it('parses legacy format and infers warning severity', () => {
      const result = parseIssue('[low_confidence] Uncertain classification')

      expect(result).toEqual({
        severity: 'warning',
        type: 'low_confidence',
        expected: null,
        detected: null,
        description: 'Uncertain classification',
      })
    })
  })

  describe('plain string handling', () => {
    it('handles plain strings as warnings', () => {
      const result = parseIssue('Some plain issue description')

      expect(result).toEqual({
        severity: 'warning',
        type: 'other',
        expected: null,
        detected: null,
        description: 'Some plain issue description',
      })
    })
  })
})

describe('getSuggestedAction', () => {
  it('returns action for wrong_year with expected', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_year',
      expected: '2025',
      detected: '2024',
      description: 'Wrong year',
    }

    expect(getSuggestedAction(parsed)).toBe('Request document for tax year 2025')
  })

  it('returns action for wrong_year without expected', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_year',
      expected: null,
      detected: null,
      description: 'Wrong year',
    }

    expect(getSuggestedAction(parsed)).toBe('Request document for the correct tax year')
  })

  it('returns action for wrong_type with values', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_type',
      expected: 'W-2',
      detected: '1099-NEC',
      description: 'Wrong type',
    }

    expect(getSuggestedAction(parsed)).toBe('Request W-2 instead of 1099-NEC')
  })

  it('returns action for incomplete', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'incomplete',
      expected: null,
      detected: null,
      description: 'Missing pages',
    }

    expect(getSuggestedAction(parsed)).toBe('Request complete document with all pages')
  })

  it('returns action for illegible', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'illegible',
      expected: null,
      detected: null,
      description: 'Cannot read',
    }

    expect(getSuggestedAction(parsed)).toBe('Request clearer scan or photo')
  })

  it('returns action for duplicate', () => {
    const parsed: ParsedIssue = {
      severity: 'warning',
      type: 'duplicate',
      expected: null,
      detected: null,
      description: 'Duplicate',
    }

    expect(getSuggestedAction(parsed)).toBe('Verify if duplicate is intentional')
  })

  it('returns action for low_confidence', () => {
    const parsed: ParsedIssue = {
      severity: 'warning',
      type: 'low_confidence',
      expected: null,
      detected: null,
      description: 'Low confidence',
    }

    expect(getSuggestedAction(parsed)).toBe('Manually verify document classification')
  })

  it('returns generic action for unknown types', () => {
    const parsed: ParsedIssue = {
      severity: 'warning',
      type: 'unknown',
      expected: null,
      detected: null,
      description: 'Unknown issue',
    }

    expect(getSuggestedAction(parsed)).toBe('Review and take appropriate action')
  })
})

describe('hasErrors', () => {
  it('returns true when issues contain errors', () => {
    const issues = [
      '[ERROR:wrong_year:2025:2024] Wrong year',
      '[WARNING:low_confidence::] Low confidence',
    ]

    expect(hasErrors(issues)).toBe(true)
  })

  it('returns false when no errors', () => {
    const issues = [
      '[WARNING:low_confidence::] Low confidence',
      '[WARNING:duplicate::] Duplicate',
    ]

    expect(hasErrors(issues)).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(hasErrors([])).toBe(false)
  })
})

describe('hasWarnings', () => {
  it('returns true when issues contain warnings', () => {
    const issues = [
      '[ERROR:wrong_year:2025:2024] Wrong year',
      '[WARNING:low_confidence::] Low confidence',
    ]

    expect(hasWarnings(issues)).toBe(true)
  })

  it('returns false when no warnings', () => {
    const issues = [
      '[ERROR:wrong_year:2025:2024] Wrong year',
      '[ERROR:incomplete::] Incomplete',
    ]

    expect(hasWarnings(issues)).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(hasWarnings([])).toBe(false)
  })
})
