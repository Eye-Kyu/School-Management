import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateTermInput } from '@school-manager/types';

@Injectable()
export class TermsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('terms')
      .select('*')
      .order('start_date', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, input: CreateTermInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    // If this term is current, unset any existing current term first.
    if (input.isCurrent) {
      await client.from('terms').update({ is_current: false }).eq('school_id', school.id).eq('is_current', true);
    }

    const { data, error } = await client
      .from('terms')
      .insert({
        id: randomUUID(),
        school_id: school.id,
        name: input.name,
        start_date: input.startDate,
        end_date: input.endDate,
        is_current: input.isCurrent,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, school.id, 'term.create', 'term', data.id, { name: input.name });
    return data;
  }

  async setCurrent(accessToken: string, termId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(accessToken);

    const { data: term } = await client.from('terms').select('school_id').eq('id', termId).maybeSingle();
    if (!term) throw new NotFoundException('Term not found');

    // Clear existing current term for this school.
    await client.from('terms').update({ is_current: false }).eq('school_id', term.school_id).eq('is_current', true);

    const { data, error } = await client
      .from('terms')
      .update({ is_current: true })
      .eq('id', termId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    await this.audit(client, accessToken, term.school_id, 'term.set_current', 'term', termId, {});
    return data;
  }

  private async requireAdmin(accessToken: string) {
    const role = await this.supabase.getUserRole(accessToken);
    if (role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }

  private async audit(client: ReturnType<SupabaseService['forUser']>, accessToken: string, schoolId: string, action: string, entityType: string, entityId: string, metadata: unknown) {
    const me = await this.supabase.currentUserRow(accessToken, 'id') as { id: string } | null;
    await client.from('audit_logs').insert({ id: randomUUID(), school_id: schoolId, user_id: me?.id ?? null, action, entity_type: entityType, entity_id: entityId, metadata });
  }
}
