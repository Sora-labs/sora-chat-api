import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';

import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({
  connectionString: process.env.DIRECT_URL,
});

const prisma = new PrismaClient({
  adapter
});

async function main() {
  const soraId = process.env.SORA_USER_ID;
  if (!soraId) throw new Error('SORA_USER_ID not set in .env');

  await prisma.user.upsert({
    where: { id: soraId },
    update: {},
    create: {
      id: soraId,
      email: 'sora@internal.bot',
      username: 'sora',
      usernameSet: true,
      name: 'Sora',
      bio: 'Your friendly AI assistant, always here to help.',
      isBot: true,
    },
  });

  console.log('✓ Sora seeded:', soraId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());