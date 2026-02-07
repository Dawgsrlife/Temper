import { PrismaClient } from "@/prisma/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient(): PrismaClient | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("⚠️  DATABASE_URL not set. Database queries will fail.");
    console.error("   Set DATABASE_URL in .env.local");
    console.error(
      "   Example: postgresql://user:pass@localhost:5432/temper",
    );
    return null;
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  _prisma?: PrismaClient | null;
};

export const db = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (globalForPrisma._prisma === undefined) {
      globalForPrisma._prisma = createPrismaClient();
    }
    if (!globalForPrisma._prisma) {
      throw new Error(
        "DATABASE_URL not configured. Set it in .env.local to use database features.",
      );
    }
    return Reflect.get(globalForPrisma._prisma, prop);
  },
});
