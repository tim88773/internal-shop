const alasql = require('alasql');
const bcrypt = require('bcryptjs');

let db = null;

function wrapDB(rawDb) {
  const wrapped = {
    raw: rawDb,

    prepare(sql) {
      const adapter = {
        run(...params) {
          const p = params.length > 0 && Array.isArray(params[0]) ? params[0] : params;
          return rawDb.exec(sql, p.length > 0 ? p : undefined);
        },
        get(...params) {
          const rows = this.all(...params);
          return rows && rows.length > 0 ? rows[0] : undefined;
        },
        all(...params) {
          const p = params.length > 0 && Array.isArray(params[0]) ? params[0] : params;
          const result = rawDb.exec(sql, p.length > 0 ? p : undefined);
          return Array.isArray(result) ? result : [];
        }
      };
      return adapter;
    },

    run(sql, ...params) {
      const p = params.length > 0 && Array.isArray(params[0]) ? params[0] : params;
      return rawDb.exec(sql, p.length > 0 ? p : undefined);
    },

    exec(sql) {
      return rawDb.exec(sql);
    },

    transaction(fn) {
      return function (...args) {
        rawDb.exec('BEGIN TRANSACTION');
        try {
          const result = fn(...args);
          rawDb.exec('COMMIT');
          return result;
        } catch (e) {
          rawDb.exec('ROLLBACK');
          throw e;
        }
      };
    }
  };
  return wrapped;
}

function getDB() {
  if (!db) {
    db = wrapDB(new alasql.Database());

    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username STRING UNIQUE NOT NULL,
        password STRING NOT NULL,
        display_name STRING NOT NULL,
        email STRING,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name STRING NOT NULL,
        description STRING,
        price NUMBER NOT NULL,
        original_price NUMBER,
        category_id INTEGER,
        quantity INTEGER NOT NULL DEFAULT 0,
        defect_reason STRING,
        is_active INTEGER NOT NULL DEFAULT 1,
        image_url STRING,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `);
    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        status STRING NOT NULL DEFAULT 'pending',
        notes STRING,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
      )
    `);
    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price NUMBER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);

    // Default admin account
    const row = db.prepare('SELECT id FROM employees WHERE username = ?').get('admin');
    if (!row) {
      const hashed = bcrypt.hashSync('admin123', 10);
      db.raw.exec('INSERT INTO employees (username, password, display_name) VALUES (?, ?, ?)',
        ['admin', hashed, '管理员']);
    }
  }
  return db;
}

module.exports = { getDB };
