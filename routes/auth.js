const express = require('express');
const users = require('../repositories/userRepository');
const { authRateLimiter } = require('../middleware/security');
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

router.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = users.findByUsername(username);
    
    if (user && await user.comparePassword(password)) {
      return req.session.regenerate((error) => {
        if (error) return res.render('login', { error: 'Login failed' });
        req.session.user = { id: user.id, username: user.username, role: user.role };
        req.session.save((saveError) => {
          if (saveError) return res.render('login', { error: 'Login failed' });
          return user.role === 'admin' ? res.redirect('/admin/dashboard') : res.redirect('/viewer/browse');
        });
      });
    }
    
    res.render('login', { error: 'Invalid credentials' });
  } catch (error) {
    res.render('login', { error: 'Login failed' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((error) => {
    if (error) return res.status(500).send('Logout failed');
    res.clearCookie('chuckflix.sid');
    res.redirect('/login');
  });
});
router.get('/signup', (req, res) => {
    // Redirect if already logged in
    if (req.session.user) {
        return req.session.user.role === 'admin' 
            ? res.redirect('/admin/dashboard')
            : res.redirect('/viewer/browse');
    }
    res.render('signup');
});

// Sign up form submission (VIEWER ONLY)
router.post('/signup', authRateLimiter, async (req, res) => {
    try {
        const { username, password, confirmPassword } = req.body;
        
        // Validation
        if (!username || !password || !confirmPassword) {
            return res.render('signup', { error: 'All fields are required' });
        }

        if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
          return res.render('signup', { error: 'Username must be 3-30 letters, numbers, underscores, or hyphens' });
        }
        
        if (password !== confirmPassword) {
            return res.render('signup', { error: 'Passwords do not match' });
        }
        
        if (password.length < 8 || password.length > 200) {
          return res.render('signup', { error: 'Password must be 8-200 characters long' });
        }
        
        const existingUser = users.findByUsername(username);
        
        if (existingUser) {
            return res.render('signup', { 
                error: 'Username already exists' 
            });
        }
        
        // Create new user - FORCE viewer role (ignore any role input)
        const newUser = users.create({ username, password, role: 'viewer' });
        
        // Auto-login after successful signup
        req.session.regenerate((error) => {
          if (error) return res.render('signup', { error: 'Registration failed. Please try again.' });
          req.session.user = { id: newUser.id, username: newUser.username, role: 'viewer' };
          req.session.save((saveError) => saveError
            ? res.render('signup', { error: 'Registration failed. Please try again.' })
            : res.redirect('/viewer/browse'));
        });
            
    } catch (error) {
        console.error('Signup error:', error);
        res.render('signup', { error: 'Registration failed. Please try again.' });
    }
});
module.exports = router;
