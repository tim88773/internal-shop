const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '\u6b0a\u9650\u4e0d\u8db3');
    return res.redirect('/dashboard');
  }
  next();
}

// All available modules and actions
var MODULES = [
  { id: 'products', label: '\u5546\u54c1\u7ba1\u7406' },
  { id: 'orders', label: '\u8a02\u55ae\u7ba1\u7406' },
  { id: 'categories', label: '\u5206\u985e\u7ba1\u7406' },
  { id: 'members', label: '\u54e1\u5de5\u7ba1\u7406' },
  { id: 'permissions', label: '\u6b0a\u9650\u7ba1\u7406' }
];

var ACTIONS = [
  { id: 'create', label: '\u65b0\u589e' },
  { id: 'read', label: '\u67e5\u770b' },
  { id: 'update', label: '\u7de8\u8f2f' },
  { id: 'delete', label: '\u522a\u9664' }
];

// Helper to check if user has permission
function hasPermission(db, employeeId, module, action) {
  var user = db.prepare('SELECT role FROM employees WHERE id = ?').get(employeeId);
  if (user && user.role === 'admin') return true; // Admin has all permissions

  var row = db.prepare('SELECT granted FROM user_permissions WHERE employee_id = ? AND module = ? AND action = ?').get(employeeId, module, action);
  return row ? row.granted === 1 : false;
}

// List all employees and their permissions
router.get('/', requireAdmin, (req, res) => {
  const db = getDB();
  // Show all employees except admin
  const employees = db.prepare("SELECT id, username, display_name, email, store, role, points FROM employees ORDER BY role DESC, display_name ASC").all();

  var employeePermissions = {};
  for (var i = 0; i < employees.length; i++) {
    var emp = employees[i];
    var perms = db.prepare('SELECT * FROM user_permissions WHERE employee_id = ?').all(emp.id);
    if (emp.role === 'admin') {
      employeePermissions[emp.id] = 'all'; // Admin has all
    } else {
      var permMap = {};
      for (var j = 0; j < perms.length; j++) {
        var p = perms[j];
        if (!permMap[p.module]) permMap[p.module] = {};
        permMap[p.module][p.action] = p.granted === 1;
      }
      employeePermissions[emp.id] = permMap;
    }
  }

  res.render('permissions/index', { title: '\u6b0a\u9650\u7ba1\u7406', employees, modules: MODULES, actions: ACTIONS, employeePermissions: employeePermissions });
});

// Edit permissions for a specific employee
router.get('/:id/edit', requireAdmin, (req, res) => {
  const db = getDB();
  var eid = Number(req.params.id);
  const employee = db.prepare("SELECT id, username, display_name, email, store, role FROM employees WHERE id = ?").get(eid);
  if (!employee) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u54e1\u5de5');
    return res.redirect('/permissions');
  }
  if (employee.role === 'admin') {
    req.flash('error', '\u7ba1\u7406\u54e1\u5df2\u62e5\u6709\u6240\u6709\u6b0a\u9650\uff0c\u7121\u9700\u8a2d\u5b9a');
    return res.redirect('/permissions');
  }

  var currentPerms = db.prepare('SELECT * FROM user_permissions WHERE employee_id = ?').all(eid);
  var permMap = {};
  for (var i = 0; i < currentPerms.length; i++) {
    var p = currentPerms[i];
    if (!permMap[p.module]) permMap[p.module] = {};
    permMap[p.module][p.action] = p.granted === 1;
  }

  res.render('permissions/edit', { title: '\u7de8\u8f2f\u6b0a\u9650 - ' + employee.display_name, employee, modules: MODULES, actions: ACTIONS, currentPerms: permMap });
});

// Save permissions for an employee
router.post('/:id/edit', requireAdmin, (req, res) => {
  const db = getDB();
  var eid = Number(req.params.id);
  const employee = db.prepare("SELECT id, role FROM employees WHERE id = ?").get(eid);
  if (!employee) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u54e1\u5de5');
    return res.redirect('/permissions');
  }
  if (employee.role === 'admin') {
    req.flash('error', '\u7ba1\u7406\u54e1\u7121\u9700\u8a2d\u5b9a\u6b0a\u9650');
    return res.redirect('/permissions');
  }

  // Delete existing permissions for this employee
  db.raw.exec('DELETE FROM user_permissions WHERE employee_id = ?', [eid]);

  // Insert new permissions based on form data
  var insertPerm = db.prepare('INSERT INTO user_permissions (employee_id, module, action, granted) VALUES (?, ?, ?, ?)');

  for (var m = 0; m < MODULES.length; m++) {
    var mod = MODULES[m].id;
    for (var a = 0; a < ACTIONS.length; a++) {
      var act = ACTIONS[a].id;
      var fieldName = 'perm_' + mod + '_' + act;
      var granted = req.body[fieldName] === '1' ? 1 : 0;
      insertPerm.run(eid, mod, act, granted);
    }
  }

  req.flash('success', employee.display_name + ' \u7684\u6b0a\u9650\u5df2\u66f4\u65b0');
  res.redirect('/permissions');
});

module.exports = { router, hasPermission, MODULES, ACTIONS };
