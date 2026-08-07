import { Body, Controller, Delete, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import { LinkToGradebookInput, type LinkToGradebookInput as LinkToGradebookInputType } from '@school-manager/types';
import { QuizzesService } from './quizzes.service';

@Controller('quizzes')
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('quizzes')
export class QuizzesController {
  constructor(private readonly quizzes: QuizzesService) {}

  @Post(':quizId/link-to-gradebook')
  linkToGradebook(
    @AccessToken() token: string,
    @Param('quizId') quizId: string,
    @Body(new ZodValidationPipe(LinkToGradebookInput)) input: LinkToGradebookInputType,
  ) {
    return this.quizzes.linkToGradebook(token, quizId, input);
  }

  @Delete(':quizId/link-to-gradebook')
  unlinkFromGradebook(@AccessToken() token: string, @Param('quizId') quizId: string) {
    return this.quizzes.unlinkFromGradebook(token, quizId);
  }
}
