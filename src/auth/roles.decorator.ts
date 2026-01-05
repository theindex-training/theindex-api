import { SetMetadata } from '@nestjs/common';
import { AccountRole } from '../common/enums/account-role.enum';

export const Roles = (...roles: AccountRole[]) => SetMetadata('roles', roles);
