// =============================================================================
// @CurrentUser() - pull req.user out of the request in a controller method
// =============================================================================
// Usage:
//   @UseGuards(AuthGuard)
//   @Get('me')
//   me(@CurrentUser() user: AuthedUser) { return user; }
// =============================================================================

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from '../../auth/auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user;
  },
);

export const AccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.accessToken;
  },
);
