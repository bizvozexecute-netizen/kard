import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";
import type { AuthUser } from "./token.service";

export const IS_PUBLIC_KEY = "kadr:isPublic";

/** Ручка доступна без JWT (auth, health, вебхуки). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export type RequestWithUser = Request & { user?: AuthUser };

/** Текущий пользователь из JWT (устанавливается JwtAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<RequestWithUser>();
    if (!req.user) throw new Error("CurrentUser used on a route without JwtAuthGuard");
    return req.user;
  },
);
