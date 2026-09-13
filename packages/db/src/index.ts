/**
 * Единственная точка импорта Prisma для api и worker.
 * Клиент генерируется командой `pnpm db:generate` (prisma generate) при сборке и установке.
 */
export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
