require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');

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
  secret: 'chuckflix-secret',
  resave: false,
  saveUninitialized: false
}));
// 404 Error Handler (add this at the end of your routes)

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
