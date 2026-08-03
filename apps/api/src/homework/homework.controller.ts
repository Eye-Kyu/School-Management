import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CreateHomeworkInput, type CreateHomeworkInput as CreateHomeworkInputType,
  GradeHomeworkInput, type GradeHomeworkInput as GradeHomeworkInputType,
} from '@school-manager/types';
import { HomeworkService } from './homework.service';

@Controller('homework')
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('homework')
export class HomeworkController {
  constructor(private readonly homework: HomeworkService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.homework.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateHomeworkInput)) input: CreateHomeworkInputType,
  ) {
    return this.homework.create(token, user.id, input);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.homework.remove(token, id);
  }

  @Post(':id/complete')
  complete(@AccessToken() token: string, @Param('id') id: string) {
    return this.homework.complete(token, id);
  }

  @Delete(':id/complete')
  uncomplete(@AccessToken() token: string, @Param('id') id: string) {
    return this.homework.uncomplete(token, id);
  }

  @Patch(':homeworkId/submissions/:submissionId/grade')
  gradeSubmission(
    @AccessToken() token: string,
    @Param('homeworkId') homeworkId: string,
    @Param('submissionId') submissionId: string,
    @Body(new ZodValidationPipe(GradeHomeworkInput)) input: GradeHomeworkInputType,
  ) {
    return this.homework.gradeSubmission(token, homeworkId, submissionId, input);
  }
}
