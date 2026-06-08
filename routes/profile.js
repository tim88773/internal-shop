const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

function reqAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

router.get('/', reqAuth, (req, res) => {
  const db = getDB();
  const user = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.user.id);
  if (!user) { req.flash('error', 'User not found'); return res.redirect('/dashboard'); }
  res.render('profile', { title: '會員資料', user });
});

router.post('/', reqAuth, (req, res) => {
  const db = getDB();
  const { display_name, email, store, password, confirm_password } = req.body;

  if (!display_name) { req.flash('error', '顯示名稱為必填'); return res.redirect('/profile'); }

  var updates = [];
  var params = [];

  updates.push('display_name = ?'); params.push(display_name);
  updates.push('email = ?'); params.push(email || null);
  updates.push('store = ?'); params.push(store || '');

  if (password) {
    if (password.length < 4) { req.flash('error', '密碼至少 4 碼'); return res.redirect('/profile'); }
    if (password !== confirm_password) { req.flash('error', '兩次密碼輸入不一致'); return res.redirect('/profile'); }
    updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10));
  }

  params.push(req.session.user.id);
  db.raw.exec('UPDATE employees SET ' + updates.join(', ') + ' WHERE id = ?', params);

  // Update session
  req.session.user.display_name = display_name;
  req.session.user.store = store || '';

  req.flash('success', '會員資料已更新');
  res.redirect('/profile');
});

module.exports = router;
