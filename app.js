const express = require('express');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { getDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = 'shop_sid';

// In-memory session store - synchronous and reliable
const sessions = {};

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// On Railway (DATA_DIR set), also serve uploaded images from the persistent volume
if (process.env.DATA_DIR) {
  var uploadsDir = path.join(process.env.DATA_DIR, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    app.use('/uploads', express.static(uploadsDir));
  }
}


// Simple session middleware (no express-session, no async issues)
app.use((req, res, next) => {
  var raw = req.headers.cookie || '';
  var sid = '';
  // Extract session ID from cookie
  var start = raw.indexOf(COOKIE_NAME + '=');
  if (start >= 0) {
    var valStart = start + COOKIE_NAME.length + 1;
    var valEnd = raw.indexOf(';', valStart);
    if (valEnd < 0) valEnd = raw.length;
    sid = raw.substring(valStart, valEnd).trim();
  }
  var session = sessions[sid];
  if (session) {
    req.session = session;
  } else {
    sid = crypto.randomUUID();
    sessions[sid] = { _id: sid };
    req.session = sessions[sid];
  }
  res.setHeader('Set-Cookie', COOKIE_NAME + '=' + sid + '; HttpOnly; Path=/');

  // Flash messages
  req.flash = function(type, msg) {
    if (msg) {
      if (!req.session._flash) req.session._flash = {};
      if (!req.session._flash[type]) req.session._flash[type] = [];
      req.session._flash[type].push(msg);
    } else {
      var r = req.session._flash && req.session._flash[type] ? req.session._flash[type].slice() : [];
      if (req.session._flash) delete req.session._flash[type];
      return r;
    }
  };

  // Locals for templates
  res.locals.path = req.path;
  res.locals.session = req.session;
  res.locals.currentUser = req.session.user || null;
  res.locals.error = req.flash('error');
  res.locals.success = req.flash('success');
  next();
});

app.use('/', require('./routes/auth'));
app.use('/products', require('./routes/products'));
app.use('/orders', require('./routes/orders'));
app.use('/categories', require('./routes/categories'));
app.use('/profile', require('./routes/profile'));
app.use('/members', require('./routes/members'));

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') return res.redirect('/products');
  const db = getDB();

  const pc = db.prepare("SELECT COUNT(1) as cnt FROM products WHERE is_active = 1").get();
  const ac = db.prepare("SELECT COUNT(1) as cnt FROM orders WHERE status != 'cancelled'").get();
  const te = db.prepare("SELECT COUNT(1) as cnt FROM employees").get();
  const lc = db.prepare("SELECT COUNT(1) as cnt FROM products WHERE is_active = 1 AND quantity <= 3").get();

  var ro;
  if (req.session.user.role === 'admin') {
    ro = db.prepare("SELECT o.id, o.created_at, o.status, e.display_name, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count FROM orders o JOIN employees e ON e.id = o.employee_id ORDER BY o.created_at DESC LIMIT 10").all();
  } else {
    ro = db.prepare("SELECT o.id, o.created_at, o.status, e.display_name, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count FROM orders o JOIN employees e ON e.id = o.employee_id WHERE o.employee_id = ? ORDER BY o.created_at DESC LIMIT 10").all(req.session.user.id);
  }

  res.render('dashboard', { title: 'Dashboard', stats: { productCount: pc, activeOrders: ac, totalEmployees: te, lowStockCount: lc }, recentOrders: ro });
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/dashboard' : '/products');
  res.redirect('/login');
});

try { getDB(); console.log('[Shop] DB ready'); } catch (e) { console.error('[Shop] DB error:', e.message); process.exit(1); }

app.listen(PORT, () => {
  console.log('[Internal Shop] Running at http://localhost:' + PORT);
});
