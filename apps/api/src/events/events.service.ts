import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateEventInput, UpdateEventInput } from '@school-manager/types';

@Injectable()
export class EventsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(accessToken: string) {
    const client = this.supabase.forUser(accessToken);
    const { data, error } = await client
      .from('events')
      .select('id, title, description, starts_at, ends_at, all_day, event_type, audience, target_grade_level, target_class_id, created_at')
      .order('starts_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(accessToken: string, authUserId: string, input: CreateEventInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { data: school } = await client.from('schools').select('id').single();
    if (!school) throw new ForbiddenException('No school found');

    const { data: userRow } = await client
      .from('users').select('id').eq('auth_id', authUserId).maybeSingle();

    const id = randomUUID();
    const now = new Date().toISOString();
    const { data, error } = await client
      .from('events')
      .insert({
        id,
        school_id: school.id,
        created_by_id: userRow?.id ?? null,
        title: input.title,
        description: input.description ?? null,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        all_day: input.allDay ?? false,
        event_type: input.eventType ?? 'GENERAL',
        audience: input.audience ?? 'SCHOOL_WIDE',
        target_grade_level: input.targetGradeLevel ?? null,
        target_class_id: input.targetClassId ?? null,
        updated_at: now,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);

    await client.from('audit_logs').insert({
      id: randomUUID(),
      school_id: school.id,
      user_id: userRow?.id ?? null,
      action: 'event.create',
      entity_type: 'event',
      entity_id: id,
      metadata: { title: input.title, event_type: input.eventType },
    });

    return data;
  }

  async update(accessToken: string, eventId: string, input: UpdateEventInput) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.startsAt !== undefined) patch.starts_at = input.startsAt;
    if (input.endsAt !== undefined) patch.ends_at = input.endsAt;
    if (input.allDay !== undefined) patch.all_day = input.allDay;
    if (input.eventType !== undefined) patch.event_type = input.eventType;
    if (input.audience !== undefined) patch.audience = input.audience;
    if (input.targetGradeLevel !== undefined) patch.target_grade_level = input.targetGradeLevel;
    if (input.targetClassId !== undefined) patch.target_class_id = input.targetClassId;

    const { data, error } = await client
      .from('events').update(patch).eq('id', eventId).select().single();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Event not found');
    return data;
  }

  async remove(accessToken: string, eventId: string) {
    const client = this.supabase.forUser(accessToken);
    await this.requireAdmin(client);

    const { error } = await client.from('events').delete().eq('id', eventId);
    if (error) throw new Error(error.message);
    return { deleted: true };
  }

  async exportIcs(accessToken: string): Promise<string> {
    const events = await this.list(accessToken);

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//School Manager//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:School Events',
    ];

    for (const ev of events) {
      const uid = `${ev.id}@schoolmanager.app`;
      const summary = ev.title.replace(/[\\;,]/g, (c: string) => `\\${c}`);
      const description = ev.description
        ? ev.description.replace(/[\\;,]/g, (c: string) => `\\${c}`).replace(/\n/g, '\\n')
        : '';

      let dtStart: string;
      let dtEnd: string;

      if (ev.all_day) {
        dtStart = `DTSTART;VALUE=DATE:${ev.starts_at.slice(0, 10).replace(/-/g, '')}`;
        // All-day end is exclusive — add 1 day
        const endDate = new Date(ev.ends_at);
        endDate.setDate(endDate.getDate() + 1);
        dtEnd = `DTEND;VALUE=DATE:${endDate.toISOString().slice(0, 10).replace(/-/g, '')}`;
      } else {
        dtStart = `DTSTART:${ev.starts_at.replace(/[-:]/g, '').replace('.000', '').replace(/\.\d{3}/, '')}`;
        dtEnd   = `DTEND:${ev.ends_at.replace(/[-:]/g, '').replace('.000', '').replace(/\.\d{3}/, '')}`;
      }

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        dtStart,
        dtEnd,
        `SUMMARY:${summary}`,
        ...(description ? [`DESCRIPTION:${description}`] : []),
        'END:VEVENT',
      );
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  private async requireAdmin(client: ReturnType<SupabaseService['forUser']>) {
    const { data } = await client.from('users').select('role').maybeSingle();
    if (data?.role !== 'ADMIN') throw new ForbiddenException('Admin role required');
  }
}
