import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UnauthorizedError } from "@kadr/shared";
import { IS_PUBLIC_KEY, type RequestWithUser } from "./decorators";
import { TokenService } from "./token.service";

/** Глобальный guard: всё закрыто, кроме @Public(). Кладёт req.user из access-токена. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new UnauthorizedError({ reason: "missing_token" });

    req.user = await this.tokens.verifyAccess(token);
    return true;
  }
}

function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value, ...rest] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value || rest.length > 0) return undefined;
  return value;
}
