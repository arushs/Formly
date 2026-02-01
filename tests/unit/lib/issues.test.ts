import { describe, it, expect } from 'vitest'
import {
  parseIssue,
  getSuggestedAction,
  isErrorType,
  hasErrors,
  hasWarnings,
} from '@/lib/issues'

describe('Issue Parser', () => {
  describe('parseIssue', () => {
    it('should parse new format with all fields', () => {
      const issue = '[ERROR:wrong_year:2025:2024] Document is from 2024, expected 2025'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('error')
      expect(parsed.type).toBe('wrong_year')
      expect(parsed.expected).toBe('2025')
      expect(parsed.detected).toBe('2024')
      expect(parsed.description).toBe('Document is from 2024, expected 2025')
    })

    it('should parse new format with empty expected/detected', () => {
      const issue = '[WARNING:low_confidence::] Classification confidence below 70%'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('warning')
      expect(parsed.type).toBe('low_confidence')
      expect(parsed.expected).toBeNull()
      expect(parsed.detected).toBeNull()
      expect(parsed.description).toBe('Classification confidence below 70%')
    })

    it('should parse new format with only expected', () => {
      const issue = '[ERROR:incomplete:W-2:] Missing second page'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('error')
      expect(parsed.type).toBe('incomplete')
      expect(parsed.expected).toBe('W-2')
      expect(parsed.detected).toBeNull()
    })

    it('should parse new format with only detected', () => {
      const issue = '[WARNING:duplicate::doc-123] Possible duplicate document'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('warning')
      expect(parsed.type).toBe('duplicate')
      expect(parsed.expected).toBeNull()
      expect(parsed.detected).toBe('doc-123')
    })

    it('should parse legacy format [type] description', () => {
      const issue = '[wrong_year] Document is from wrong year'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('error') // wrong_year is an error type
      expect(parsed.type).toBe('wrong_year')
      expect(parsed.expected).toBeNull()
      expect(parsed.detected).toBeNull()
      expect(parsed.description).toBe('Document is from wrong year')
    })

    it('should treat unknown legacy types as warnings', () => {
      const issue = '[custom_type] Some custom issue'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('warning')
      expect(parsed.type).toBe('custom_type')
    })

    it('should handle plain string issues', () => {
      const issue = 'Something went wrong with this document'
      const parsed = parseIssue(issue)

      expect(parsed.severity).toBe('warning')
      expect(parsed.type).toBe('other')
      expect(parsed.expected).toBeNull()
      expect(parsed.detected).toBeNull()
      expect(parsed.description).toBe('Something went wrong with this document')
    })

    it('should be case-insensitive for severity', () => {
      const errorIssue = '[ERROR:wrong_year::] Wrong year'
      const warningIssue = '[WARNING:low_confidence::] Low confidence'

      expect(parseIssue(errorIssue).severity).toBe('error')
      expect(parseIssue(warningIssue).severity).toBe('warning')
    })
  })

  describe('isErrorType', () => {
    it('should return true for error types', () => {
      expect(isErrorType('wrong_year')).toBe(true)
      expect(isErrorType('wrong_type')).toBe(true)
      expect(isErrorType('incomplete')).toBe(true)
      expect(isErrorType('illegible')).toBe(true)
    })

    it('should return false for warning types', () => {
      expect(isErrorType('low_confidence')).toBe(false)
      expect(isErrorType('duplicate')).toBe(false)
      expect(isErrorType('other')).toBe(false)
      expect(isErrorType('custom')).toBe(false)
    })
  })

  describe('getSuggestedAction', () => {
    it('should suggest action for wrong_year with expected', () => {
      const parsed = parseIssue('[ERROR:wrong_year:2025:2024] Document is from 2024')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Request document for tax year 2025')
    })

    it('should suggest generic action for wrong_year without expected', () => {
      const parsed = parseIssue('[ERROR:wrong_year::2024] Document is from wrong year')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Request document for the correct tax year')
    })

    it('should suggest action for wrong_type with both values', () => {
      const parsed = parseIssue('[ERROR:wrong_type:W-2:1099-NEC] Wrong document type')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Request W-2 instead of 1099-NEC')
    })

    it('should suggest generic action for wrong_type without values', () => {
      const parsed = parseIssue('[ERROR:wrong_type::] Wrong document type')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Request the correct document type')
    })

    it('should suggest action for incomplete', () => {
      const parsed = parseIssue('[ERROR:incomplete::] Missing pages')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Request complete document with all pages')
    })

    it('should suggest action for illegible', () => {
      const parsed = parseIssue('[ERROR:illegible::] Cannot read document')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Request clearer scan or photo')
    })

    it('should suggest action for duplicate', () => {
      const parsed = parseIssue('[WARNING:duplicate::] Possible duplicate')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Verify if duplicate is intentional')
    })

    it('should suggest action for low_confidence', () => {
      const parsed = parseIssue('[WARNING:low_confidence::] Low confidence')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Manually verify document classification')
    })

    it('should suggest generic action for unknown types', () => {
      const parsed = parseIssue('[WARNING:unknown_type::] Some issue')
      const action = getSuggestedAction(parsed)

      expect(action).toBe('Review and take appropriate action')
    })
  })

  describe('hasErrors', () => {
    it('should return true if any issue is an error', () => {
      const issues = [
        '[WARNING:low_confidence::] Low confidence',
        '[ERROR:wrong_year:2025:2024] Wrong year',
      ]
      expect(hasErrors(issues)).toBe(true)
    })

    it('should return false if all issues are warnings', () => {
      const issues = [
        '[WARNING:low_confidence::] Low confidence',
        '[WARNING:duplicate::] Duplicate',
      ]
      expect(hasErrors(issues)).toBe(false)
    })

    it('should return false for empty issues array', () => {
      expect(hasErrors([])).toBe(false)
    })
  })

  describe('hasWarnings', () => {
    it('should return true if any issue is a warning', () => {
      const issues = [
        '[ERROR:wrong_year:2025:2024] Wrong year',
        '[WARNING:low_confidence::] Low confidence',
      ]
      expect(hasWarnings(issues)).toBe(true)
    })

    it('should return false if all issues are errors', () => {
      const issues = [
        '[ERROR:wrong_year:2025:2024] Wrong year',
        '[ERROR:incomplete::] Missing pages',
      ]
      expect(hasWarnings(issues)).toBe(false)
    })

    it('should return false for empty issues array', () => {
      expect(hasWarnings([])).toBe(false)
    })
  })
})
