import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateStudentInput, UpdateUserInput } from '@school-manager/types';
import { StudentsService } from './students.service';

@Controller('students')
@UseGuards(AuthGuard)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.students.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateStudentInput)) body: CreateStudentInput,
  ) {
    return this.students.create(token, body);
  }

  @Patch(':id')
  update(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserInput)) body: UpdateUserInput,
  ) {
    return this.students.update(token, id, body);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.students.softDelete(token, id);
  }
}
