import { Global, Module } from "@nestjs/common";
import { LedgerService } from "@kadr/ledger";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [
    PrismaService,
    {
      provide: LedgerService,
      useFactory: (prisma: PrismaService) => new LedgerService(prisma),
      inject: [PrismaService],
    },
  ],
  exports: [PrismaService, LedgerService],
})
export class LedgerModule {}
