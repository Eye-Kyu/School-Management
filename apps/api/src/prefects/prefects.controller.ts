import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AssignClassPrefectInput,
  AssignSchoolPrefectInput,
  RevokePrefectInput,
  SetPrefectPowerInput,
  SubmitBehaviorIncidentInput,
  ReviewBehaviorIncidentInput,
  SendPrefectMessageInput,
} from '@school-manager/types';
import { PrefectsService } from './prefects.service';

@Controller('prefects')
@UseGuards(AuthGuard)
export class PrefectsController {
  constructor(private readonly prefects: PrefectsService) {}

  @Get('me')
  myStatus(@AccessToken() token: string) {
    return this.prefects.myPrefectStatus(token);
  }

  @Get('class')
  listClassPrefects(@AccessToken() token: string) {
    return this.prefects.listClassPrefects(token);
  }

  @Post('class')
  assignClassPrefect(@AccessToken() token: string, @Body(new ZodValidationPipe(AssignClassPrefectInput)) body: AssignClassPrefectInput) {
    return this.prefects.assignClassPrefect(token, body);
  }

  @Post('class/:id/revoke')
  revokeClassPrefect(@AccessToken() token: string, @Param('id') id: string, @Body(new ZodValidationPipe(RevokePrefectInput)) body: RevokePrefectInput) {
    return this.prefects.revokeClassPrefect(token, id, body.reason);
  }

  @Post('class/change')
  changeClassPrefect(
    @AccessToken() token: string,
    @Body() body: { classId: string; studentId: string; termId: string | null; reason: string },
  ) {
    return this.prefects.changeClassPrefect(token, body.classId, body.studentId, body.termId, body.reason);
  }

  @Get('school')
  listSchoolPrefects(@AccessToken() token: string) {
    return this.prefects.listSchoolPrefects(token);
  }

  @Post('school')
  assignSchoolPrefect(@AccessToken() token: string, @Body(new ZodValidationPipe(AssignSchoolPrefectInput)) body: AssignSchoolPrefectInput) {
    return this.prefects.assignSchoolPrefect(token, body);
  }

  @Post('school/:id/revoke')
  revokeSchoolPrefect(@AccessToken() token: string, @Param('id') id: string, @Body(new ZodValidationPipe(RevokePrefectInput)) body: RevokePrefectInput) {
    return this.prefects.revokeSchoolPrefect(token, id, body.reason);
  }

  @Get('powers')
  listPowers(@AccessToken() token: string) {
    return this.prefects.listPrefectPowers(token);
  }

  @Patch('powers')
  setPower(@AccessToken() token: string, @Body(new ZodValidationPipe(SetPrefectPowerInput)) body: SetPrefectPowerInput) {
    return this.prefects.setPrefectPower(token, body);
  }

  @Post('behavior-incidents')
  submitIncident(@AccessToken() token: string, @Body(new ZodValidationPipe(SubmitBehaviorIncidentInput)) body: SubmitBehaviorIncidentInput) {
    return this.prefects.submitBehaviorIncident(token, body);
  }

  @Patch('behavior-incidents/:id')
  reviewIncident(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReviewBehaviorIncidentInput)) body: ReviewBehaviorIncidentInput,
  ) {
    return this.prefects.reviewBehaviorIncident(token, id, body);
  }

  @Post('message/class-teacher')
  messageClassTeacher(@AccessToken() token: string, @Body(new ZodValidationPipe(SendPrefectMessageInput)) body: SendPrefectMessageInput) {
    return this.prefects.sendPrefectMessage(token, 'CLASS_TEACHER', body);
  }

  @Post('message/admin')
  messageAdmin(@AccessToken() token: string, @Body(new ZodValidationPipe(SendPrefectMessageInput)) body: SendPrefectMessageInput) {
    return this.prefects.sendPrefectMessage(token, 'ADMIN', body);
  }
}
