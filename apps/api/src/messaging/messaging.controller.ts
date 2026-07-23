import {
  Controller, Get, Post, Patch, Param, Body, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AccessToken } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { MessagingService } from './messaging.service';
import {
  CreateConversationInput, SendMessageInput, BroadcastToClassInput,
  type CreateConversationInput as CreateConversationInputType,
  type SendMessageInput as SendMessageInputType,
  type BroadcastToClassInput as BroadcastToClassInputType,
} from '@school-manager/types';

@UseGuards(AuthGuard)
@Controller('messaging')
export class MessagingController {
  constructor(private readonly svc: MessagingService) {}

  @Get('conversations')
  listConversations(@AccessToken() token: string) {
    return this.svc.listConversations(token);
  }

  @Post('conversations')
  createConversation(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(CreateConversationInput)) input: CreateConversationInputType,
  ) {
    return this.svc.getOrCreateConversation(token, input);
  }

  @Get('conversations/:id/messages')
  listMessages(@AccessToken() token: string, @Param('id') id: string) {
    return this.svc.listMessages(token, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @AccessToken() token: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendMessageInput)) input: SendMessageInputType,
  ) {
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

  @Post('broadcast')
  broadcastToClass(
    @AccessToken() token: string,
    @Body(new ZodValidationPipe(BroadcastToClassInput)) input: BroadcastToClassInputType,
  ) {
    return this.svc.broadcastToClass(token, input);
  }
}
