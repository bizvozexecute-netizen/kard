import { Module } from "@nestjs/common";
import { CatalogCache } from "./catalog-cache";
import { CatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";

@Module({
  controllers: [CatalogController],
  providers: [CatalogCache, CatalogService],
  exports: [CatalogService, CatalogCache],
})
export class CatalogModule {}
