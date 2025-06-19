const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect('mongodb://localhost:27017/chuckflix');

async function createAdmin() {
  const admin = new User({
    username: 'admin',
    password: 'lol123',
    role: 'admin' // Change to 'admin' if you want to create an admin user
  });
  
  await admin.save();
  console.log('Admin user created');
  process.exit();
}

createAdmin();
