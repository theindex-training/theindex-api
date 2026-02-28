import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AccountsService } from '../accounts/accounts.service';
import { AccountStatus } from '../common/enums/account-status.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const acc = await this.accounts.findByEmail(email);
    if (!acc) throw new UnauthorizedException('Invalid credentials');

    if (acc.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is not active (${acc.status})`);
    }

    if (!acc.passwordHash)
      throw new UnauthorizedException('Account has no password set');

    const ok = await bcrypt.compare(password, acc.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return acc;
  }

  async login(acc: any) {
    const payload = {
      sub: acc.id,
      email: acc.email,
      role: acc.role,
      trainerProfileId: acc.trainerProfileId ?? null,
      traineeProfileId: acc.traineeProfileId ?? null,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      account: this.accounts.sanitize(acc),
    };
  }
}
