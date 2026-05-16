const path = require('path');
const fs = require('fs');

// Load env in same way as server.js
require('dotenv').config();
const localEnvPath = path.join(__dirname, '../../.env');
if (process.env.NODE_ENV !== 'production' && fs.existsSync(localEnvPath)) {
  require('dotenv').config({ path: localEnvPath });
}

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function main() {
  const email = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const phone = String(process.env.ADMIN_PHONE || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const firstName = String(process.env.ADMIN_FIRST_NAME || 'Admin').trim();
  const lastName = String(process.env.ADMIN_LAST_NAME || 'User').trim();

  if (!email) throw new Error('Missing ADMIN_EMAIL');
  if (!phone) throw new Error('Missing ADMIN_PHONE');
  if (!password || password.length < 6) throw new Error('Missing/invalid ADMIN_PASSWORD (min 6 chars)');

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('Missing MONGO_URI');

  await mongoose.connect(mongoUri);

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await User.findOne({ email });
  if (existing) {
    existing.role = 'admin';
    if (!existing.phone) existing.phone = phone;
    existing.firstName = existing.firstName || firstName;
    existing.lastName = existing.lastName || lastName;

    // Only set password if explicitly requested
    if (String(process.env.ADMIN_RESET_PASSWORD || '').toLowerCase() === 'true') {
      existing.passwordHash = passwordHash;
    }

    await existing.save();
    console.log(`Admin ensured for existing user: ${email} (ADMIN_RESET_PASSWORD=${process.env.ADMIN_RESET_PASSWORD || 'false'})`);
  } else {
    await User.create({
      email,
      phone,
      passwordHash,
      firstName,
      lastName,
      role: 'admin',
      emailVerified: true,
    });
    console.log(`Admin created: ${email}`);
  }

  await mongoose.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exit(1);
  });
