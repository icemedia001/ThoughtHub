# ThoughtHub

A clean, modern blog app built with Node.js, Express, EJS, and PostgreSQL.

Nothing overcomplicated—just a solid publishing platform with a sleek dark glassmorphic UI.

## What's inside

- **Articles & Markdown:** Write posts with full Markdown support (headings, code blocks, bold, lists, blockquotes).
- **Accounts & Verified Badges:** Anyone can post as a guest. If you sign up and verify your email, your posts get a green **Verified Author ✓** badge.
- **Unique Usernames:** Claim a username when you sign up.
- **Email Verification & Reset:** Real email delivery via Nodemailer & Gmail SMTP for account verification and password recovery.
- **PostgreSQL Persistence:** All posts, users, and login sessions persist in PostgreSQL.
- **Production Hardened:** Passwords hashed with `bcrypt`, sessions saved in Postgres via `connect-pg-simple`.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```
   *Make sure your `DATABASE_URL` is pointing to your PostgreSQL instance (e.g. `postgresql://postgres:postgres@localhost:5432/blog_db`).*

3. **Run the app:**
   ```bash
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

That's pretty much it. Enjoy.
