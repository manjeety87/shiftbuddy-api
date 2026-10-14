const { PrismaClient } = require('@prisma/client');
const env = require('./env');

// Poore app ke liye ek hi shared Prisma instance.
// Har request pe naya PrismaClient banane se DB connections khatam ho jaate hain.
const prisma = new PrismaClient({
  log: env.isDevelopment ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
