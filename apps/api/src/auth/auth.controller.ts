import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { SupabaseService } from '../supabase/supabase.service';
import { NotFoundException } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async me(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
  ) {
    const client = this.supabase.forUser(token);

    const { data, error } = await client
      .from('users')
      .select('id, school_id, email, phone, full_name, role')
      .eq('auth_id', user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('User profile not found');

    return {
      id: data.id,
      schoolId: data.school_id,
      email: data.email,
      phone: data.phone,
      fullName: data.full_name,
      role: data.role,
    };
  }
}
