const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const { body, query, param, validationResult } = require('express-validator');
const { Server } = require('socket.io');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const dayjs = require('dayjs');
const { initDb, getPool, withTransaction } = require('./db');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const pool = getPool();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${uuid()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('???????????? ??? ?????'));
    }
  }
});

app.use(morgan('dev'));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadsDir, { maxAge: '1d' }));
app.use(express.static(path.join(process.cwd(), 'public')));

const USER_PALETTE = ['#ff8fab', '#ffb3c6', '#ff7aa2', '#ff4d6d', '#f72585', '#f48fb1', '#d946ef', '#fb7185'];

function pickAvatarColor() {
  return USER_PALETTE[Math.floor(Math.random() * USER_PALETTE.length)];
}

function tokenForUser(userId) {
  return jwt.sign({ id: userId }, config.jwtSecret, { expiresIn: '14d' });
}

function validationProblem(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: '?????? ?? ?????? ????????', errors: errors.array() });
  }
  return next();
}

async function getUserByUsername(username) {
  const [rows] = await pool.query(
    'SELECT id, username, password_hash, display_name, avatar_color, status_message, last_seen FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] || null;
}

async function getUserById(id) {
  const [rows] = await pool.query(
    'SELECT id, username, display_name, avatar_color, status_message, last_seen FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    statusMessage: row.status_message,
    lastSeen: row.last_seen
  };
}

function mapConversation(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    isPrivate: Boolean(row.is_private),
    creatorId: row.creator_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message ? JSON.parse(row.last_message) : null,
    unreadCount: row.unread_count ? Number(row.unread_count) : 0
  };
}

function mapAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: `/uploads/${row.stored_name}`,
    originalName: row.file_name,
    mimeType: row.mime_type,
    size: row.size
  };
}

function mapMessage(row, currentUserId) {
  const attachments = row.attachments ? JSON.parse(row.attachments) : [];
  const reactions = row.reactions ? JSON.parse(row.reactions) : [];
  return {
    id: row.id,
    conversationId: row.conversation_id,
    user: {
      id: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarColor: row.avatar_color
    },
    content: row.deleted_at ? null : row.content,
    attachments,
    parentId: row.parent_id,
    isEdited: Boolean(row.is_edited),
    createdAt: row.created_at,
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    reactions: reactions.map((reaction) => ({
      emoji: reaction.emoji,
      count: reaction.count,
      reacted: reaction.userIds.includes(currentUserId)
    }))
  };
}

async function fetchConversationMembers(conversationId) {
  const [rows] = await pool.query(
    `SELECT cm.user_id, cm.role, u.username, u.display_name, u.avatar_color, u.status_message, u.last_seen
     FROM conversation_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.conversation_id = ?
     ORDER BY u.display_name`,
    [conversationId]
  );
  return rows.map((row) => ({
    id: row.user_id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    statusMessage: row.status_message,
    role: row.role,
    lastSeen: row.last_seen
  }));
}

async function fetchConversationList(userId) {
  const [rows] = await pool.query(
    `SELECT c.*, json_object('id', m.id, 'content', m.content, 'createdAt', m.created_at, 'user', json_object('id', u.id, 'displayName', u.display_name, 'username', u.username)) AS last_message,
            IFNULL(uc.unread_count, 0) AS unread_count
     FROM conversations c
     JOIN conversation_members cm ON cm.conversation_id = c.id
     LEFT JOIN (
       SELECT m1.conversation_id, m1.id, m1.content, m1.created_at, m1.user_id
       FROM messages m1
       JOIN (
         SELECT conversation_id, MAX(created_at) AS created_at
         FROM messages
         GROUP BY conversation_id
       ) lm ON lm.conversation_id = m1.conversation_id AND lm.created_at = m1.created_at
     ) m ON m.conversation_id = c.id
     LEFT JOIN users u ON u.id = m.user_id
     LEFT JOIN (
       SELECT m.conversation_id,
              SUM(CASE WHEN cm.last_read_at IS NULL OR m.created_at > cm.last_read_at THEN 1 ELSE 0 END) AS unread_count
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
       GROUP BY m.conversation_id
     ) uc ON uc.conversation_id = c.id
     WHERE cm.user_id = ?
     ORDER BY c.updated_at DESC, c.id DESC`,
    [userId, userId]
  );

  return rows.map(mapConversation);
}

async function fetchConversationById(conversationId) {
  const [rows] = await pool.query('SELECT * FROM conversations WHERE id = ? LIMIT 1', [conversationId]);
  return rows[0] || null;
}

async function ensureMembership(conversationId, userId) {
  const [rows] = await pool.query(
    'SELECT role FROM conversation_members WHERE conversation_id = ? AND user_id = ? LIMIT 1',
    [conversationId, userId]
  );
  return rows[0] || null;
}

async function fetchMessageById(messageId, currentUserId) {
  const [rows] = await pool.query(
    `SELECT m.*, u.username, u.display_name, u.avatar_color,
            (
              SELECT JSON_ARRAYAGG(JSON_OBJECT('emoji', emoji, 'userIds', user_ids, 'count', cnt))
              FROM (
                SELECT emoji,
                       COUNT(*) AS cnt,
                       JSON_ARRAYAGG(user_id) AS user_ids
                FROM message_reactions
                WHERE message_id = m.id
                GROUP BY emoji
              ) r
            ) AS reactions
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = ?
     LIMIT 1`,
    [messageId]
  );
  return rows[0] ? mapMessage(rows[0], currentUserId) : null;
}

async function fetchMessages(conversationId, currentUserId, options = {}) {
  const limit = Math.min(Number(options.limit) || 30, 100);
  const beforeId = options.before ? Number(options.before) : null;
  const params = [conversationId];
  let condition = '';
  if (beforeId) {
    condition = 'AND m.id < ?';
    params.push(beforeId);
  }

  params.push(limit);

  const [rows] = await pool.query(
    `SELECT m.*, u.username, u.display_name, u.avatar_color,
            (
              SELECT JSON_ARRAYAGG(JSON_OBJECT('emoji', emoji, 'userIds', user_ids, 'count', cnt))
              FROM (
                SELECT emoji, COUNT(*) AS cnt, JSON_ARRAYAGG(user_id) AS user_ids
                FROM message_reactions
                WHERE message_id = m.id
                GROUP BY emoji
              ) r
            ) AS reactions
     FROM messages m
     JOIN users u ON u.id = m.user_id
     WHERE m.conversation_id = ? ${condition}
     ORDER BY m.id DESC
     LIMIT ?`,
    params
  );
  return rows.reverse().map((row) => mapMessage(row, currentUserId));
}

async function updateConversationTimestamp(conversationId) {
  await pool.query('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [conversationId]);
}

async function attachFiles(userId, attachmentIds = []) {
  if (!attachmentIds.length) return [];
  const [rows] = await pool.query(
    `SELECT * FROM attachments WHERE id IN (?) AND user_id = ?`,
    [attachmentIds, userId]
  );
  return rows.map(mapAttachment);
}

function emitToUser(userId, event, payload) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.forEach((socket) => {
    socket.emit(event, payload);
  });
}

async function emitConversationUpdate(conversationId, userIds = null) {
  let targets = userIds;
  if (!targets || !targets.length) {
    const members = await fetchConversationMembers(conversationId);
    targets = members.map((member) => member.id);
  }
  await Promise.all(
    targets.map(async (userId) => {
      const conversations = await fetchConversationList(userId);
      emitToUser(userId, 'conversation:list', conversations);
    })
  );
}

async function markConversationRead(conversationId, userId) {
  await pool.query(
    'UPDATE conversation_members SET last_read_at = GREATEST(COALESCE(last_read_at, 0), CURRENT_TIMESTAMP) WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
}

function authGuard(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: '????????? ???????????' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.auth = { id: payload.id };
    return next();
  } catch (error) {
    return res.status(401).json({ message: '???????? ??? ???????? ?????' });
  }
}

app.post(
  '/api/register',
  body('username').isLength({ min: 3, max: 32 }).matches(/^[a-zA-Z0-9_]+$/).withMessage('????????? ????????? ?????, ????? ? _'),
  body('password').isLength({ min: 6 }).withMessage('?????? ?????? ???? ?? ?????? 6 ????????'),
  validationProblem,
  async (req, res) => {
    try {
      const username = String(req.body.username).toLowerCase();
      const password = String(req.body.password);

      const existing = await getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: '????? ????? ??? ?????' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const avatarColor = pickAvatarColor();
      const displayName = username;

      const result = await pool.query(
        'INSERT INTO users (username, password_hash, display_name, avatar_color) VALUES (?, ?, ?, ?)',
        [username, passwordHash, displayName, avatarColor]
      );
      const userId = result[0].insertId;

      const [defaults] = await pool.query('SELECT id FROM conversations WHERE type = \'group\' ORDER BY id ASC LIMIT 1');
      if (defaults.length) {
        await pool.query(
          'INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
          [defaults[0].id, userId, 'member']
        );
      }

      const token = tokenForUser(userId);
      const user = await getUserById(userId);
      return res.status(201).json({ token, user: mapUser(user) });
    } catch (error) {
      console.error('Register error', error);
      return res.status(500).json({ message: '?? ??????? ??????? ???????' });
    }
  }
);

app.post(
  '/api/login',
  body('username').notEmpty(),
  body('password').notEmpty(),
  validationProblem,
  async (req, res) => {
    try {
      const username = String(req.body.username).toLowerCase();
      const password = String(req.body.password);

      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: '???????? ????? ??? ??????' });
      }

      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ message: '???????? ????? ??? ??????' });
      }

      const token = tokenForUser(user.id);
      return res.json({ token, user: mapUser(user) });
    } catch (error) {
      console.error('Login error', error);
      return res.status(500).json({ message: '?? ??????? ?????' });
    }
  }
);

app.get('/api/profile', authGuard, async (req, res) => {
  const user = await getUserById(req.auth.id);
  if (!user) {
    return res.status(404).json({ message: '???????????? ?? ??????' });
  }
  const conversations = await fetchConversationList(req.auth.id);
  return res.json({ user: mapUser(user), conversations });
});

app.put(
  '/api/profile',
  authGuard,
  body('displayName').optional().isLength({ min: 2, max: 60 }),
  body('statusMessage').optional().isLength({ max: 160 }),
  validationProblem,
  async (req, res) => {
    try {
      const updates = [];
      const params = [];
      if (req.body.displayName) {
        updates.push('display_name = ?');
        params.push(String(req.body.displayName));
      }
      if (typeof req.body.statusMessage === 'string') {
        updates.push('status_message = ?');
        params.push(String(req.body.statusMessage));
      }
      if (!updates.length) {
        return res.json({ user: mapUser(await getUserById(req.auth.id)) });
      }
      params.push(req.auth.id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
      const user = await getUserById(req.auth.id);
      emitToUser(req.auth.id, 'profile:update', mapUser(user));
      return res.json({ user: mapUser(user) });
    } catch (error) {
      console.error('Profile update error', error);
      return res.status(500).json({ message: '?? ??????? ???????? ???????' });
    }
  }
);

app.get(
  '/api/users/search',
  authGuard,
  query('q').isLength({ min: 1 }).withMessage('??????? ???? ?? ???? ??????'),
  validationProblem,
  async (req, res) => {
    const q = `%${req.query.q.trim()}%`;
    const [rows] = await pool.query(
      `SELECT id, username, display_name, avatar_color, status_message
       FROM users
       WHERE (username LIKE ? OR display_name LIKE ?)
         AND id != ?
       ORDER BY display_name ASC
       LIMIT 20`,
      [q, q, req.auth.id]
    );
    return res.json({ users: rows.map(mapUser) });
  }
);

app.get('/api/conversations', authGuard, async (req, res) => {
  const conversations = await fetchConversationList(req.auth.id);
  return res.json({ conversations });
});

app.post(
  '/api/conversations',
  authGuard,
  body('title').isLength({ min: 3, max: 100 }),
  body('description').optional().isLength({ max: 500 }),
  body('isPrivate').optional().isBoolean(),
  body('members').optional().isArray({ max: 20 }),
  validationProblem,
  async (req, res) => {
    const { title, description = '', isPrivate = false, members = [] } = req.body;
    try {
      const memberUsernames = Array.from(new Set(members.map((m) => String(m).toLowerCase())));
      const memberRows = memberUsernames.length
        ? await pool.query('SELECT id, username FROM users WHERE username IN (?)', [memberUsernames]).then(([rows]) => rows)
        : [];

      const memberIds = memberRows.map((row) => row.id).filter((id) => id !== req.auth.id);

      const conversationId = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          'INSERT INTO conversations (type, title, description, creator_id, is_private) VALUES (\'group\', ?, ?, ?, ?)',
          [title, description, req.auth.id, isPrivate ? 1 : 0]
        );
        const newConversationId = result.insertId;
        await conn.query(
          'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
          [newConversationId, req.auth.id, 'owner']
        );
        for (const memberId of memberIds) {
          await conn.query(
            'INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
            [newConversationId, memberId, 'member']
          );
        }
        return newConversationId;
      });

      await updateConversationTimestamp(conversationId);
      const conversation = await fetchConversationById(conversationId);
      const membersList = await fetchConversationMembers(conversationId);

      const targetIds = [req.auth.id, ...memberIds];
      emitConversationUpdate(conversationId, targetIds);
      targetIds.forEach((userId) => {
        emitToUser(userId, 'conversation:created', {
          conversation: { ...mapConversation(conversation), members: membersList }
        });
      });

      return res.status(201).json({
        conversation: { ...mapConversation(conversation), members: membersList }
      });
    } catch (error) {
      console.error('Create conversation error', error);
      return res.status(500).json({ message: '?? ??????? ??????? ??????' });
    }
  }
);

app.post(
  '/api/conversations/direct',
  authGuard,
  body('username').isLength({ min: 3 }),
  validationProblem,
  async (req, res) => {
    try {
      const username = String(req.body.username).toLowerCase();
      const user = await getUserByUsername(username);
      if (!user) {
        return res.status(404).json({ message: '???????????? ?? ??????' });
      }
      if (user.id === req.auth.id) {
        return res.status(400).json({ message: '?????? ?????? ?????? ? ????? ?????' });
      }

      const [existing] = await pool.query(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
         WHERE c.type = 'direct'
         LIMIT 1`,
        [req.auth.id, user.id]
      );

      let conversationId;
      if (existing.length) {
        conversationId = existing[0].id;
      } else {
        const [result] = await pool.query(
          'INSERT INTO conversations (type, title, description, creator_id, is_private) VALUES (\'direct\', ?, ?, ?, 1)',
          [
            `${req.auth.id}-${user.id}`,
            `?????? ${req.auth.id}-${user.id}`,
            req.auth.id
          ]
        );
        conversationId = result.insertId;
        await pool.query(
          'INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?), (?, ?, ?)',
          [conversationId, req.auth.id, 'owner', conversationId, user.id, 'member']
        );
      }

      const conversation = await fetchConversationById(conversationId);
      const membersList = await fetchConversationMembers(conversationId);
      const conversationPayload = { ...mapConversation(conversation), members: membersList };

      emitConversationUpdate(conversationId, [req.auth.id, user.id]);
      emitToUser(req.auth.id, 'conversation:created', { conversation: conversationPayload });
      emitToUser(user.id, 'conversation:created', { conversation: conversationPayload });

      return res.json({ conversation: conversationPayload });
    } catch (error) {
      console.error('Direct conversation error', error);
      return res.status(500).json({ message: '?? ??????? ??????? ??????' });
    }
  }
);

app.get(
  '/api/conversations/:id',
  authGuard,
  param('id').isInt(),
  validationProblem,
  async (req, res) => {
    const conversationId = Number(req.params.id);
    const membership = await ensureMembership(conversationId, req.auth.id);
    if (!membership) {
      return res.status(403).json({ message: '?????? ????????' });
    }
    const conversation = await fetchConversationById(conversationId);
    const members = await fetchConversationMembers(conversationId);
    return res.json({ conversation: { ...mapConversation(conversation), members } });
  }
);

app.post(
  '/api/conversations/:id/members',
  authGuard,
  param('id').isInt(),
  body('username').isLength({ min: 3 }),
  validationProblem,
  async (req, res) => {
    const conversationId = Number(req.params.id);
    const membership = await ensureMembership(conversationId, req.auth.id);
    if (!membership) {
      return res.status(403).json({ message: '?????? ????????' });
    }
    if (!['owner', 'admin'].includes(membership.role)) {
      return res.status(403).json({ message: '?????? ?????????????? ????? ??????????' });
    }
    const username = String(req.body.username).toLowerCase();
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ message: '???????????? ?? ??????' });
    }
    await pool.query(
      'INSERT IGNORE INTO conversation_members (conversation_id, user_id, role) VALUES (?, ?, ?)',
      [conversationId, user.id, 'member']
    );
    const members = await fetchConversationMembers(conversationId);
    emitConversationUpdate(conversationId, members.map((m) => m.id));
    emitToUser(user.id, 'conversation:member-added', {
      conversationId,
      members
    });
    return res.status(201).json({ members });
  }
);

app.delete(
  '/api/conversations/:id/members/:userId',
  authGuard,
  param('id').isInt(),
  param('userId').isInt(),
  validationProblem,
  async (req, res) => {
    const conversationId = Number(req.params.id);
    const targetUserId = Number(req.params.userId);
    const membership = await ensureMembership(conversationId, req.auth.id);
    if (!membership) {
      return res.status(403).json({ message: '?????? ????????' });
    }
    if (targetUserId !== req.auth.id && membership.role !== 'owner') {
      return res.status(403).json({ message: '?????? ???????? ?????? ????? ??????? ??????' });
    }
    await pool.query('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?', [conversationId, targetUserId]);
    const members = await fetchConversationMembers(conversationId);
    emitConversationUpdate(conversationId, members.map((m) => m.id));
    emitToUser(targetUserId, 'conversation:member-removed', { conversationId });
    return res.json({ members });
  }
);

app.get(
  '/api/conversations/:id/messages',
  authGuard,
  param('id').isInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isInt({ min: 1 }),
  validationProblem,
  async (req, res) => {
    const conversationId = Number(req.params.id);
    const membership = await ensureMembership(conversationId, req.auth.id);
    if (!membership) {
      return res.status(403).json({ message: '?????? ????????' });
    }
    const messages = await fetchMessages(conversationId, req.auth.id, {
      limit: req.query.limit,
      before: req.query.before
    });
    return res.json({ messages });
  }
);

app.post(
  '/api/conversations/:id/messages',
  authGuard,
  param('id').isInt(),
  body('content').optional().isLength({ max: 4000 }),
  body('attachments').optional().isArray({ max: 5 }),
  validationProblem,
  async (req, res) => {
    const conversationId = Number(req.params.id);
    const membership = await ensureMembership(conversationId, req.auth.id);
    if (!membership) {
      return res.status(403).json({ message: '?????? ????????' });
    }

    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    const attachmentIds = Array.isArray(req.body.attachments) ? req.body.attachments : [];

    if (!content && !attachmentIds.length) {
      return res.status(400).json({ message: '????????? ?? ????? ???? ??????' });
    }

    const attachments = await attachFiles(req.auth.id, attachmentIds);

    const [result] = await pool.query(
      'INSERT INTO messages (conversation_id, user_id, content, attachments) VALUES (?, ?, ?, ?)',
      [conversationId, req.auth.id, content || null, attachments.length ? JSON.stringify(attachments) : null]
    );
    const message = await fetchMessageById(result.insertId, req.auth.id);
    await updateConversationTimestamp(conversationId);
    emitConversationUpdate(conversationId, (await fetchConversationMembers(conversationId)).map((m) => m.id));
    io.to(`conversation:${conversationId}`).emit('message:created', message);
    return res.status(201).json({ message });
  }
);

app.put(
  '/api/messages/:id',
  authGuard,
  param('id').isInt(),
  body('content').isLength({ min: 1, max: 4000 }),
  validationProblem,
  async (req, res) => {
    const messageId = Number(req.params.id);
    const content = req.body.content.trim();
    const [rows] = await pool.query('SELECT conversation_id, user_id FROM messages WHERE id = ? LIMIT 1', [messageId]);
    if (!rows.length) {
      return res.status(404).json({ message: '????????? ?? ???????' });
    }
    const messageRow = rows[0];
    if (messageRow.user_id !== req.auth.id) {
      return res.status(403).json({ message: '????????????? ????? ?????? ???? ?????????' });
    }
    await pool.query('UPDATE messages SET content = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP WHERE id = ?', [content, messageId]);
    const message = await fetchMessageById(messageId, req.auth.id);
    io.to(`conversation:${messageRow.conversation_id}`).emit('message:updated', message);
    return res.json({ message });
  }
);

app.delete(
  '/api/messages/:id',
  authGuard,
  param('id').isInt(),
  validationProblem,
  async (req, res) => {
    const messageId = Number(req.params.id);
    const [rows] = await pool.query('SELECT conversation_id, user_id FROM messages WHERE id = ? LIMIT 1', [messageId]);
    if (!rows.length) {
      return res.status(404).json({ message: '????????? ?? ???????' });
    }
    const messageRow = rows[0];
    if (messageRow.user_id !== req.auth.id) {
      return res.status(403).json({ message: '??????? ????? ?????? ???? ?????????' });
    }
    await pool.query('UPDATE messages SET content = NULL, deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [messageId]);
    const message = await fetchMessageById(messageId, req.auth.id);
    io.to(`conversation:${messageRow.conversation_id}`).emit('message:deleted', message);
    return res.json({ message });
  }
);

app.post(
  '/api/messages/:id/reactions',
  authGuard,
  param('id').isInt(),
  body('emoji').isLength({ min: 1, max: 16 }),
  body('action').isIn(['add', 'remove']),
  validationProblem,
  async (req, res) => {
    const messageId = Number(req.params.id);
    const emoji = String(req.body.emoji);
    const action = req.body.action;

    const [rows] = await pool.query('SELECT conversation_id FROM messages WHERE id = ? LIMIT 1', [messageId]);
    if (!rows.length) {
      return res.status(404).json({ message: '????????? ?? ???????' });
    }
    const conversationId = rows[0].conversation_id;
    const membership = await ensureMembership(conversationId, req.auth.id);
    if (!membership) {
      return res.status(403).json({ message: '?????? ????????' });
    }

    if (action === 'add') {
      await pool.query(
        'REPLACE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
        [messageId, req.auth.id, emoji]
      );
    } else {
      await pool.query(
        'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [messageId, req.auth.id, emoji]
      );
    }

    const message = await fetchMessageById(messageId, req.auth.id);
    io.to(`conversation:${conversationId}`).emit('message:updated', message);
    return res.json({ message });
  }
);

app.post('/api/uploads', authGuard, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: '???? ?? ???????' });
  }
  try {
    const id = uuid();
    await pool.query(
      'INSERT INTO attachments (id, user_id, file_name, stored_name, mime_type, size) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.auth.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size]
    );
    return res.status(201).json({ attachment: mapAttachment({
      id,
      file_name: req.file.originalname,
      stored_name: req.file.filename,
      mime_type: req.file.mimetype,
      size: req.file.size
    }) });
  } catch (error) {
    console.error('Upload error', error);
    return res.status(500).json({ message: '?? ??????? ????????? ????' });
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  }
  return next();
});

const userSockets = new Map(); // userId => Set<Socket>

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Missing token'));
    }
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await getUserById(payload.id);
    if (!user) {
      return next(new Error('User not found'));
    }
    socket.data.user = mapUser(user);
    return next();
  } catch (error) {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', async (socket) => {
  const user = socket.data.user;
  if (!user) {
    socket.disconnect();
    return;
  }

  let sockets = userSockets.get(user.id);
  if (!sockets) {
    sockets = new Set();
    userSockets.set(user.id, sockets);
  }
  sockets.add(socket);

  if (sockets.size === 1) {
    io.emit('presence:update', { userId: user.id, status: 'online' });
  }

  const [conversationRows] = await pool.query(
    'SELECT conversation_id FROM conversation_members WHERE user_id = ?',
    [user.id]
  );
  const conversationIds = conversationRows.map((row) => row.conversation_id);
  socket.data.conversations = new Set(conversationIds);
  conversationIds.forEach((conversationId) => socket.join(`conversation:${conversationId}`));

  socket.emit('conversation:list', await fetchConversationList(user.id));

  socket.on('conversation:read', async ({ conversationId }) => {
    if (!socket.data.conversations.has(conversationId)) return;
    await markConversationRead(conversationId, user.id);
    emitConversationUpdate(conversationId, [user.id]);
  });

  socket.on('typing:start', async ({ conversationId }) => {
    if (!socket.data.conversations.has(conversationId)) return;
    socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId: user.id, isTyping: true });
  });

  socket.on('typing:stop', async ({ conversationId }) => {
    if (!socket.data.conversations.has(conversationId)) return;
    socket.to(`conversation:${conversationId}`).emit('typing:update', { conversationId, userId: user.id, isTyping: false });
  });

  socket.on('message:create', async (payload, ack) => {
    try {
      const conversationId = Number(payload?.conversationId);
      const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
      const attachmentIds = Array.isArray(payload?.attachments) ? payload.attachments : [];
      const parentId = payload?.parentId ? Number(payload.parentId) : null;

      if (!conversationId || !socket.data.conversations.has(conversationId)) {
        throw new Error('Conversation not joined');
      }

      if (!content && !attachmentIds.length) {
        throw new Error('????????? ?? ????? ???? ??????');
      }

      const attachments = await attachFiles(user.id, attachmentIds);

      const [result] = await pool.query(
        'INSERT INTO messages (conversation_id, user_id, content, attachments, parent_id) VALUES (?, ?, ?, ?, ?)',
        [conversationId, user.id, content || null, attachments.length ? JSON.stringify(attachments) : null, parentId]
      );
      const message = await fetchMessageById(result.insertId, user.id);
      await updateConversationTimestamp(conversationId);
      io.to(`conversation:${conversationId}`).emit('message:created', message);
      emitConversationUpdate(conversationId);
      if (ack) ack({ ok: true, message });
    } catch (error) {
      console.error('Socket message error', error);
      if (ack) ack({ ok: false, message: error.message || '?? ??????? ????????? ?????????' });
    }
  });

  socket.on('message:update', async ({ messageId, content }, ack) => {
    try {
      const message = await fetchMessageById(messageId, user.id);
      if (!message) throw new Error('not-found');
      if (message.user.id !== user.id) throw new Error('forbidden');
      await pool.query('UPDATE messages SET content = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP WHERE id = ?', [content.trim(), messageId]);
      const updated = await fetchMessageById(messageId, user.id);
      io.to(`conversation:${updated.conversationId}`).emit('message:updated', updated);
      if (ack) ack({ ok: true, message: updated });
    } catch (error) {
      if (ack) ack({ ok: false });
    }
  });

  socket.on('message:delete', async ({ messageId }, ack) => {
    try {
      const message = await fetchMessageById(messageId, user.id);
      if (!message) throw new Error('not-found');
      if (message.user.id !== user.id) throw new Error('forbidden');
      await pool.query('UPDATE messages SET content = NULL, deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [messageId]);
      const updated = await fetchMessageById(messageId, user.id);
      io.to(`conversation:${updated.conversationId}`).emit('message:deleted', updated);
      if (ack) ack({ ok: true });
    } catch (error) {
      if (ack) ack({ ok: false });
    }
  });

  socket.on('message:reaction', async ({ messageId, emoji, action }, ack) => {
    try {
      const message = await fetchMessageById(messageId, user.id);
      if (!message) throw new Error('not-found');
      const conversationId = message.conversationId;
      if (!socket.data.conversations.has(conversationId)) throw new Error('forbidden');
      if (action === 'remove') {
        await pool.query('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', [messageId, user.id, emoji]);
      } else {
        await pool.query('REPLACE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [messageId, user.id, emoji]);
      }
      const updated = await fetchMessageById(messageId, user.id);
      io.to(`conversation:${conversationId}`).emit('message:updated', updated);
      if (ack) ack({ ok: true, message: updated });
    } catch (error) {
      if (ack) ack({ ok: false });
    }
  });

  socket.on('disconnect', async () => {
    const socketsSet = userSockets.get(user.id);
    if (socketsSet) {
      socketsSet.delete(socket);
      if (!socketsSet.size) {
        userSockets.delete(user.id);
        await pool.query('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
        io.emit('presence:update', {
          userId: user.id,
          status: 'offline',
          lastSeen: dayjs().toISOString()
        });
      }
    }
  });
});

async function start() {
  try {
    await initDb();
    server.listen(config.port, () => {
      console.log(`Advanced pink messenger listening on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exit(1);
  }
}

start();
