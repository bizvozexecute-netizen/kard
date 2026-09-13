import { Module } from "@nestjs/common";
import { GenerationWorker } from "./generation.worker";

@Module({
  providers: [GenerationWorker],
})
export class QueuesModule {}
