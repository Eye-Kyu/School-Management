import { Module } from '@nestjs/common';
import { AssessmentsModule } from '../assessments/assessments.module';
import { QuizzesController } from './quizzes.controller';
import { QuizzesService } from './quizzes.service';

// First NestJS module for quizzes (Bucket 1, PR 2b) — quizzes otherwise stay
// entirely client-side/RLS-enforced (see docs/audits/homework-quiz-gradebook-relationship.md).
// This module is deliberately scoped to gradebook-linking only, not a
// general quiz backend — that's the deferred "full quiz backend migration"
// item in docs/phase-1/00-backlog.md.
@Module({
  imports: [AssessmentsModule],
  controllers: [QuizzesController],
  providers: [QuizzesService],
})
export class QuizzesModule {}
