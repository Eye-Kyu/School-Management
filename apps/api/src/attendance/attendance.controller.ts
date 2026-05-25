import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import {
  AccessToken,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  AttendanceQuery,
  AttendanceRosterQuery,
  MarkAttendanceInput,
  type AttendanceQuery as AttendanceQueryType,
  type AttendanceRosterQuery as AttendanceRosterQueryType,
  type MarkAttendanceInput as MarkAttendanceInputType,
} from '@school-manager/types';

import { AttendanceService } from './attendance.service';

@Controller('attendance')
@UseGuards(AuthGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  list(
    @AccessToken() token: string,
    @Query(new ZodValidationPipe(AttendanceQuery)) query: AttendanceQueryType,
  ) {
    return this.attendance.list(token, query);
  }

  @Get('export')
  exportCsv(
    @AccessToken() token: string,
    @Query('classId') classId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.attendance.exportCsv(token, { classId, dateFrom, dateTo });
  }

  @Get('roster')
  roster(
    @AccessToken() token: string,
    @Query(new ZodValidationPipe(AttendanceRosterQuery)) query: AttendanceRosterQueryType,
  ) {
    return this.attendance.roster(token, query);
  }

  @Post()
  mark(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(MarkAttendanceInput)) input: MarkAttendanceInputType,
  ) {
    return this.attendance.mark(token, user.id, input);
  }
}
