// =============================================================================
// Audit log taxonomy - the known set of `action`/`entity_type` pairs written
// to `audit_logs` across the app, used to populate the SuperAdmin audit
// viewer's filter dropdowns without a live DISTINCT query. Not exhaustive by
// construction: new actions added later just won't have a friendly label
// until this list is updated — the viewer's free-text search covers that
// gap. Hardcoded the same way PlatformPermission is.
// =============================================================================

export type AuditLogActionInfo = {
  action: string;
  entityType: string;
  label: string;
};

export const AUDIT_LOG_ACTIONS: AuditLogActionInfo[] = [
  { action: 'auth.login', entityType: 'user', label: 'Signed in' },
  { action: 'auth.logout', entityType: 'user', label: 'Signed out' },
  { action: 'auth.password_reset', entityType: 'user', label: 'Reset password' },
  { action: 'auth.login_failed', entityType: 'user', label: 'Failed sign-in' },
  { action: 'student.create', entityType: 'student', label: 'Student created' },
  { action: 'student.update', entityType: 'student', label: 'Student updated' },
  { action: 'student.delete', entityType: 'student', label: 'Student removed' },
  { action: 'students.import_csv', entityType: 'student', label: 'Students imported (CSV)' },
  { action: 'teacher.create', entityType: 'teacher', label: 'Teacher created' },
  { action: 'teacher.update', entityType: 'teacher', label: 'Teacher updated' },
  { action: 'teacher.delete', entityType: 'teacher', label: 'Teacher removed' },
  { action: 'guardian.create', entityType: 'user', label: 'Guardian created' },
  { action: 'guardian.delete', entityType: 'user', label: 'Guardian removed' },
  { action: 'class.create', entityType: 'class', label: 'Class created' },
  { action: 'class.update', entityType: 'class', label: 'Class updated' },
  { action: 'class.delete', entityType: 'class', label: 'Class removed' },
  { action: 'class.set_prefect', entityType: 'class', label: 'Class prefect set' },
  { action: 'subject.create', entityType: 'subject', label: 'Subject created' },
  { action: 'subject.delete', entityType: 'subject', label: 'Subject removed' },
  { action: 'subject_assignment.create', entityType: 'subject_assignment', label: 'Subject assigned to teacher' },
  { action: 'subject_assignment.delete', entityType: 'subject_assignment', label: 'Subject unassigned from teacher' },
  { action: 'term.create', entityType: 'term', label: 'Term created' },
  { action: 'term.set_current', entityType: 'term', label: 'Current term changed' },
  { action: 'timetable_slot.create', entityType: 'timetable_slot', label: 'Timetable slot created' },
  { action: 'timetable_slot.delete', entityType: 'timetable_slot', label: 'Timetable slot removed' },
  { action: 'attendance.mark', entityType: 'attendance_record', label: 'Attendance marked' },
  { action: 'homework.create', entityType: 'homework_assignment', label: 'Homework assigned' },
  { action: 'homework.complete', entityType: 'homework_completion', label: 'Homework marked complete' },
  { action: 'homework.uncomplete', entityType: 'homework_completion', label: 'Homework marked incomplete' },
  { action: 'fees.import_csv', entityType: 'fee_balance', label: 'Fee balances imported (CSV)' },
  { action: 'fee.paid', entityType: 'payment_transaction', label: 'Fee payment recorded' },
  { action: 'announcement.create', entityType: 'announcement', label: 'Announcement posted' },
  { action: 'event.create', entityType: 'event', label: 'Event created' },
  { action: 'message.send', entityType: 'message', label: 'Message sent' },
  { action: 'privileged_access.grant', entityType: 'privileged_access_grants', label: 'Privileged access granted' },
  { action: 'privileged_access.end', entityType: 'privileged_access_grants', label: 'Privileged access session ended' },
  { action: 'school.create', entityType: 'school', label: 'School created' },
  { action: 'school.update', entityType: 'school', label: 'School updated' },
  { action: 'school.status_change', entityType: 'school', label: 'School status changed' },
  { action: 'school.onboard', entityType: 'school', label: 'School onboarded' },
  { action: 'school.subscription_change', entityType: 'school_subscriptions', label: 'School subscription changed' },
  { action: 'school.curriculum_change', entityType: 'school', label: 'School curriculum tag changed' },
  { action: 'module.enable', entityType: 'school_modules', label: 'Module enabled' },
  { action: 'module.disable', entityType: 'school_modules', label: 'Module disabled' },
];

export const AUDIT_LOG_ENTITY_TYPES: string[] = [...new Set(AUDIT_LOG_ACTIONS.map((a) => a.entityType))].sort();
