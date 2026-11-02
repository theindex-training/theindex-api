import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AccountEntity } from '../accounts/account.entity';
import { LoginDto } from '../accounts/dto/login.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @ApiBody({ type: LoginDto }) // ✅ forces Swagger to show body fields
  login(@Body() _dto: LoginDto, @Req() req: Request & { user: AccountEntity }) {
    // _dto is not used because LocalAuthGuard authenticates and sets req.user
    return this.auth.login(req.user);
  }

  @Get('me')
  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user: Record<string, unknown> }) {
    return req.user;
  }
}
