import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateDepartmentInput, UpdateDepartmentInput, SetDepartmentHeadInput } from '@school-manager/types';
import { DepartmentsService } from './departments.service';

@Controller('departments')
@UseGuards(AuthGuard)
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.departments.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateDepartmentInput)) body: CreateDepartmentInput,
  ) {
    return this.departments.create(token, body);
  }

  @Patch(':id')
  update(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateDepartmentInput)) body: UpdateDepartmentInput,
  ) {
    return this.departments.update(token, id, body);
  }

  @Patch(':id/head')
  setHead(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SetDepartmentHeadInput)) body: SetDepartmentHeadInput,
  ) {
    return this.departments.setHead(token, id, body.teacherUserId);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.departments.remove(token, id);
  }
}
