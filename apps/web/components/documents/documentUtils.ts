export function fileSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(mime: string | null) {
  if (!mime) return '📄';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('sheet') || mime.includes('excel')) return '📊';
  if (mime.startsWith('image')) return '🖼';
  return '📄';
}

export type DocumentRow = {
  id: string;
  title: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  tags: string[];
  scope_type: 'SCHOOL_WIDE' | 'CLASS' | 'SUBJECT' | 'ASSIGNMENT';
  scope_subtype: 'HOMEWORK' | 'QUIZ' | 'ONLINE_ASSIGNMENT' | null;
  scope_id: string | null;
  uploaded_by_id: string;
  created_at: string;
  updated_at: string;
  uploader: { full_name: string } | null;
};

export function scopeLabel(row: Pick<DocumentRow, 'scope_type' | 'scope_subtype'>) {
  if (row.scope_type === 'SCHOOL_WIDE') return 'School-wide';
  if (row.scope_type === 'CLASS') return 'Class';
  if (row.scope_type === 'SUBJECT') return 'Subject';
  if (row.scope_subtype === 'HOMEWORK') return 'Homework';
  if (row.scope_subtype === 'QUIZ') return 'Quiz';
  return 'Assignment';
}
