const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== 'admin') {
    req.flash('error', '\u6b0a\u9650\u4e0d\u8db3');
    return res.redirect('/products');
  }
  next();
}

// ---- Inventory listing ----

router.get('/', requireAdmin, (req, res) => {
  const db = getDB();
  const search = req.query.search || '';
  const categoryId = req.query.category || '';

  var products = db.prepare(`
    SELECT p.*, c.name as category_name,
      (SELECT COALESCE(SUM(quantity),0) FROM product_variants WHERE product_id = p.id) as variant_total
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE 1=1
  `).all();

  // Load variants for each product
  var allVariants = db.prepare('SELECT * FROM product_variants ORDER BY size, color').all();
  var variantMap = {};
  for (var i = 0; i < allVariants.length; i++) {
    var v = allVariants[i];
    if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
    variantMap[v.product_id].push(v);
  }

  // Attach variants to each product and count
  for (var j = 0; j < products.length; j++) {
    products[j].variants = variantMap[products[j].id] || [];
    products[j].variantCount = products[j].variants.length;
  }

  // Filter by search
  if (search) {
    var q = search.toLowerCase();
    products = products.filter(function(p) {
      return p.name.toLowerCase().indexOf(q) >= 0 ||
             (p.style_code && p.style_code.toLowerCase().indexOf(q) >= 0) ||
             (p.category_name && p.category_name.toLowerCase().indexOf(q) >= 0);
    });
  }

  // Filter by category
  if (categoryId) {
    products = products.filter(function(p) { return String(p.category_id) === String(categoryId); });
  }

  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  // Low-stock count
  var lowStockCount = db.prepare("SELECT COUNT(1) as cnt FROM products WHERE is_active = 1 AND quantity <= 3").get().cnt;

  res.render('inventory/index', {
    title: '\u5eab\u5b58\u7ba1\u7406',
    products: products,
    categories: categories,
    search: search,
    categoryId: categoryId,
    lowStockCount: lowStockCount
  });
});

// ---- Quick stock update for a variant ----

router.post('/update-variant', requireAdmin, (req, res) => {
  const db = getDB();
  var variantId = Number(req.body.variant_id);
  var newQty = parseInt(req.body.quantity) || 0;

  if (!variantId) {
    req.flash('error', '\u7121\u6548\u7684\u8b8a\u9ad4\u7de8\u865f');
    return res.redirect('/inventory');
  }

  if (newQty < 0) newQty = 0;

  // Update variant quantity
  db.raw.exec('UPDATE product_variants SET quantity = ? WHERE id = ?', [newQty, variantId]);

  // Recalculate total for the parent product
  var variant = db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(variantId);
  if (variant) {
    var total = db.prepare('SELECT COALESCE(SUM(quantity),0) as total FROM product_variants WHERE product_id = ?').get(variant.product_id);
    db.raw.exec('UPDATE products SET quantity = ? WHERE id = ?', [total.total, variant.product_id]);
    req.flash('success', '\u5eab\u5b58\u5df2\u66f4\u65b0\uff0c\u8a72\u5546\u54c1\u7e3d\u5eab\u5b58\uff1a' + total.total);
  } else {
    req.flash('success', '\u5eab\u5b58\u5df2\u66f4\u65b0');
  }

  res.redirect('/inventory');
});

// ---- Add a new variant row ----

router.post('/add-variant', requireAdmin, (req, res) => {
  const db = getDB();
  var productId = Number(req.body.product_id);
  var size = (req.body.size || '').trim();
  var color = (req.body.color || '').trim();
  var quantity = parseInt(req.body.quantity) || 0;

  if (!productId || !size || !color) {
    req.flash('error', '\u8acb\u586b\u5beb\u5b8c\u6574\u7684\u5c3a\u5bf8\u3001\u984f\u8272\u548c\u6578\u91cf');
    return res.redirect('/inventory');
  }

  if (quantity < 0) quantity = 0;

  try {
    db.raw.exec('INSERT INTO product_variants (product_id, size, color, quantity) VALUES (?, ?, ?, ?)', [productId, size, color, quantity]);
    // Recalculate total
    var total = db.prepare('SELECT COALESCE(SUM(quantity),0) as total FROM product_variants WHERE product_id = ?').get(productId);
    db.raw.exec('UPDATE products SET quantity = ? WHERE id = ?', [total.total, productId]);

    // Also update sizes/colors JSON arrays if not already present
    var product = db.prepare('SELECT sizes, colors FROM products WHERE id = ?').get(productId);
    var sizesArr = []; var colorsArr = [];
    try { sizesArr = JSON.parse(product.sizes || '[]'); } catch(e) {}
    try { colorsArr = JSON.parse(product.colors || '[]'); } catch(e) {}
    var changed = false;
    if (sizesArr.indexOf(size) === -1) { sizesArr.push(size); changed = true; }
    if (colorsArr.indexOf(color) === -1) { colorsArr.push(color); changed = true; }
    if (changed) {
      db.raw.exec('UPDATE products SET sizes = ?, colors = ? WHERE id = ?', [JSON.stringify(sizesArr), JSON.stringify(colorsArr), productId]);
    }

    req.flash('success', '\u5df2\u65b0\u589e\u5eab\u5b58\u8b8a\u9ad4\uff1a' + size + ', ' + color + ' = ' + quantity);
  } catch (e) {
    req.flash('error', '\u65b0\u589e\u5931\u6557\uff1a' + e.message);
  }

  res.redirect('/inventory');
});

// ---- Delete a variant ----

router.post('/delete-variant', requireAdmin, (req, res) => {
  const db = getDB();
  var variantId = Number(req.body.variant_id);

  if (!variantId) {
    req.flash('error', '\u7121\u6548\u7684\u8b8a\u9ad4\u7de8\u865f');
    return res.redirect('/inventory');
  }

  var variant = db.prepare('SELECT product_id, size, color FROM product_variants WHERE id = ?').get(variantId);
  if (!variant) {
    req.flash('error', '\u627e\u4e0d\u5230\u8a72\u8b8a\u9ad4');
    return res.redirect('/inventory');
  }

  db.raw.exec('DELETE FROM product_variants WHERE id = ?', [variantId]);

  // Recalculate total
  var total = db.prepare('SELECT COALESCE(SUM(quantity),0) as total FROM product_variants WHERE product_id = ?').get(variant.product_id);
  db.raw.exec('UPDATE products SET quantity = ? WHERE id = ?', [total.total, variant.product_id]);

  req.flash('success', '\u5df2\u522a\u9664\u5eab\u5b58\u8b8a\u9ad4\uff1a' + variant.size + ', ' + variant.color);
  res.redirect('/inventory');
});

// ---- Recalculate all product totals from variants ----

router.post('/recalc-all', requireAdmin, (req, res) => {
  const db = getDB();
  var products = db.prepare('SELECT id FROM products').all();
  var count = 0;
  for (var i = 0; i < products.length; i++) {
    var total = db.prepare('SELECT COALESCE(SUM(quantity),0) as total FROM product_variants WHERE product_id = ?').get(products[i].id);
    if (total.total > 0) {
      db.raw.exec('UPDATE products SET quantity = ? WHERE id = ?', [total.total, products[i].id]);
      count++;
    }
  }
  req.flash('success', '\u5df2\u91cd\u65b0\u8a08\u7b97 ' + count + ' \u500b\u5546\u54c1\u7684\u7e3d\u5eab\u5b58');
  res.redirect('/inventory');
});


// ---- Batch import inventory via textarea ----
router.post('/batch-import', requireAdmin, (req, res) => {
  const db = getDB();
  var raw = (req.body.data || '').trim();
  if (!raw) {
    req.flash('error', '請輸入庫存資料');
    return res.redirect('/inventory');
  }

  var lines = raw.split(/\r?\n/).filter(Boolean);
  var success = 0;
  var errors = [];

  for (var i = 0; i < lines.length; i++) {
    try {
      var parts = lines[i].split(',').map(function(s) { return s.trim(); });
      if (parts.length < 4) {
        errors.push('行 ' + (i+1) + ': 格式錯誤，需要 款式號碼, 尺寸, 顏色, 數量');
        continue;
      }
      var styleCode = parts[0];
      var size = parts[1];
      var color = parts[2];
      var qty = parseInt(parts[3]) || 0;

      if (qty < 0) qty = 0;

      // Find product by style_code
      var product = db.prepare('SELECT id, sizes, colors FROM products WHERE style_code = ?').get(styleCode);
      if (!product) {
        errors.push('行 ' + (i+1) + ': 找不到款式號碼「' + styleCode + '」');
        continue;
      }

      // Upsert variant
      var existing = db.prepare('SELECT id FROM product_variants WHERE product_id = ? AND size = ? AND color = ?').get(product.id, size, color);
      if (existing) {
        db.raw.exec('UPDATE product_variants SET quantity = ? WHERE id = ?', [qty, existing.id]);
      } else {
        db.raw.exec('INSERT INTO product_variants (product_id, size, color, quantity) VALUES (?, ?, ?, ?)', [product.id, size, color, qty]);
        // Update sizes/colors arrays
        var sizesArr = []; var colorsArr = [];
        try { sizesArr = JSON.parse(product.sizes || '[]'); } catch(e) {}
        try { colorsArr = JSON.parse(product.colors || '[]'); } catch(e) {}
        var changed = false;
        if (sizesArr.indexOf(size) === -1) { sizesArr.push(size); changed = true; }
        if (colorsArr.indexOf(color) === -1) { colorsArr.push(color); changed = true; }
        if (changed) {
          db.raw.exec('UPDATE products SET sizes = ?, colors = ? WHERE id = ?', [JSON.stringify(sizesArr), JSON.stringify(colorsArr), product.id]);
        }
      }
      success++;
    } catch (e) {
      errors.push('行 ' + (i+1) + ': ' + e.message);
    }
  }

  // Recalc totals for affected products
  var msg = '已更新 ' + success + ' 筆庫存';
  if (errors.length > 0) {
    msg += '，' + errors.length + ' 筆錯誤：' + errors.slice(0, 5).join('; ');
    req.flash('error', msg);
  } else {
    req.flash('success', msg);
  }

  // Recalc all totals
  var allProds = db.prepare('SELECT id FROM products').all();
  for (var j = 0; j < allProds.length; j++) {
    var total = db.prepare('SELECT COALESCE(SUM(quantity),0) as total FROM product_variants WHERE product_id = ?').get(allProds[j].id);
    if (total.total >= 0) {
      db.raw.exec('UPDATE products SET quantity = ? WHERE id = ?', [total.total, allProds[j].id]);
    }
  }

  res.redirect('/inventory');
});


// ---- Export inventory to Excel ----
router.get('/export', requireAdmin, (req, res) => {
  const db = getDB();
  const ExcelJS = require('exceljs');

  var workbook = new ExcelJS.Workbook();
  var sheet = workbook.addWorksheet('庫存明細');

  sheet.columns = [
    { header: '款式號碼', key: 'style_code', width: 16 },
    { header: '商品名稱', key: 'name', width: 28 },
    { header: '分類', key: 'category', width: 14 },
    { header: '尺寸', key: 'size', width: 12 },
    { header: '顏色', key: 'color', width: 14 },
    { header: '庫存數量', key: 'quantity', width: 14 },
    { header: '總庫存', key: 'total_qty', width: 14 },
    { header: '所屬門市', key: 'store', width: 14 },
  ];

  var headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC98686' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  var products = db.prepare('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.name').all();
  var allVariants = db.prepare('SELECT * FROM product_variants ORDER BY product_id, size, color').all();
  var variantMap = {};
  for (var i = 0; i < allVariants.length; i++) {
    var v = allVariants[i];
    if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
    variantMap[v.product_id].push(v);
  }

  for (var j = 0; j < products.length; j++) {
    var p = products[j];
    var variants = variantMap[p.id] || [];
    if (variants.length > 0) {
      for (var k = 0; k < variants.length; k++) {
        var v = variants[k];
        sheet.addRow({
          style_code: p.style_code || '',
          name: p.name,
          category: p.category_name || '',
          size: v.size,
          color: v.color,
          quantity: v.quantity,
          total_qty: p.quantity,
          store: p.store || ''
        });
      }
    } else {
      sheet.addRow({
        style_code: p.style_code || '',
        name: p.name,
        category: p.category_name || '',
        size: '-',
        color: '-',
        quantity: p.quantity,
        total_qty: p.quantity,
        store: p.store || ''
      });
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="inventory_export.xlsx"');

  workbook.xlsx.write(res).then(function() { res.end(); });
});

module.exports = router;
