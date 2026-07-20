import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const owner = await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: { email: "owner@example.com", name: "Demo Owner", passwordHash },
  });

  const editor = await prisma.user.upsert({
    where: { email: "editor@example.com" },
    update: {},
    create: { email: "editor@example.com", name: "Demo Editor", passwordHash },
  });

  const doc = await prisma.document.create({
    data: {
      title: "Welcome to Ledger",
      collaborators: {
        create: [
          { userId: owner.id, role: "OWNER" },
          { userId: editor.id, role: "EDITOR" },
        ],
      },
    },
  });

  console.log("Seeded:");
  console.log("  owner@example.com / password123");
  console.log("  editor@example.com / password123");
  console.log(`  document: ${doc.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
