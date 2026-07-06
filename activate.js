const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./inventory.db');

const username = process.argv[2];

if (!username) {
  console.log("Usage: node activate.js <username>");
  db.all('SELECT username, status, validity_date FROM users', [], (err, rows) => {
    if (!err && rows) {
      console.log('\nExisting users in database:');
      rows.forEach(r => console.log(`- Username: ${r.username} | Status: ${r.status} | Expiry: ${r.validity_date}`));
    }
    db.close();
  });
} else {
  db.run(
    "UPDATE users SET status = 'ACTIVE', validity_date = '2026-08-03' WHERE username = ?",
    [username],
    function(err) {
      if (err) {
        console.error("Error executing query:", err.message);
      } else if (this.changes === 0) {
        console.log(`No user found with username: "${username}"`);
      } else {
        console.log(`Successfully activated user "${username}" until 2026-08-03.`);
      }
      db.close();
    }
  );
}
