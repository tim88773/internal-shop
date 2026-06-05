var alasql = require('alasql');
var d = new alasql.Database();
d.exec("CREATE TABLE products (id INT, name STRING, is_active INT)");
d.exec("INSERT INTO products VALUES (1, 'test', 1)");

var sql = "SELECT COUNT(1) as c FROM products WHERE is_active = 1";
console.log("SQL:", sql);
var r = d.exec(sql);
console.log("Result:", JSON.stringify(r));

// Also test the subquery pattern
d.exec("CREATE TABLE orders (id INT, employee_id INT, status STRING)");
d.exec("INSERT INTO orders VALUES (1, 1, 'pending')");
d.exec("CREATE TABLE order_items (id INT, order_id INT, product_id INT, quantity INT, unit_price INT)");
d.exec("INSERT INTO order_items VALUES (1, 1, 1, 2, 10)");

var sql2 = "SELECT o.id, (SELECT COUNT(1) FROM order_items WHERE order_id = o.id) as items_count FROM orders o";
console.log("SQL2:", sql2);
var r2 = d.exec(sql2);
console.log("Result2:", JSON.stringify(r2));
