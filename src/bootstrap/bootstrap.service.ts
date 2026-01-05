import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { AccountEntity } from '../accounts/account.entity';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';

@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly log = new Logger(BootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AccountEntity)
    private readonly accounts: Repository<AccountEntity>,
  ) {}

  async onModuleInit() {
    const email = this.config.get<string>('SEED_ADMIN_EMAIL');
    const password = this.config.get<string>('SEED_ADMIN_PASSWORD');

    if (!email || !password) {
      this.log.warn(
        'SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD missing; skipping admin bootstrap.',
      );
      return;
    }

    const existing = await this.accounts.findOne({ where: { email } });

    if (existing) {
      // Admin already exists -> do nothing
      this.log.log(`✅ Admin account exists: ${email}`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const created = this.accounts.create({
      email,
      passwordHash,
      role: AccountRole.ADMIN,
      status: AccountStatus.ACTIVE,
      trainerProfileId: null,
      traineeProfileId: null,
    });

    await this.accounts.save(created);

    this.log.log(`✅ Admin account created: ${email}`);
  }
}
