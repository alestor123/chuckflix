require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { connectDB, closeDB, dataDir } = require('./config/database');
const users = require('./repositories/userRepository');
const { securityMiddleware, csrfProtection } = require('./middleware/security');
const app = express();

app.set('trust proxy', 1);
connectDB();
const sessionMiddleware = require('./config/session');
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && !users.findByUsername(process.env.ADMIN_USERNAME)) {
  if (process.env.ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  users.create({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, role: 'admin' });
  console.log('[startup] Initial admin account created from environment configuration');
}
for (const directory of ['originals', 'transcoded', 'thumbnails', 'temp']) {
  fs.mkdirSync(path.join(dataDir, directory), { recursive: true, mode: 0o750 });
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/uploads', (_req, res) => res.sendStatus(404));
app.use(express.static('public'));
app.use(securityMiddleware);
app.set('view engine', 'ejs');
app.use(sessionMiddleware);
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});
app.use(csrfProtection);


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
app.use('/api', require('./routes/api'));
app.use('/health', require('./routes/health'));
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));
app.use(function(req, res, next) {
    res.status(404).render('404', { 
        user: req.session ? req.session.user : null 
    });
});

const PORT = process.env.PORT || 5000;
require('./services/transcodingService').resumePending();
const server = require.main === module
  ? app.listen(PORT, '0.0.0.0', () => {
    console.log(`Chuckflix ready on port ${PORT}`);
    if (process.env.SEED_DEMO === 'true') {
      require('./services/demoSeedService').seedDemoIfEmpty()
        .then((ids) => ids.length && console.log(`[demo-seed] Queued ${ids.length} synthetic videos`))
        .catch((error) => console.error(`[demo-seed] ${error.message}`));
    }
  })
  : null;

function shutdown() {
  if (!server) return;
  server.close(() => {
    sessionMiddleware.store.close?.();
    closeDB();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
