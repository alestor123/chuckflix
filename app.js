require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const ChuckflixTelegramBot = require('./bot/telegramBot');
const app = express();

// Database connection
mongoose.connect('mongodb://localhost:27017/chuckflix', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'chuckflix-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_BOT_TOKEN) {
  try {
    const telegramBot = new ChuckflixTelegramBot(TELEGRAM_BOT_TOKEN);
    console.log('🤖 Telegram bot initialized successfully');
    console.log('📱 Bot ready to receive videos, torrents, and URLs');
  } catch (error) {
    console.error('❌ Failed to initialize Telegram bot:', error.message);
  }
} else {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN not found in environment variables');
  console.warn('💡 Set TELEGRAM_BOT_TOKEN to enable automatic video downloads');
}


// About page route
app.get('/about', (req, res) => {
    res.render('about', { 
        user: req.session ? req.session.user : null 
    });
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/viewer', require('./routes/viewer'));
app.use(function(req, res, next) {
    res.status(404).render('404', { 
        user: req.session ? req.session.user : null 
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Chuckflix running on port ${PORT}`);
});
