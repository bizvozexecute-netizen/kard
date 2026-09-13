import { createGenerationSchema, listGenerationsQuerySchema } from "@kadr/shared";
import { createZodDto } from "nestjs-zod";

export class CreateGenerationDto extends createZodDto(createGenerationSchema) {}
export class ListGenerationsQueryDto extends createZodDto(listGenerationsQuerySchema) {}
