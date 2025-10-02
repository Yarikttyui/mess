const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: true,
      timezone: 'Z'
    });
  }
  return pool;
}

async function initDb() {
  const adminConnection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password
  });

  const safeDbName = config.db.database.replace(/`/g, '``');
  await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${safeDbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await adminConnection.end();

  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      avatar_color CHAR(7) NOT NULL,
      status_message VARCHAR(160) NOT NULL DEFAULT '' ,
      last_seen DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type ENUM('direct','group') NOT NULL DEFAULT 'group',
      title VARCHAR(100) NOT NULL,
      description TEXT NULL,
      creator_id INT NOT NULL,
      is_private TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_read_at DATETIME NULL,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      user_id INT NOT NULL,
      content TEXT NULL,
      attachments JSON NULL,
      parent_id BIGINT NULL,
      is_edited TINYINT(1) NOT NULL DEFAULT 0,
      edited_at DATETIME NULL,
      deleted_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE SET NULL,
      INDEX idx_messages_conversation_created_at (conversation_id, created_at DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id BIGINT NOT NULL,
      user_id INT NOT NULL,
      emoji VARCHAR(16) NOT NULL,
      reacted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (message_id, user_id, emoji),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id CHAR(36) PRIMARY KEY,
      user_id INT NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      size INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await ensureUploadsDir();
  await ensureSeedData();
}

async function ensureUploadsDir() {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

async function ensureSeedData() {
  const db = getPool();
  const [rows] = await db.query('SELECT id FROM conversations WHERE type = \'group\' AND title = ? LIMIT 1', ['Общий чат']);
  if (rows.length === 0) {
    // Create a placeholder technical user to own the default chat if needed
    const [systemUsers] = await db.query('SELECT id FROM users WHERE username = ? LIMIT 1', ['system']);
    let systemUserId;
    if (systemUsers.length === 0) {
      const [result] = await db.query(
        'INSERT INTO users (username, password_hash, display_name, avatar_color, status_message) VALUES (?, ?, ?, ?, ?)',
        ['system', '$2b$10$iuyLeiMlA9.tY9..pE2ljuAhVWDtvHya38RdcyMJ9ZpOhkSQs0JXO', 'Pink Bot', '#ff4d6d', '\\u0421\\u043c\\u043e\\0442\\u0440\\u044e \\u0437\\u0430 \\u0447\\u0430\\0442\\043e\\043c']
      );
      systemUserId = result.insertId;
    } else {
      systemUserId = systemUsers[0].id;
    }

    const [conversationResult] = await db.query(
      'INSERT INTO conversations (type, title, description, creator_id, is_private) VALUES (\'group\', ?, ?, ?, 0)',
      ['Общий чат', '\\u0413\\u043b\\u0430\\u0432\\u043d\\u0430\\u044f \\u043a\\u043e\\u043c\\u043d\\u0430\\0442\\0430 \\u043f\\u043e \\u0443\\u043c\\u043e\\043b\\0447\\0430\\043d\\0438\\044e \\u0434\\u043b\\044f \\u0432\\0441\\0435\\0445 \\u0443\\0447\\0430\\0441\\0442\\043d\\0438\\043a\\043e\\0432', systemUserId]
    );

    const conversationId = conversationResult.insertId;

    // System user becomes owner by default
    await db.query(
      'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
      [conversationId, systemUserId, 'owner']
    );
  }
}

async function withTransaction(work) {
  const db = getPool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { getPool, initDb, withTransaction };
