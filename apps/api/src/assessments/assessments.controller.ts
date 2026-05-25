import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateAssessmentInput,
  UpsertScoresInput,
  type CreateAssessmentInput as CreateAssessmentInputType,
  type UpsertScoresInput as UpsertScoresInputType,
} from '@school-manager/types';
import { AssessmentsService } from './assessments.service';

@Controller('assessments')
@UseGuards(AuthGuard)
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Get('grades')
  getStudentGrades(
    @AccessToken() token: string,
    @Query('studentId') studentId: string,
    @Query('termId') termId?: string,
  ) {
    return this.assessments.getStudentGrades(token, studentId, termId);
  }

  @Get()
  list(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.assessments.list(token, user.id);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateAssessmentInput)) input: CreateAssessmentInputType,
  ) {
    return this.assessments.create(token, user.id, input);
  }

  @Get(':id/scores')
  getScores(
    @AccessToken() token: string,
    @Param('id') id: string,
  ) {
    return this.assessments.getScores(token, id);
  }

  @Post(':id/scores')
  upsertScores(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpsertScoresInput)) input: UpsertScoresInputType,
  ) {
    return this.assessments.upsertScores(token, id, input);
  }

  @Delete(':id')
  deleteAssessment(
    @AccessToken() token: string,
    @Param('id') id: string,
  ) {
    return this.assessments.deleteAssessment(token, id);
  }
}
