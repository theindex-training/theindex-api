import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountRole } from '../../common/enums/account-role.enum';
import { Roles } from '../roles.decorator';
import { RolesGuard } from './roles.guard';

// Decorated like the real controllers: class-level roles, handler overrides.
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
class ClassRolesController {
  inherits() {}

  @Roles(AccountRole.TRAINEE)
  traineeOnly() {}
}

class NoRolesController {
  open() {}

  @Roles()
  emptyRoles() {}
}

function contextFor(
  controller: new () => object,
  handler: string,
  user?: { role: AccountRole },
): ExecutionContext {
  const req = user ? { user } : {};
  return {
    getHandler: () =>
      (controller.prototype as Record<string, () => void>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (AUTH-10)', () => {
  const guard = new RolesGuard(new Reflector());

  it('AUTH-10 allows any request when no roles are declared (or the list is empty)', () => {
    expect(guard.canActivate(contextFor(NoRolesController, 'open'))).toBe(true);
    expect(guard.canActivate(contextFor(NoRolesController, 'emptyRoles'))).toBe(
      true,
    );
  });

  it('AUTH-10 uses the class roles when the handler declares none', () => {
    const allowed = (role: AccountRole): unknown =>
      guard.canActivate(contextFor(ClassRolesController, 'inherits', { role }));

    expect(allowed(AccountRole.ADMIN)).toBe(true);
    expect(allowed(AccountRole.TRAINER)).toBe(true);
    expect(allowed(AccountRole.TRAINEE)).toBe(false);
  });

  it('AUTH-10 handler roles override (not extend) the class roles', () => {
    const allowed = (role: AccountRole): unknown =>
      guard.canActivate(
        contextFor(ClassRolesController, 'traineeOnly', { role }),
      );

    expect(allowed(AccountRole.TRAINEE)).toBe(true);
    expect(allowed(AccountRole.ADMIN)).toBe(false);
    expect(allowed(AccountRole.TRAINER)).toBe(false);
  });

  it('AUTH-10 denies (falsy) when roles are required and there is no req.user', () => {
    expect(
      guard.canActivate(contextFor(ClassRolesController, 'inherits')),
    ).toBeFalsy();
  });
});
