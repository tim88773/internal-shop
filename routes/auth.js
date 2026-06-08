const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/dashboard' : '/products');
  res.render('login', { title: 'Login' });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Please enter username and password');
    return res.redirect('/login');
  }

  const db = getDB();
  const user = db.prepare('SELECT * FROM employees WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    req.flash('error', 'Invalid username or password');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, store: user.store || '', role: user.role };
  req.flash('success', '歡迎回來，' + user.display_name + '！');
  var redirectUrl = (user.role === 'admin') ? '/dashboard' : '/products';
  res.redirect(redirectUrl);
});

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/dashboard' : '/products');
  res.render('register', { title: 'Register' });
});

router.post('/register', (req, res) => {
  const { username, password, confirm_password, display_name, email, store } = req.body;

  if (!username || !password || !display_name) {
    req.flash('error', 'Please fill all required fields');
    return res.redirect('/register');
  }
  if (password.length < 4) {
    req.flash('error', 'Password needs at least 4 characters');
    return res.redirect('/register');
  }
  if (password !== confirm_password) {
    req.flash('error', 'Passwords do not match');
    return res.redirect('/register');
  }

  const db = getDB();
  const exists = db.prepare('SELECT id FROM employees WHERE username = ?').get(username);
  if (exists) {
    req.flash('error', 'Username already taken');
    return res.redirect('/register');
  }

  if (!store) { req.flash('error', '請填寫隸屬門市'); return res.redirect('/register'); }
  const hashed = bcrypt.hashSync(password, 10);
  db.raw.exec('INSERT INTO employees (username, password, display_name, email, store, role) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashed, display_name, email || null, store, 'user']);

  req.flash('success', 'Registration successful, please login');
  res.redirect('/login');
});

router.get('/logout', (req, res) => {
  req.session.user = null;
  res.redirect('/login');
});

module.exports = router;
