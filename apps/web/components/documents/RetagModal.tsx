'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import ScopePicker, { ScopeValue } from './ScopePicker';
import type { DocumentRow } from './documentUtils';

// Same overlay pattern as PaybillDashboard.tsx's MatchModal — the one
// existing "real modal" precedent in this app.
export default function RetagModal({
  doc, classes, subjects, isAdmin, onClose, onSaved,
}: {
  doc: DocumentRow;
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (updated: DocumentRow) => void;
}) {
  const [scope, setScope] = useState<ScopeValue>({
    scopeType: doc.scope_type,
    scopeSubtype: doc.scope_subtype ?? undefined,
    scopeId: doc.scope_id ?? undefined,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true);
    setErr('');
    try {
      const updated = await apiFetch<DocumentRow>(`/documents/${doc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ scopeType: scope.scopeType, scopeSubtype: scope.scopeSubtype, scopeId: scope.scopeId }),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update scope');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">Change scope</h2>
          <p className="text-sm text-slate-500 mt-0.5 truncate">{doc.title}</p>
        </div>

        {err && <p className="text-sm text-rose-600">{err}</p>}

        <ScopePicker value={scope} onChange={setScope} classes={classes} subjects={subjects} isAdmin={isAdmin} />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || (scope.scopeType !== 'SCHOOL_WIDE' && !scope.scopeId)}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
