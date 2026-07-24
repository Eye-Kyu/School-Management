import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AssistScopeGuard } from '../common/guards/assist-scope.guard';
import { RequireAssistScope } from '../common/decorators/require-assist-scope.decorator';
import { CreateClassInput, UpdateClassInput } from '@school-manager/types';
import { ClassesService } from './classes.service';

@Controller('classes')
@UseGuards(AuthGuard)
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.classes.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateClassInput)) body: CreateClassInput,
  ) {
    return this.classes.create(token, body);
  }

  @Patch(':id')
  update(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateClassInput)) body: UpdateClassInput,
  ) {
    return this.classes.update(token, id, body);
  }

  @Patch(':id/prefect')
  setPrefect(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() body: { studentId: string | null },
  ) {
    return this.classes.setPrefect(token, user.id, id, body.studentId ?? null);
  }

  // The one write endpoint in this PR wired up for assist mode end-to-end —
  // see AssistScopeGuard and classes.service.ts's setClassTeacher() for the
  // pattern other admin-write endpoints should follow to become assist-aware.
  @UseGuards(AssistScopeGuard)
  @RequireAssistScope('ACADEMIC_DATA')
  @Patch(':id/class-teacher')
  setClassTeacher(
    @AccessToken() token: string,
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { teacherId: string | null },
  ) {
    return this.classes.setClassTeacher(token, id, body.teacherId ?? null, req.assistContext);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.classes.softDelete(token, id);
  }
}
