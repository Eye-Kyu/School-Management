import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { concatMap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthedRequest } from '../../auth/auth.guard';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Global interceptor: for every mutating request made under an active
 * assist context (req.assistContext, set by AuthGuard), writes an
 * additional `assist.<method> <route>` audit_logs row alongside whatever
 * the handling service already logs under its own normal action name.
 * Generic method+route naming (not each service's specific action string)
 * so this doesn't require per-service wiring — every assist-mode mutation
 * gets a trace automatically, present or future.
 *
 * Uses concatMap (not tap) so the audit insert is awaited as part of the
 * response pipeline itself — a fire-and-forget insert here would race the
 * HTTP response, which already goes out once next.handle() emits.
 */
@Injectable()
export class AssistAuditInterceptor implements NestInterceptor {
  constructor(private readonly supabase: SupabaseService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();

    return next.handle().pipe(
      concatMap(async (data) => {
        if (!req.assistContext || !MUTATING_METHODS.has(req.method)) return data;
        const { superAdminUserId, targetSchoolId, accessGrantId } = req.assistContext;

        await this.supabase.admin.from('audit_logs').insert({
          id: randomUUID(),
          school_id: targetSchoolId,
          user_id: superAdminUserId,
          action: `assist.${req.method} ${req.route?.path ?? req.originalUrl}`,
          entity_type: 'assist_action',
          entity_id: null,
          metadata: { super_admin_user_id: superAdminUserId, target_school_id: targetSchoolId, access_grant_id: accessGrantId },
        });
        return data;
      }),
    );
  }
}
