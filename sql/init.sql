CREATE DATABASE IF NOT EXISTS `pink_messenger`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE `pink_messenger`;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  avatar_color CHAR(7) NOT NULL,
  status_message VARCHAR(160) NOT NULL DEFAULT '',
  last_seen DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(16) NOT NULL,
  reacted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

INSERT INTO users (id, username, password_hash, display_name, avatar_color, status_message)
VALUES (1, 'system', '$2b$10$iuyLeiMlA9.tY9..pE2ljuAhVWDtvHya38RdcyMJ9ZpOhkSQs0JXO', 'Pink Bot', '#ff4d6d', 'Смотрю за чатом')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO conversations (id, type, title, description, creator_id, is_private)
VALUES (1, 'group', 'Общий чат', 'Главная комната по умолчанию для всех участников', 1, 0)
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO conversation_members (conversation_id, user_id, role)
VALUES (1, 1, 'owner')
ON DUPLICATE KEY UPDATE role = VALUES(role);
