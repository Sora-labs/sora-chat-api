import { Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FriendsService } from './friends.service';

@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private friendsService: FriendsService) {}

  @Get()
  list(@Req() req) {
    return this.friendsService.list(req.user.userId);
  }

  @Get(':friendId')
  getOne(@Req() req, @Param('friendId') friendId: string) {
    return this.friendsService.getOne(req.user.userId, friendId);
  }

  @Post(':friendId')
  add(@Req() req, @Param('friendId') friendId: string) {
    return this.friendsService.add(req.user.userId, friendId);
  }

  @Delete(':friendId')
  remove(@Req() req, @Param('friendId') friendId: string) {
    return this.friendsService.remove(req.user.userId, friendId);
  }
}