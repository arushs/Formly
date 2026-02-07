# Formly Learnings

Lessons learned from QA testing and codebase investigation. Keep this updated as we fix issues and discover new patterns.

---

## Architecture Insights

### Document Processing Pipeline
```
Upload detected → Download file → OCR (Mistral) → Classify (GPT-4o) → Update DB
```
- **Sequential, not parallel** — each step waits for the previous
- Multiple API calls add latency: ~10-15s per document
- Consider: queue-based processing with concurrent workers

### State Management
- Documents have two status indicators:
  - `documentType`: What the doc is (W-2, 1099, PENDING)
  - `processingStatus`: Where it is in pipeline (pending, in_progress, classified)
- **Bug pattern**: These can get out of sync if errors occur mid-processing
- **Lesson**: Always update both atomically, or use a single source of truth

### AI Confidence Scoring
- GPT-4o returns confidence based on **form recognition**, not content completeness
- Empty form with clear structure → high confidence (wrong!)
- **Lesson**: Pre-check content before AI classification; don't trust confidence alone

---

## Common Bugs

### 1. Status Mismatch
**Symptom:** Doc shows ✓ (classified type) but also spinner (still processing)
**Cause:** Error during processing leaves `processingStatus` stuck
**Fix:** Wrap processing in try/catch, always set final status

### 2. Stuck Documents
**Symptom:** Document shows "Processing..." forever
**Cause:** No timeout handling; crashed agent leaves doc in limbo
**Fix:** Add `processingStartedAt` timestamp, timeout after 5 min

### 3. Empty Form False Positive
**Symptom:** Blank form classified with 90% confidence
**Cause:** AI recognizes template, ignores missing content
**Fix:** Check extracted text length before classification

---

## UX Patterns

### What Works
- Kanban-style status progression (INTAKE → COLLECTING → READY)
- Color-coded issue severity (red = error, yellow = warning)
- Inline document preview with issue details

### What Needs Work
- No progress indication during processing
- Duplicate info between list and detail views
- Re-upload creates duplicate instead of replacing

---

## Testing Notes

### Good Test Coverage
- 198 tests passing
- Unit tests for all agents (assessment, reconciliation, dispatcher)
- Storage provider mocks (Dropbox, SharePoint, Google Drive)
- Webhook signature verification

### Missing Coverage
- E2E tests for full document flow
- Error recovery scenarios
- Timeout handling
- Empty/corrupt file handling

---

## Performance Observations

### Bottlenecks
1. **Mistral OCR** — 3-5s per document
2. **GPT-4o classification** — 2-4s per document
3. **Sequential processing** — only one doc at a time

### Optimization Ideas
- Batch multiple docs per API call where possible
- Cache OCR results for re-classification
- Parallel processing with rate limiting
- Use GPT-4o-mini for simple classifications

---

## Integration Notes

### Dropbox
- Shared folder access requires either `folderId` OR `folderUrl`
- Cursor-based sync for incremental updates
- 25MB file size limit enforced

### Typeform
- Webhook signature: HMAC SHA256
- `engagement_id` passed via hidden field
- Idempotency: check for duplicate `event_id`

### Render Deployment
- Free tier suspends after inactivity
- Uses Docker for both API and Web
- PostgreSQL on Render's managed DB

---

---

## Data Cleanup

### Test Data Identification
Pattern-based detection for test engagements:
- **Emails**: `test@`, `demo@`, `@example.com`, `fake@`, `asdf@`
- **Names**: starts with "test", "demo", "sample", "fake"
- **Other**: names < 3 chars, repeated characters (e.g., "aaaa")

### Cleanup Options

**CLI Script:**
```bash
# Preview what would be deleted
cd apps/api && npm run cleanup

# Actually delete
cd apps/api && npm run cleanup:confirm

# Or directly
npx tsx scripts/cleanup-test-data.ts --confirm
```

**API Endpoint:**
```bash
# Preview test data
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-api/api/admin/test-data

# Delete all test data
curl -X DELETE -H "Authorization: Bearer $CRON_SECRET" \
  https://your-api/api/admin/test-data

# Delete specific engagement
curl -X DELETE -H "Authorization: Bearer $CRON_SECRET" \
  https://your-api/api/admin/engagements/:id
```

**Protected by**: `ADMIN_SECRET` or `CRON_SECRET` env var

---

*Last updated: 2026-02-07*
