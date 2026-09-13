import { Module } from "@nestjs/common";
import { CLOCK, systemClock } from "./clock";
import { DailyClaimService } from "./daily-claim.service";
import { MeController } from "./me.controller";
import { UsersService } from "./users.service";

@Module({
  controllers: [MeController],
  providers: [{ provide: CLOCK, useValue: systemClock }, UsersService, DailyClaimService],
  exports: [UsersService, DailyClaimService, CLOCK],
})
export class UsersModule {}
