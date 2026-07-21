import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { FeatureGuard } from '../common/guards/feature.guard';
import { RequireModule } from '../common/decorators/require-module.decorator';
import {
  CreateEventInput, type CreateEventInput as CreateEventInputType,
  UpdateEventInput, type UpdateEventInput as UpdateEventInputType,
} from '@school-manager/types';
import { EventsService } from './events.service';

@Controller('events')
@UseGuards(AuthGuard, FeatureGuard)
@RequireModule('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  list(@AccessToken() token: string) {
    return this.events.list(token);
  }

  @Get('ics')
  async exportIcs(@AccessToken() token: string, @Res() res: Response) {
    const ics = await this.events.exportIcs(token);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="school-events.ics"');
    res.send(ics);
  }

  @Post()
  create(
    @AccessToken() token: string,
    @CurrentUser() user: { id: string },
    @Body(new ZodValidationPipe(CreateEventInput)) input: CreateEventInputType,
  ) {
    return this.events.create(token, user.id, input);
  }

  @Patch(':id')
  update(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEventInput)) input: UpdateEventInputType,
  ) {
    return this.events.update(token, id, input);
  }

  @Delete(':id')
  remove(@AccessToken() token: string, @Param('id') id: string) {
    return this.events.remove(token, id);
  }
}
