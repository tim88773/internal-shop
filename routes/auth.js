const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

// 若設定環境變數 INVITE_CODE，則員工註冊必須輸入相同的通行碼
function inviteCodeRequired() {
  return !!(process.env.INVITE_CODE && String(process.env.INVITE_CODE).trim());
}

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/dashboard' : '/products');
  res.render('login', { title: '登入' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', '請輸入帳號與密碼');
    return res.redirect('/login');
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM employees WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    req.flash('error', '帳號或密碼錯誤');
    return res.redirect('/login');
  }

  // 登入成功後更換 session 識別碼，避免 session fixation
  if (typeof req.sessionRegenerate === 'function') req.sessionRegenerate();

  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, store: user.store || '', role: user.role };
  req.flash('success', '歡迎回來，' + user.display_name + '！');
  var redirectUrl = (user.role === 'admin') ? '/dashboard' : '/products';
  res.redirect(redirectUrl);
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/dashboard' : '/products');
  res.render('register', { title: '員工註冊', inviteRequired: inviteCodeRequired() });
});

router.post('/register', (req, res) => {
  const { username, password, confirm_password, display_name, email, store, invite_code } = req.body;

  if (inviteCodeRequired()) {
    if (String(invite_code || '').trim() !== String(process.env.INVITE_CODE).trim()) {
      req.flash('error', '員工通行碼錯誤，請洽管理員');
      return res.redirect('/register');
    }
  }

  if (!username || !password || !display_name) {
    req.flash('error', '請填寫所有必填欄位');
    return res.redirect('/register');
  }
  if (password.length < 4) {
    req.flash('error', '密碼至少需要 4 個字元');
    return res.redirect('/register');
  }
  if (password !== confirm_password) {
    req.flash('error', '兩次輸入的密碼不一致');
    return res.redirect('/register');
  }

  const db = getDB();
  const exists = db.prepare('SELECT id FROM employees WHERE username = ?').get(username);
  if (exists) {
    req.flash('error', '此帳號已被使用');
    return res.redirect('/register');
  }

  if (!store) { req.flash('error', '請填寫隸屬門市'); return res.redirect('/register'); }
  const hashed = bcrypt.hashSync(password, 10);
  db.raw.exec('INSERT INTO employees (username, password, display_name, email, store, role) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashed, display_name, email || null, store, 'user']);

  req.flash('success', '註冊成功，請登入');
  res.redirect('/login');
});

router.get('/logout', (req, res) => {
  if (typeof req.sessionDestroy === 'function') {
    req.sessionDestroy();
  } else {
    req.session.user = null;
  }
  res.redirect('/login');
});

module.exports = router;