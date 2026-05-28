import {
  Controller, Get, Post, Patch, Param, Body, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MessagingService } from './messaging.service';
import { CreateConversationInput, SendMessageInput } from '@school-manager/types';

@UseGuards(AuthGuard)
@Controller('messaging')
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get('conversations')
  listConversations(@Req() req: any) {
    return this.svc.listConversations(req.accessToken);
  }

  @Post('conversations')
  createConversation(@Req() req: any, @Body() body: unknown) {
    const input = CreateConversationInput.parse(body);
    return this.svc.getOrCreateConversation(req.accessToken, input);
  }

  @Get('conversations/:id/messages')
  listMessages(@Req() req: any, @Param('id') id: string) {
    return this.svc.listMessages(req.accessToken, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(@Req() req: any, @Param('id') id: string, @Body() body: unknown) {
    const input = SendMessageInput.parse(body);
    return this.svc.sendMessage(req.accessToken, id, input);
  }

  @Patch('conversations/:id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.svc.markRead(req.accessToken, id);
  }

  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const count = await this.svc.unreadCount(req.accessToken);
    return { count };
  }

  @Get('contacts')
  availableContacts(@Req() req: any) {
    return this.svc.availableContacts(req.accessToken);
  }
}
