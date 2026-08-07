'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { apiFetch } from '@/lib/api';

export type ScopeValue = {
  scopeType: 'SCHOOL_WIDE' | 'CLASS' | 'SUBJECT' | 'ASSIGNMENT';
  scopeSubtype?: 'HOMEWORK' | 'QUIZ' | 'ONLINE_ASSIGNMENT';
  scopeId?: string;
};

type Item = { id: string; name: string };

// Shared by the upload form, the retag flow, and the "attach existing
// document" picker — scope-type radios, then a conditional class/subject
// dropdown or a two-step assignment-subtype-then-item picker.
export default function ScopePicker({
  value,
  onChange,
  classes,
  subjects,
  isAdmin,
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  classes: Item[];
  subjects: Item[];
  isAdmin: boolean;
}) {
  const supabase = createClient();
  const [assignmentItems, setAssignmentItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    if (value.scopeType !== 'ASSIGNMENT' || !value.scopeSubtype) {
      setAssignmentItems([]);
      return;
    }
    let cancelled = false;
    setLoadingItems(true);

    async function load() {
      let items: Item[] = [];
      if (value.scopeSubtype === 'HOMEWORK') {
        const rows = await apiFetch<{ id: string; title: string }[]>('/homework');
        items = rows.map((r) => ({ id: r.id, name: r.title }));
      } else if (value.scopeSubtype === 'QUIZ') {
        const { data: userRow } = await supabase.from('users').select('id, role').maybeSingle();
        let q = supabase.from('quizzes').select('id, title').order('created_at', { ascending: false });
        if (userRow?.role !== 'ADMIN') q = q.eq('created_by_id', userRow?.id ?? '');
        const { data } = await q;
        items = (data ?? []).map((r) => ({ id: r.id, name: r.title }));
      } else if (value.scopeSubtype === 'ONLINE_ASSIGNMENT') {
        const { data: userRow } = await supabase.from('users').select('id, role').maybeSingle();
        let q = supabase.from('assignments').select('id, title').order('created_at', { ascending: false });
        if (userRow?.role !== 'ADMIN') q = q.eq('created_by_id', userRow?.id ?? '');
        const { data } = await q;
        items = (data ?? []).map((r) => ({ id: r.id, name: r.title }));
      }
      if (!cancelled) {
        setAssignmentItems(items);
        setLoadingItems(false);
      }
    }
    load().catch(() => { if (!cancelled) setLoadingItems(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.scopeType, value.scopeSubtype]);

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Scope</label>
        <div className="flex gap-2 flex-wrap">
          {(['SCHOOL_WIDE', 'SUBJECT', 'CLASS', 'ASSIGNMENT'] as const).map((t) => {
            const disabled = t === 'SCHOOL_WIDE' && !isAdmin;
            return (
              <button
                key={t}
                type="button"
                disabled={disabled}
                onClick={() => onChange({ scopeType: t })}
                title={disabled ? 'Only admins can publish school-wide documents' : undefined}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  value.scopeType === t
                    ? 'bg-slate-900 text-white border-slate-900'
                    : disabled
                    ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {t === 'SCHOOL_WIDE' ? 'School-wide' : t.charAt(0) + t.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>
      </div>

      {value.scopeType === 'CLASS' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Class</label>
          <select
            value={value.scopeId ?? ''}
            onChange={(e) => onChange({ scopeType: 'CLASS', scopeId: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {value.scopeType === 'SUBJECT' && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
          <select
            value={value.scopeId ?? ''}
            onChange={(e) => onChange({ scopeType: 'SUBJECT', scopeId: e.target.value })}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {value.scopeType === 'ASSIGNMENT' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
            <select
              value={value.scopeSubtype ?? ''}
              onChange={(e) => onChange({ scopeType: 'ASSIGNMENT', scopeSubtype: e.target.value as ScopeValue['scopeSubtype'] })}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              <option value="HOMEWORK">Homework</option>
              <option value="QUIZ">Quiz</option>
              <option value="ONLINE_ASSIGNMENT">Assignment</option>
            </select>
          </div>
          {value.scopeSubtype && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {value.scopeSubtype === 'HOMEWORK' ? 'Homework' : value.scopeSubtype === 'QUIZ' ? 'Quiz' : 'Assignment'}
              </label>
              <select
                value={value.scopeId ?? ''}
                disabled={loadingItems}
                onChange={(e) => onChange({ ...value, scopeId: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">{loadingItems ? 'Loading…' : 'Select…'}</option>
                {assignmentItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
