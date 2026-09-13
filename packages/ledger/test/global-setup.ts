import { createIntegrationGlobalSetup } from "@kadr/test-utils";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

export default createIntegrationGlobalSetup({ postgres: true, schema: "ledger_test" });
