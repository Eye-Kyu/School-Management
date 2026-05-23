import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateTermInput } from '@school-manager/types';
import { TermsService } from './terms.service';

@Controller('terms')
@UseGuards(AuthGuard)
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.terms.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateTermInput)) body: CreateTermInput,
  ) {
    return this.terms.create(token, body);
  }

  @Patch(':id/set-current')
  setCurrent(@AccessToken() token: string, @Param('id') id: string) {
    return this.terms.setCurrent(token, id);
  }
}
