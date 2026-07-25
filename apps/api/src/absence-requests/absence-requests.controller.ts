import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  SubmitAbsenceRequestInput,
  ReviewAbsenceRequestInput,
  type SubmitAbsenceRequestInput as SubmitAbsenceRequestInputType,
  type ReviewAbsenceRequestInput as ReviewAbsenceRequestInputType,
} from '@school-manager/types';

import { AbsenceRequestsService } from './absence-requests.service';

@Controller('absence-requests')
@UseGuards(AuthGuard)
export class AbsenceRequestsController {
  constructor(private readonly absenceRequests: AbsenceRequestsService) {}

  @Post()
  submit(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(SubmitAbsenceRequestInput)) input: SubmitAbsenceRequestInputType,
  ) {
    return this.absenceRequests.submit(token, input);
  }

  @Get()
  list(@AccessToken() token: string) {
    return this.absenceRequests.list(token);
  }

  @Patch(':id')
  review(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewAbsenceRequestInput)) input: ReviewAbsenceRequestInputType,
  ) {
    return this.absenceRequests.review(token, id, input);
  }
}
