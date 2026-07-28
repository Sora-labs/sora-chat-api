import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  Delete,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SearchUserDto } from './dto/search-user.dto';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  getMe(@Req() req) {
    return this.usersService.getMe(req.user.userId);
  }

  @Patch('me')
  updateProfile(@Req() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.userId, dto);
  }

  @Post('me/avatar')
  @UseInterceptors(FileInterceptor('file'))
  uploadAvatar(@Req() req, @UploadedFile() file: Express.Multer.File) {
    return this.usersService.uploadAvatar(req.user.userId, file);
  }

  @Get('search')
  search(@Req() req, @Query() query: SearchUserDto) {
    return this.usersService.search(req.user.userId, query.q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findPublicProfile(id);
  }

  @Delete('me')
  requestDeletion(@Req() req) {
    return this.usersService.requestAccountDeletion(req.user.userId);
  }

  @Post('me/cancel-deletion')
  cancelDeletion(@Req() req) {
    return this.usersService.cancelAccountDeletion(req.user.userId);
  }
}