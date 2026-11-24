import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AccountEntity } from '../accounts/account.entity';
import { AccountRegistrationService } from '../accounts/account-registration.service';
import { LoginDto } from '../accounts/dto/login.dto';
import { RegisterDto } from '../accounts/dto/register.dto';
import { AllowDuringSetup } from './allow-during-setup.decorator';
import { AuthService } from './auth.service';
import { GoogleLoginDto } from './dto/google-login.dto';
import { GoogleIdTokenVerifier } from './google/google-id-token.verifier';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: AccountRegistrationService,
    private readonly google: GoogleIdTokenVerifier,
  ) {}

  /**
   * Public: anyone creates their own account. It can log in once an admin connects it to a
   * profile, so the answer is the account, not a token.
   */
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.registration.register(dto);
  }

  /** Public: the active gyms and gym subscriptions the register form offers. */
  @Get('register/options')
  registerOptions() {
    return this.registration.options();
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @ApiBody({ type: LoginDto }) // ✅ forces Swagger to show body fields
  login(@Body() _dto: LoginDto, @Req() req: Request & { user: AccountEntity }) {
    // _dto is not used because LocalAuthGuard authenticates and sets req.user
    return this.auth.login(req.user);
  }

  /**
   * Public: the OAuth client id of "Sign in with Google" (not a secret: Google shows it to the
   * browser anyway), or null while `GOOGLE_CLIENT_ID` isn't set, when the front shows no button.
   */
  @Get('google/config')
  googleConfig() {
    return { clientId: this.google.clientId() };
  }

  /**
   * Public: "Sign in with Google" into the existing account with the Google account's email
   * (Gmail or Google Workspace only). Never creates an account. Answers like `POST /auth/login`.
   */
  @Post('google')
  loginWithGoogle(@Body() dto: GoogleLoginDto) {
    return this.auth.loginWithGoogle(dto.credential);
  }

  @Get('me')
  @AllowDuringSetup()
  @ApiBearerAuth('jwt')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user: Record<string, unknown> }) {
    return req.user;
  }
}
