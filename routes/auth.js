const express = require('express');
const User = require('../models/User');
const router = express.Router();

// Home route
router.get('/', (req, res) => {
  if (req.session.user) {
    return req.session.user.role === 'admin' 
      ? res.redirect('/admin/dashboard')
      : res.redirect('/viewer/browse');
  }
  res.redirect('/login');
});

// Login routes
router.get('/login', (req, res) => {
  res.render('login');
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    
    if (user && await user.comparePassword(password)) {
      req.session.user = { id: user._id, username: user.username, role: user.role };
      return user.role === 'admin' 
        ? res.redirect('/admin/dashboard')
        : res.redirect('/viewer/browse');
    }
    
    res.render('login', { error: 'Invalid credentials' });
  } catch (error) {
    res.render('login', { error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;
