// =============================================================================
// Assignment submission files (SA-02, security audit 2026-11)
// =============================================================================
// The `assignments` Storage bucket is private. submissions.file_urls stores
// object PATHS (submissions/<assignment_id>/<auth_uid>/<file>), and the UI
// opens files through short-lived signed URLs (see SubmissionFileLink).
//
// Rows written before the fix hold public URLs
// (.../storage/v1/object/public/assignments/<path>). Those are mapped back to
// their path. Anything else (an arbitrary URL a student wrote into file_urls)
// is not a submission file and must never be rendered as a link.
// =============================================================================

export const ASSIGNMENTS_BUCKET = 'assignments';
const PUBLIC_MARKER = `/storage/v1/object/public/${ASSIGNMENTS_BUCKET}/`;
const SIGN_MARKER = `/storage/v1/object/sign/${ASSIGNMENTS_BUCKET}/`;

/** Returns the bucket-relative object path, or null when the value is not an assignments-bucket submission file. */
export function toAssignmentStoragePath(value: string | null | undefined): string | null {
  if (!value) return null;
  let path: string | null = null;
  if (value.startsWith('submissions/')) {
    path = value;
  } else {
    for (const marker of [PUBLIC_MARKER, SIGN_MARKER]) {
      const i = value.indexOf(marker);
      if (i >= 0) {
        try {
          path = decodeURIComponent(value.slice(i + marker.length).split('?')[0] ?? '');
        } catch {
          return null;
        }
        break;
      }
    }
  }
  if (!path || !path.startsWith('submissions/') || path.split('/').some((seg) => seg === '..')) return null;
  return path;
}

/** Display name for a stored submission file (the upload prefix `<ms>_` is stripped). */
export function submissionFileName(path: string): string {
  const last = path.split('/').pop() ?? path;
  return last.replace(/^\d+_/, '');
}

/** Object path a student uploads to. The third segment must be the uploader's auth uid (Storage RLS). */
export function buildSubmissionPath(assignmentId: string, authUid: string, fileName: string): string {
  const safeName = fileName.replace(/[/\\]/g, '_');
  return `submissions/${assignmentId}/${authUid}/${Date.now()}_${safeName}`;
}
