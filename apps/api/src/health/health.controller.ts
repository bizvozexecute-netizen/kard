import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { type Response } from "express";
import { Public } from "../auth/decorators";
import { HealthService } from "./health.service";

@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** GET /v1/health → 200 если Postgres и Redis доступны, иначе 503 с деталями. */
  @Get()
  async get(@Res() res: Response): Promise<void> {
    const report = await this.health.check();
    res
      .status(report.status === "ok" ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(report);
  }
}
