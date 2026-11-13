import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { config } from '../config';

/**
 * Dedicated limit of POST /subscriptions/checkout (each request sends a payment prompt), counted per
 * authenticated user: many farmers share one mobile operator NAT, so an IP count would block legitimate
 * payers. Falls back on the IP without a user. Runs as a route guard, after the global AuthGuard (req.user
 * is set), with its own throttler name; the global ThrottlerGuard is skipped on this route (@SkipThrottle).
 */
@Injectable()
export class CheckoutThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string }; ip?: string }>();
    const tracker = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip ?? ''}`;
    return this.handleRequest({
      context,
      limit: config().checkoutThrottleLimit,
      ttl: 60_000,
      blockDuration: 60_000,
      throttler: { name: 'checkout', limit: config().checkoutThrottleLimit, ttl: 60_000, ignoreUserAgents: [] },
      getTracker: async () => tracker,
      generateKey: (ctx, suffix, name) => this.generateKey(ctx, suffix, name),
    });
  }
}
