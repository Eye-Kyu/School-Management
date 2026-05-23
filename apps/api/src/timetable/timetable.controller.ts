import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateTimetableSlotInput } from '@school-manager/types';
import { TimetableService } from './timetable.service';

@Controller('timetable')
@UseGuards(AuthGuard)
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  /** List slots — optionally filter by classId, teacherId, or day */
  @Get()
  list(
    @AccessToken() token: string,
    @Query('classId') classId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('day') day?: string,
  ) {
    return this.timetable.list(token, { classId, teacherId, day });
  }

  /** Today's slots for the current user (teacher → their classes, student/parent → their class) */
  @Get('today')
  today(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.timetable.today(token, user.id);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateTimetableSlotInput)) body: CreateTimetableSlotInput,
  ) {
    return this.timetable.create(token, body);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.timetable.remove(token, id);
  }
}
