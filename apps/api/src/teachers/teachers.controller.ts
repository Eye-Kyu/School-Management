import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateTeacherInput, UpdateUserInput } from '@school-manager/types';
import { TeachersService } from './teachers.service';

@Controller('teachers')
@UseGuards(AuthGuard)
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.teachers.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateTeacherInput)) body: CreateTeacherInput,
  ) {
    return this.teachers.create(token, body);
  }

  @Patch(':id')
  update(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserInput)) body: UpdateUserInput,
  ) {
    return this.teachers.update(token, id, body);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.teachers.softDelete(token, id);
  }
}
