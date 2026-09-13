import { Module } from "@nestjs/common";
import { GenerationWorker } from "./generation.worker";
import { LedgerReconcileWorker } from "./ledger-reconcile.worker";

@Module({
  providers: [GenerationWorker, LedgerReconcileWorker],
})
export class QueuesModule {}
