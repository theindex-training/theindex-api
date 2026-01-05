import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountRole } from '../../common/enums/account-role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<AccountRole[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!roles || roles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user;

    return user && roles.includes(user.role);
  }
}
