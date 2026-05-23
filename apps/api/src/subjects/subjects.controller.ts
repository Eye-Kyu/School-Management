import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateSubjectInput, AssignSubjectInput } from '@school-manager/types';
import { SubjectsService } from './subjects.service';

@Controller('subjects')
@UseGuards(AuthGuard)
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.subjects.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateSubjectInput)) body: CreateSubjectInput,
  ) {
    return this.subjects.create(token, body);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.subjects.remove(token, id);
  }

  @Post('assignments')
  assign(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(AssignSubjectInput)) body: AssignSubjectInput,
  ) {
    return this.subjects.assign(token, body);
  }

  @Delete('assignments/:id')
  unassign(@AccessToken() token: string, @Param('id') id: string) {
    return this.subjects.unassign(token, id);
  }
}
