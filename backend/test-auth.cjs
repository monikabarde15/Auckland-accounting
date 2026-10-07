const { PrismaClient } = require('@prisma/client');
const { signAccessToken } = require('./dist/utils/jwt.js');
const prisma = new PrismaClient();

async function run() {
  const u = await prisma.user.findFirst();
  const s = await prisma.session.create({data: {userId: u.id, expiresAt: new Date(Date.now() + 86400000)}});
  const token = signAccessToken(u, s.id);
  console.log("TOKEN:", token);
  
  // Test both endpoints!
  const res1 = await fetch('http://localhost:3000/api/calls?limit=3', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('GET /api/calls STATUS:', res1.status);
  
  const res2 = await fetch('http://localhost:3000/api/calls/cmuxt1hp50004d72dgrji49vu', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('GET /api/calls/:id STATUS:', res2.status);
}

run().catch(console.error).finally(()=>prisma.$disconnect());
