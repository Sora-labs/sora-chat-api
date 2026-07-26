import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@WebSocketGateway({ cors: { origin: '*' } }) // tighten origin in production
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server?: Server;
  private logger = new Logger('ChatGateway');

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string;
      if (!token) throw new Error('No token provided');

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });

      client.data.userId = payload.sub;
      this.logger.log(`Client connected: ${payload.sub}`);
    } catch (err: any) {
      this.logger.warn(`Rejected connection: ${err.message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.data?.userId ?? 'unknown'}`);
  }

  @SubscribeMessage('join_conversation')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    const userId = client.data.userId;
    const allowed = await this.chatService.isParticipant(data.conversationId, userId);
    if (!allowed) {
      client.emit('error', { message: 'Not a participant in this conversation' });
      return;
    }
    client.join(`conversation:${data.conversationId}`);
    client.emit('joined_conversation', { conversationId: data.conversationId });
  }

  @SubscribeMessage('leave_conversation')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { conversationId: string },
  ) {
    client.leave(`conversation:${data.conversationId}`);
  }

  @SubscribeMessage('send_message')
  async handleMessage(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    const dto = plainToInstance(SendMessageDto, body);
    const errors = await validate(dto);
    if (errors.length) {
      client.emit('error', { message: 'Invalid message payload' });
      return;
    }

    const userId = client.data.userId;

    try {
      const message = await this.chatService.createMessage(
        dto.conversationId,
        userId,
        dto.content,
      );
      this.server?.to(`conversation:${dto.conversationId}`).emit('new_message', message);
    } catch (err: any) {
      client.emit('error', { message: err.message ?? 'Failed to send message' });
    }
  }

  broadcastMessage(conversationId: string, message: unknown) {
    this.server?.to(`conversation:${conversationId}`).emit('new_message', message);
  }
}