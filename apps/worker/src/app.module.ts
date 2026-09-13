import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module";
import { LedgerModule } from "./ledger.module";
import { LoggerModule } from "./logger.module";
import { ProvidersModule } from "./providers.module";
import { QueuesModule } from "./queues/queues.module";

@Module({
  imports: [ConfigModule.forRoot(), LoggerModule, LedgerModule, ProvidersModule, QueuesModule],
})
export class AppModule {}
