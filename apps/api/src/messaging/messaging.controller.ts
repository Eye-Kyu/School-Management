import {
  Controller, Get, Post, Patch, Param, Body, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { MessagingService } from './messaging.service';
import { CreateConversationInput, SendMessageInput } from '@school-manager/types';

@UseGuards(AuthGuard)
@Controller('messaging')
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get('conversations')
  listConversations(@AccessToken() token: string) {
    return this.svc.listConversations(token);
  }

  @Post('conversations')
  createConversation(@AccessToken() token: string, @Body() body: unknown) {
    const input = CreateConversationInput.parse(body);
    return this.svc.getOrCreateConversation(token, input);
  }

  @Get('conversations/:id/messages')
  listMessages(@AccessToken() token: string, @Param('id') id: string) {
    return this.svc.listMessages(token, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(@AccessToken() token: string, @Param('id') id: string, @Body() body: unknown) {
    const input = SendMessageInput.parse(body);
    return this.svc.sendMessage(token, id, input);
  }

  @Patch('conversations/:id/read')
  markRead(@AccessToken() token: string, @Param('id') id: string) {
    return this.svc.markRead(token, id);
  }

  @Get('unread-count')
  async unreadCount(@AccessToken() token: string) {
    const count = await this.svc.unreadCount(token);
    return { count };
  }

  @Get('contacts')
  availableContacts(@AccessToken() token: string) {
    return this.svc.availableContacts(token);
  }
}
