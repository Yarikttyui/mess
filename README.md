# Pink Messenger

Simple realtime chat (VK-inspired) with a MySQL backend and a rosy UI.

## Quick start

1. Install dependencies (already done in repo):
   ```bash
   npm install
   ```
2. Create database and tables. Either run `sql/init.sql` in your MySQL client or execute:
   ```bash
   mysql -u root -p < sql/init.sql
   ```
   Use the password `YarikTop12` when prompted, or adjust the credentials in `.env`.
3. Copy the sample environment:
   ```bash
   copy .env.example .env
   ```
   Update the values if your MySQL settings differ and change `JWT_SECRET` to a random string.
4. Launch the server (listens on port 8000):
   ```bash
   npm start
   ```
5. Open the chat at http://localhost:8000/.

The interface supports registration, login, loading the last 50 messages, real-time updates through Socket.IO, and a pink branded layout. When you expose port 8000 via your tunneling tool, the same build will work on the public URL (for example `https://recklessly-chic-liger.cloudpub.ru/`).

## Project structure

- `src/server.js` – Express app, REST API, Socket.IO events.
- `src/db.js` – MySQL pool creation plus schema auto-initialisation.
- `public/` – Static UI (HTML, CSS, JS) served by Express.
- `sql/init.sql` – Optional script to bootstrap schema manually.
- `.env.example` – Template for configuration.

## Useful commands

- `npm start` – run the production server on port 8000.
- `npm run dev` – aliases `npm start` (useful when running via nodemon, if you add it).

## Notes

- Passwords are hashed with `bcryptjs`.
- JWT tokens live 7 days; they are stored in `localStorage` on the client.
- The server auto-creates the database and tables on startup if the configured user has the required privileges.
- Messages are limited to 500 characters client-side and trimmed server-side before saving.
# mess
