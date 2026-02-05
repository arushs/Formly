import { describe, it, expect } from 'vitest'
import {
  parseIssue,
  isErrorType,
  getSuggestedAction,
  hasErrors,
  hasWarnings,
  type ParsedIssue,
} from '../issues.js'

describe('parseIssue', () => {
  describe('new format parsing', () => {
    it('parses standard format with all fields', () => {
      const result = parseIssue('[ERROR:wrong_year:2025:2024] Document is from 2024, expected 2025')

      expect(result).toEqual({
        severity: 'error',
        type: 'wrong_year',
        expected: '2025',
        detected: '2024',
        description: 'Document is from 2024, expected 2025',
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

    it('parses format with only expected value', () => {
      const result = parseIssue('[ERROR:missing_field:box_1_wages:] Box 1 is not visible')

      expect(result).toEqual({
        severity: 'error',
        type: 'missing_field',
        expected: 'box_1_wages',
        detected: null,
        description: 'Box 1 is not visible',
      })
    })

    it('parses format with only detected value', () => {
      const result = parseIssue('[WARNING:illegible::employer_ein] Employer EIN is blurry')

      expect(result).toEqual({
        severity: 'warning',
        type: 'illegible',
        expected: null,
        detected: 'employer_ein',
        description: 'Employer EIN is blurry',
      })
    })

    it('normalizes severity to lowercase', () => {
      const result = parseIssue('[WARNING:other::] Some warning')
      expect(result.severity).toBe('warning')
    })
  })

  describe('legacy format parsing', () => {
    it('parses legacy format and infers severity from type', () => {
      const result = parseIssue('[wrong_year] Document is from wrong year')

      expect(result).toEqual({
        severity: 'error',
        type: 'wrong_year',
        expected: null,
        detected: null,
        description: 'Document is from wrong year',
      })
    })

    it('treats unknown types as warnings', () => {
      const result = parseIssue('[some_type] Some message')

      expect(result.severity).toBe('warning')
    })
  })

  describe('plain string handling', () => {
    it('handles plain strings as warnings with unknown type', () => {
      const result = parseIssue('Some plain issue description')

      expect(result).toEqual({
        severity: 'warning',
        type: 'other',
        expected: null,
        detected: null,
        description: 'Some plain issue description',
      })
    })

    it('handles empty string', () => {
      const result = parseIssue('')

      expect(result).toEqual({
        severity: 'warning',
        type: 'other',
        expected: null,
        detected: null,
        description: '',
      })
    })
  })
})

describe('isErrorType', () => {
  it('returns true for error types', () => {
    expect(isErrorType('wrong_year')).toBe(true)
    expect(isErrorType('wrong_type')).toBe(true)
    expect(isErrorType('incomplete')).toBe(true)
    expect(isErrorType('illegible')).toBe(true)
  })

  it('returns false for non-error types', () => {
    expect(isErrorType('low_confidence')).toBe(false)
    expect(isErrorType('duplicate')).toBe(false)
    expect(isErrorType('other')).toBe(false)
    expect(isErrorType('unknown')).toBe(false)
  })
})

describe('getSuggestedAction', () => {
  it('returns specific action for wrong_year with expected', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_year',
      expected: '2025',
      detected: '2024',
      description: 'Wrong year',
    }

    expect(getSuggestedAction(parsed)).toBe('Request document for tax year 2025')
  })

  it('returns generic action for wrong_year without expected', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_year',
      expected: null,
      detected: null,
      description: 'Wrong year',
    }

    expect(getSuggestedAction(parsed)).toBe('Request document for the correct tax year')
  })

  it('returns specific action for wrong_type with both values', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_type',
      expected: 'W-2',
      detected: '1099-NEC',
      description: 'Wrong type',
    }

    expect(getSuggestedAction(parsed)).toBe('Request W-2 instead of 1099-NEC')
  })

  it('returns generic action for wrong_type without values', () => {
    const parsed: ParsedIssue = {
      severity: 'error',
      type: 'wrong_type',
      expected: null,
      detected: null,
      description: 'Wrong type',
    }

    expect(getSuggestedAction(parsed)).toBe('Request the correct document type')
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
      description: 'Cannot read document',
    }

    expect(getSuggestedAction(parsed)).toBe('Request clearer scan or photo')
  })

  it('returns action for duplicate', () => {
    const parsed: ParsedIssue = {
      severity: 'warning',
      type: 'duplicate',
      expected: null,
      detected: null,
      description: 'Duplicate document',
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
      type: 'unknown_type',
      expected: null,
      detected: null,
      description: 'Some issue',
    }

    expect(getSuggestedAction(parsed)).toBe('Review and take appropriate action')
  })
})

describe('hasErrors', () => {
  it('returns true when array contains errors', () => {
    const issues = [
      '[ERROR:wrong_year:2025:2024] Wrong year',
      '[WARNING:low_confidence::] Low confidence',
    ]

    expect(hasErrors(issues)).toBe(true)
  })

  it('returns false when array contains only warnings', () => {
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
  it('returns true when array contains warnings', () => {
    const issues = [
      '[ERROR:wrong_year:2025:2024] Wrong year',
      '[WARNING:low_confidence::] Low confidence',
    ]

    expect(hasWarnings(issues)).toBe(true)
  })

  it('returns false when array contains only errors', () => {
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
