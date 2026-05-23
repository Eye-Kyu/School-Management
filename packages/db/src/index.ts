// Re-export Prisma's client and types so consumers import from this package
// rather than @prisma/client directly. Lets us swap things later in one place.
export * from '@prisma/client';
export { PrismaClient } from '@prisma/client';
