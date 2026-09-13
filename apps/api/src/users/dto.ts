import { patchMeSchema } from "@kadr/shared";
import { createZodDto } from "nestjs-zod";

export class PatchMeDto extends createZodDto(patchMeSchema) {}
