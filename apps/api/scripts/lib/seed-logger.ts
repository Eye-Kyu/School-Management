// =============================================================================
// Dual stdout+file logger — Refinement 5 (Phase 2 review).
// =============================================================================
// Every INSERT operation and every auth-creation batch gets one line, in
// both places, so a run has a complete record even if the terminal scrolled
// past it. Exact line formats per the review's own examples:
//   [2026-08-09T09:15:23Z] INSERT schools -> 1 row (school_id: <uuid>)
//   [2026-08-09T09:15:34Z] AUTH USERS created 60/720 (target: 720)
// =============================================================================

import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export class SeedLogger {
  readonly logPath: string;

  constructor(prefix: 'seed' | 'teardown' = 'seed') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logPath = join(tmpdir(), `sample-school-${prefix}-log-${timestamp}.log`);
    writeFileSync(this.logPath, '', 'utf8');
  }

  private write(line: string): void {
    // eslint-disable-next-line no-console
    console.log(line);
    appendFileSync(this.logPath, `${line}\n`, 'utf8');
  }

  private timestamp(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  insert(table: string, count: number, schoolId: string): void {
    this.write(`[${this.timestamp()}] INSERT ${table} -> ${count} row${count === 1 ? '' : 's'} (school_id: ${schoolId})`);
  }

  authProgress(created: number, target: number): void {
    this.write(`[${this.timestamp()}] AUTH USERS created ${created}/${target} (target: ${target})`);
  }

  delete(table: string, count: number, schoolId: string): void {
    this.write(`[${this.timestamp()}] DELETE ${table} -> ${count} row${count === 1 ? '' : 's'} (school_id: ${schoolId})`);
  }

  info(message: string): void {
    this.write(`[${this.timestamp()}] ${message}`);
  }

  warn(message: string): void {
    this.write(`[${this.timestamp()}] WARNING: ${message}`);
  }

  error(message: string): void {
    this.write(`[${this.timestamp()}] ERROR: ${message}`);
  }
}
