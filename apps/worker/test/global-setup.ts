import { createIntegrationGlobalSetup } from "@kadr/test-utils";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
    redisUrl: string;
  }
}

export default createIntegrationGlobalSetup({ postgres: true, redis: true, schema: "worker_test" });
