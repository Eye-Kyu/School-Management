// =============================================================================
// Checkpoint state file — Refinement 1 (Phase 2 review).
// =============================================================================
// A mid-run auth-creation failure leaves dangling `auth.users` rows with no
// corresponding `public.users`/`students`/etc rows yet (those come after).
// Without a record of exactly which auth ids were created, cleaning that up
// means hunting by email pattern across auth.users — doable, but slow and
// error-prone under time pressure right after a failure. This module keeps
// an on-disk, continuously-updated record so `teardown-sample-school.ts
// --state-file <path>` can clean up precisely, even if the `schools` row
// itself was never created (a failure during the very first auth user).
//
// Written synchronously after every single mutation, not batched — a
// batch-then-write approach would defeat the entire point: a crash mid-batch
// must never lose the ids already created in that same batch.
// =============================================================================

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface SeedState {
  startedAt: string;
  schoolName: string;
  schoolId: string | null;
  authUserIds: string[];
  completedAt: string | null;
}

export class StateFile {
  readonly path: string;
  private state: SeedState;

  private constructor(path: string, state: SeedState) {
    this.path = path;
    this.state = state;
  }

  static create(schoolName: string): StateFile {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = join(tmpdir(), `sample-school-seed-state-${timestamp}.json`);
    const state: SeedState = {
      startedAt: new Date().toISOString(),
      schoolName,
      schoolId: null,
      authUserIds: [],
      completedAt: null,
    };
    const file = new StateFile(path, state);
    file.flush();
    return file;
  }

  static load(path: string): StateFile {
    if (!existsSync(path)) throw new Error(`State file not found: ${path}`);
    const state = JSON.parse(readFileSync(path, 'utf8')) as SeedState;
    return new StateFile(path, state);
  }

  private flush(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2), 'utf8');
  }

  setSchoolId(schoolId: string): void {
    this.state.schoolId = schoolId;
    this.flush();
  }

  appendAuthUserId(id: string): void {
    this.state.authUserIds.push(id);
    this.flush();
  }

  markCompleted(): void {
    this.state.completedAt = new Date().toISOString();
    this.flush();
  }

  get schoolId(): string | null {
    return this.state.schoolId;
  }

  get schoolName(): string {
    return this.state.schoolName;
  }

  get authUserIds(): readonly string[] {
    return this.state.authUserIds;
  }
}
