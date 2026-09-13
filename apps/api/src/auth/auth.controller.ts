import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { AuthResponse, AuthTokens } from "@kadr/shared";
import { AuthService } from "./auth.service";
import { Public } from "./decorators";
import { RefreshDto, TelegramMiniAppAuthDto, TelegramWidgetAuthDto } from "./dto";

/** Публичные ручки входа. Rate limit 10 запросов/мин с IP (ТЗ §5 п.8). */
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ auth: { limit: 10, ttl: 60_000 } })
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("telegram-mini-app")
  @HttpCode(HttpStatus.OK)
  telegramMiniApp(@Body() body: TelegramMiniAppAuthDto): Promise<AuthResponse> {
    return this.auth.loginMiniApp(body.initData);
  }

  @Post("telegram-widget")
  @HttpCode(HttpStatus.OK)
  telegramWidget(@Body() body: TelegramWidgetAuthDto): Promise<AuthResponse> {
    return this.auth.loginWidget(body);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }
}
