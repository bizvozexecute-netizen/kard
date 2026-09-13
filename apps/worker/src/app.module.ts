import { Module } from "@nestjs/common";
import { ConfigModule } from "./config.module";
import { LoggerModule } from "./logger.module";
import { QueuesModule } from "./queues/queues.module";

@Module({
  imports: [ConfigModule.forRoot(), LoggerModule, QueuesModule],
})
export class AppModule {}
