import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  UpdateProfileInput,
  type UpdateProfileInput as UpdateProfileInputType,
} from '@school-manager/types';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch('me')
  updateMe(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(UpdateProfileInput)) input: UpdateProfileInputType,
  ) {
    return this.users.updateMe(token, user.id, input);
  }
}
