import { Injectable } from "@nestjs/common";
import type { Operation, Package } from "@kadr/db";
import type {
  CatalogOperationDto,
  CatalogResponse,
  PackageDto,
  PackagesResponse,
} from "@kadr/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CACHE_KEYS, CatalogCache } from "./catalog-cache";

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CatalogCache,
  ) {}

  getCatalog(): Promise<CatalogResponse> {
    return this.cache.getOrLoad(CACHE_KEYS.catalog, async () => {
      const operations = await this.prisma.operation.findMany({
        where: { isActive: true },
        orderBy: [{ sort: "asc" }, { key: "asc" }],
      });
      return { operations: operations.map(toOperationDto) };
    });
  }

  getPackages(): Promise<PackagesResponse> {
    return this.cache.getOrLoad(CACHE_KEYS.packages, async () => {
      const packages = await this.prisma.package.findMany({
        where: { isActive: true },
        orderBy: [{ sort: "asc" }, { priceRub: "asc" }],
      });
      return { packages: packages.map(toPackageDto) };
    });
  }
}

/** Публичный DTO: cogsUsdEst и providerChain намеренно не отдаются. */
export function toOperationDto(op: Operation): CatalogOperationDto {
  return {
    key: op.key,
    kind: op.kind,
    tier: op.tier,
    title: op.title,
    priceCredits: op.priceCredits,
    paramsSchema: (op.paramsSchema ?? {}) as Record<string, unknown>,
    etaSec: op.etaSec,
    sort: op.sort,
  };
}

export function toPackageDto(pkg: Package): PackageDto {
  return {
    id: pkg.id,
    priceRub: pkg.priceRub,
    credits: pkg.credits.toString(),
    bonusPct: pkg.bonusPct,
    badge: pkg.badge,
    sort: pkg.sort,
  };
}
