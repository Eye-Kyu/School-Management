import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateStudentInput, UpdateUserInput, PromoteStudentsInput } from '@school-manager/types';
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

  @Post('promote')
  promote(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(PromoteStudentsInput)) body: PromoteStudentsInput,
  ) {
    return this.students.promote(token, user.id, body);
  }

  @Post('import')
  importCsv(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body() body: { csv: string },
  ) {
    if (typeof body.csv !== 'string' || !body.csv.trim()) {
      throw new Error('csv field is required');
    }
    return this.students.importCsv(token, user.id, body.csv);
  }

  @Get('nemis-export')
  nemisExport(@AccessToken() token: string, @Query('format') format?: string) {
    return this.students.nemisExport(token, format === 'xlsx' ? 'xlsx' : 'csv');
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
