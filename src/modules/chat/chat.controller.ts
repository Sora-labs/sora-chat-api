import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { GetMessagesDto } from './dto/get-messages.dto';
import { ChatGateway } from './chat.gateway';
import { SupabaseService } from '../supabase/supabase.service';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ChatController {
  constructor(
    private chatService: ChatService,
    private chatGateway: ChatGateway,
    private supabase: SupabaseService,
    private config: ConfigService,
  ) {}

  @Get()
  list(@Req() req) {
    return this.chatService.listConversations(req.user.userId);
  }

  @Post()
  create(@Req() req, @Body() dto: CreateConversationDto) {
    return this.chatService.findOrCreateDirectConversation(req.user.userId, dto.participantId);
  }

  @Get(':id/messages')
  getMessages(@Req() req, @Param('id') id: string, @Query() query: GetMessagesDto) {
    return this.chatService.getMessages(id, req.user.userId, query.before, query.limit);
  }

  @Post(':id/media')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @Req() req,
    @Param('id') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('caption') caption?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    const allowed = await this.chatService.isParticipant(conversationId, req.user.userId);
    if (!allowed) throw new ForbiddenException('Not a participant in this conversation');

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only image files are supported at this time');
    }

    const maxBytes = Number(this.config.get('MEDIA_CAPACITY_PER_UPLOAD'));
    if (file.size > maxBytes) {
      throw new BadRequestException(
        `File exceeds the ${this.config.get('MEDIA_CAPACITY_PER_UPLOAD')} Bytes limit`,
      );
    }

    const mediaUrl = await this.supabase.uploadChatMedia(
      conversationId,
      file.buffer,
      file.mimetype,
    );

    const message = await this.chatService.createMediaMessage(
      conversationId,
      req.user.userId,
      mediaUrl,
      'image',
      file.size,
      caption,
    );

    this.chatGateway.broadcastMessage(conversationId, message);
    return message;
  }
}