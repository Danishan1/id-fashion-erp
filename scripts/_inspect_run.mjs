import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const projectId = "f3139b8a-aded-407b-9f8a-b3b8ff2a0729";
const runs = await prisma.aiGarmentDevelopmentBriefRun.findMany({ where: { projectId } });
for (const r of runs) {
  console.log(JSON.stringify({ id: r.id, status: r.status, errorCategory: r.errorCategory, errorMessage: r.errorMessage, model: r.model }, null, 2));
}
await prisma.$disconnect();
