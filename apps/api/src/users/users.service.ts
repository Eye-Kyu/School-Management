import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpdateProfileInput } from '@school-manager/types';

@Injectable()
export class UsersService {
  constructor(private readonly supabase: SupabaseService) {}

  async updateMe(accessToken: string, authUserId: string, input: UpdateProfileInput) {
    const client = this.supabase.forUser(accessToken);

    const { data, error } = await client
      .from('users')
      .update({
        full_name: input.fullName,
        phone: input.phone ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('auth_id', authUserId)
      .select('full_name, phone, email, role')
      .single();

    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
