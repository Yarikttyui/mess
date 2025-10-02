const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  port: process.env.PORT || 8000,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-env',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'YarikTop12',
    database: process.env.DB_NAME || 'pink_messenger'
  }
};

module.exports = config;

