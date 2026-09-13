import { Controller, Get } from "@nestjs/common";
import type { CatalogResponse, PackagesResponse } from "@kadr/shared";
import { Public } from "../auth/decorators";
import { CatalogService } from "./catalog.service";

/** Публичный каталог операций и пакетов. Ответы кэшируются в Redis на 60 с. */
@Public()
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("catalog")
  getCatalog(): Promise<CatalogResponse> {
    return this.catalog.getCatalog();
  }

  @Get("packages")
  getPackages(): Promise<PackagesResponse> {
    return this.catalog.getPackages();
  }
}
