import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CreateAnnouncementInput, type CreateAnnouncementInput as CreateAnnouncementInputType } from '@school-manager/types';
import { AnnouncementsService } from './announcements.service';

@Controller('announcements')
@UseGuards(AuthGuard)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.announcements.list(token);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateAnnouncementInput)) input: CreateAnnouncementInputType,
  ) {
    return this.announcements.create(token, user.id, input);
  }

  @Delete(':id')
  remove(
    @AccessToken() token: string,
    @Param('id') id: string,
  ) {
    return this.announcements.remove(token, id);
  }
}
