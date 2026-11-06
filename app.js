const express = require('express');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { getDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = 'shop_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Session 有效期：7 天

// ── Session 儲存：持久化於 SQLite，Railway 重新部署後登入狀態不再遺失 ──
function parseSidFromCookie(raw) {
  var s = raw || '';
  var start = s.indexOf(COOKIE_NAME + '=');
  if (start < 0) return '';
  var valStart = start + COOKIE_NAME.length + 1;
  var valEnd = s.indexOf(';', valStart);
  if (valEnd < 0) valEnd = s.length;
  try { return decodeURIComponent(s.substring(valStart, valEnd).trim()); } catch (e) { return ''; }
}

function loadSession(sid) {
  if (!sid) return null;
  var db = getDB();
  var row = db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
    return null;
  }
  try { return JSON.parse(row.data); } catch (e) { return null; }
}

function saveSession(sid, data) {
  getDB().prepare('INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at')
    .run(sid, JSON.stringify(data), Date.now() + SESSION_TTL_MS);
}

function deleteSession(sid) {
  if (!sid) return;
  getDB().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
}

function cleanupExpiredSessions() {
  try {
    getDB().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  } catch (e) {
    console.error('[Session] 清理過期資料失敗:', e.message);
  }
}

function sidCookie(req, sid) {
  var c = COOKIE_NAME + '=' + encodeURIComponent(sid) + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + Math.floor(SESSION_TTL_MS / 1000);
  if (req.headers['x-forwarded-proto'] === 'https' || req.secure) c += '; Secure';
  return c;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Railway Volume：先確保上傳目錄存在，再掛載靜態路由
if (process.env.DATA_DIR) {
  var uploadsDir = path.join(process.env.DATA_DIR, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
}


// Session 中介層（SQLite 版，無 express-session）
app.use((req, res, next) => {
  var sid = parseSidFromCookie(req.headers.cookie);
  var session = loadSession(sid);
  if (!session) {
    sid = crypto.randomUUID();
    session = { _id: sid };
  }
  req.session = session;
  req.sessionId = sid;
  res.setHeader('Set-Cookie', sidCookie(req, sid));

  // 登入成功後更換 session 識別碼（防 session fixation）
  req.sessionRegenerate = function() {
    var oldSid = req.sessionId;
    var newSid = crypto.randomUUID();
    var data = req.session || {};
    data._id = newSid;
    req.session = data;
    req.sessionId = newSid;
    deleteSession(oldSid);
    saveSession(newSid, data);
    res.setHeader('Set-Cookie', sidCookie(req, newSid));
  };

  // 登出：刪除伺服器端 session
  req.sessionDestroy = function() {
    deleteSession(req.sessionId);
    req.session = { _id: crypto.randomUUID() };
    req.sessionId = req.session._id;
    res.setHeader('Set-Cookie', sidCookie(req, req.sessionId));
  };

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

  // 導覽列購物車數量徽章
  res.locals.cartCount = 0;
  if (req.session.user) {
    try {
      var cartSum = getDB().prepare('SELECT COALESCE(SUM(quantity), 0) as cnt FROM cart_items WHERE employee_id = ?').get(req.session.user.id);
      res.locals.cartCount = cartSum ? cartSum.cnt : 0;
    } catch (e) {
      res.locals.cartCount = 0;
    }
  }

  // 回應結束後寫入 / 清除 session
  var sessionSaved = false;
  res.on('finish', function() {
    if (sessionSaved) return;
    sessionSaved = true;
    try {
      var s = req.session;
      if (s && (s.user || s._flash)) saveSession(req.sessionId, s);
      else deleteSession(req.sessionId);
    } catch (e) {
      console.error('[Session] 寫入失敗:', e.message);
    }
  });
  next();
});

app.use('/', require('./routes/auth'));
app.use('/products', require('./routes/products'));
app.use('/inventory', require('./routes/inventory'));
app.use('/orders', require('./routes/orders'));
app.use('/categories', require('./routes/categories'));
app.use('/profile', require('./routes/profile'));
app.use('/members', require('./routes/members'));
app.use('/permissions', require('./routes/permissions').router);

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

  res.render('dashboard', { title: '儀表板', stats: { productCount: pc, activeOrders: ac, totalEmployees: te, lowStockCount: lc }, recentOrders: ro });
});

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/dashboard' : '/products');
  res.redirect('/login');
});

try { getDB(); console.log('[Shop] DB ready'); } catch (e) { console.error('[Shop] DB error:', e.message); process.exit(1); }

// 啟動時先清理一次過期 session，之後每小時清理
cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 60 * 60 * 1000).unref();

// 找不到路由
app.use((req, res) => {
  res.status(404).render('error', { title: '找不到頁面', statusCode: 404, message: '找不到您要瀏覽的頁面，請確認網址是否正確。' });
});

// 統一錯誤處理，避免將堆疊資訊暴露給使用者
app.use((err, req, res, next) => {
  console.error('[Server Error]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: '系統錯誤', statusCode: 500, message: '系統發生錯誤，請稍後再試或聯絡管理員。' });
});

app.listen(PORT, () => {
  console.log('[Internal Shop] Running at http://localhost:' + PORT);
});
