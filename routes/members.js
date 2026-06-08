const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

function reqAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '權限不足');
    return res.redirect('/dashboard');
  }
  next();
}

// List all members
router.get('/', reqAdmin, (req, res) => {
  const db = getDB();
  const members = db.prepare("SELECT id, username, display_name, email, store, role, created_at FROM employees ORDER BY created_at DESC").all();
  res.render('members/index', { title: '會員管理', members });
});

// Edit member form
router.get('/:id/edit', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT id, username, display_name, email, store, role, created_at FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }
  res.render('members/edit', { title: '編輯會員', member });
});

// Update member
router.post('/:id/edit', reqAdmin, (req, res) => {
  const db = getDB();
  const member = db.prepare("SELECT * FROM employees WHERE id = ?").get(Number(req.params.id));
  if (!member) { req.flash('error', '找不到該會員'); return res.redirect('/members'); }

  const { display_name, email, store, password, confirm_password } = req.body;
  var updates = [];
  var params = [];

  if (display_name) { updates.push('display_name = ?'); params.push(display_name); }
  updates.push('email = ?'); params.push(email || null);
  updates.push('store = ?'); params.push(store || '');

  if (password) {
    if (password.length < 4) { req.flash('error', '密碼至少 4 碼'); return res.redirect('/members/' + member.id + '/edit'); }
    if (password !== confirm_password) { req.flash('error', '兩次密碼輸入不一致'); return res.redirect('/members/' + member.id + '/edit'); }
    updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10));
  }

  params.push(member.id);
  db.raw.exec('UPDATE employees SET ' + updates.join(', ') + ' WHERE id = ?', params);

  req.flash('success', '會員 ' + (display_name || member.display_name) + ' 已更新');
  res.redirect('/members');
});

module.exports = router;
