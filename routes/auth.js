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
router.post('/signup', async (req, res) => {
    try {
        const { username, password, confirmPassword } = req.body;
        
        // Validation
        if (!username || !password || !confirmPassword) {
            return res.render('signup', { error: 'All fields are required' });
        }
        
        if (password !== confirmPassword) {
            return res.render('signup', { error: 'Passwords do not match' });
        }
        
        if (password.length < 6) {
            return res.render('signup', { error: 'Password must be at least 6 characters long' });
        }
        
        const existingUser = await User.findOne({ 
            $or: [{ username }] 
        });
        
        if (existingUser) {
            return res.render('signup', { 
                error: 'Username already exists' 
            });
        }
        
        // Create new user - FORCE viewer role (ignore any role input)
        const newUser = new User({
            username,
            password, // Will be hashed by the pre-save middleware
            role: 'viewer' // HARDCODED - never allow admin signup
        });
        
        await newUser.save();
        
        // Auto-login after successful signup
        req.session.user = {
            id: newUser._id,
            username: newUser.username,
            role: newUser.role // Will always be 'viewer'
        };
        
        // Always redirect to viewer dashboard
        res.redirect('/viewer/browse');
            
    } catch (error) {
        console.error('Signup error:', error);
        res.render('signup', { error: 'Registration failed. Please try again.' });
    }
});
module.exports = router;
