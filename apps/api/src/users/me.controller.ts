import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from "@nestjs/common";
import type { DailyClaimResponse, MeDto } from "@kadr/shared";
import { CurrentUser } from "../auth/decorators";
import type { AuthUser } from "../auth/token.service";
import { DailyClaimService } from "./daily-claim.service";
import { PatchMeDto } from "./dto";
import { UsersService } from "./users.service";

@Controller("me")
export class MeController {
  constructor(
    private readonly users: UsersService,
    private readonly dailyClaim: DailyClaimService,
  ) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.users.getMe(user.id);
  }

  @Patch()
  patch(@CurrentUser() user: AuthUser, @Body() body: PatchMeDto): Promise<MeDto> {
    return this.users.patchMe(user.id, body);
  }

  @Post("daily-claim")
  @HttpCode(HttpStatus.OK)
  claim(@CurrentUser() user: AuthUser): Promise<DailyClaimResponse> {
    return this.dailyClaim.claim(user.id);
  }
}
