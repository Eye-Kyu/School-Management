import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateParentInput } from '@school-manager/types';
import { GuardiansService } from './guardians.service';

@Controller('guardians')
@UseGuards(AuthGuard)
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.guardians.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateParentInput)) body: CreateParentInput,
  ) {
    return this.guardians.create(token, body);
  }

  @Delete(':userId')
  remove(@AccessToken() token: string, @Param('userId') userId: string) {
    return this.guardians.remove(token, userId);
  }
}
