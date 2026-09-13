import { Module } from "@nestjs/common";
import { GenerationEventsService } from "./generation-events.service";
import { GenerationQueue } from "./generation-queue";
import { GenerationsController } from "./generations.controller";
import { GenerationsService } from "./generations.service";
import { ParamsValidator } from "./params-validator";

@Module({
  controllers: [GenerationsController],
  providers: [ParamsValidator, GenerationQueue, GenerationEventsService, GenerationsService],
  exports: [GenerationsService],
})
export class GenerationsModule {}
