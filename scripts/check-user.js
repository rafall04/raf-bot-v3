const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/users.sqlite');

db.all("SELECT id, name, pppoe_username FROM users WHERE pppoe_username LIKE '%tes@%' OR pppoe_username LIKE '%hw%'", (err, rows) => {
    if (err) console.error(err);
    else console.log('Users with tes@ or hw:', rows);
    db.close();
});
