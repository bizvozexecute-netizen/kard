import { Global, Module } from "@nestjs/common";
import { LedgerService } from "@kadr/ledger";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Nest-обёртка над @kadr/ledger. Единственный способ менять баланс кредитов в api:
 * инжектируйте LedgerService, прямые запросы к credit_accounts запрещены.
 */
@Global()
@Module({
  providers: [
    {
      provide: LedgerService,
      useFactory: (prisma: PrismaService) => new LedgerService(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [LedgerService],
})
export class LedgerModule {}
