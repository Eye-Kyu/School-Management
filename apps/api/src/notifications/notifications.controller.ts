import { Controller, Get, Patch, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken, CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get()
  list(@AccessToken() token: string) {
    return this.svc.list(token);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('read')
  markRead(@AccessToken() token: string, @Body() body: { ids?: string[] }) {
    return this.svc.markRead(token, body.ids ?? []);
  }

  @ApiOperation({ summary: 'Acknowledge an absence notification (marks it seen by parent)' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch(':id/acknowledge')
  acknowledge(@AccessToken() token: string, @Param('id') id: string) {
    return this.svc.acknowledge(token, id);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('test')
  sendTest(@AccessToken() token: string, @Body() body: { title?: string; message?: string }) {
    return this.svc.sendTest(token, body.title, body.message);
  }

  @ApiOperation({ summary: 'Email a report card link to the student\'s guardians' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Post('report-card-email')
  sendReportCardEmail(
    @CurrentUser() user: { id: string },
    @Body() body: { studentId: string; termId: string; reportCardUrl: string },
  ) {
    return this.svc.sendReportCardEmail(user.id, body.studentId, body.termId, body.reportCardUrl);
  }

  // Public — no AuthGuard; signature is verified inside the service
  @Get('unsubscribe')
  unsubscribe(@Query('token') token: string) {
    return this.svc.handleUnsubscribe(token);
  }
}
