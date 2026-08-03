import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { marked } from "marked";
import { sendVerificationEmail, sendPasswordResetEmail } from "./utils/mailer.js";
import { initDb, query, isDbConnected, getPool } from "./config/db.js";
import { generateArticleWithAgent, summarizeArticleWithAgent, polishArticleWithAgent } from "./services/aiService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PgSession = connectPgSimple(session);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    store: new PgSession({
      pool: getPool(),
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "thought-hub-secret-key-2026",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  })
);

app.use(async (req, res, next) => {
  if (!isDbConnected()) {
    await initDb();
  }
  if (req.session.user && req.session.user.id) {
    const freshUser = await findUserById(req.session.user.id);
    if (freshUser) {
      req.session.user = freshUser;
    }
  }
  res.locals.user = req.session.user || null;
  res.locals.parseMarkdown = content => marked.parse(content || "");
  next();
});

function calculateReadTime(content) {
  const words = content ? content.trim().split(/\s+/).length : 0;
  const minutes = Math.max(1, Math.ceil(words / 200));
  return `${minutes} min read`;
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

let memoryUsers = [];
let memoryPosts = [];

function mapDbPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    author: row.author,
    isVerified: row.is_verified,
    coverImage: row.cover_image,
    content: row.content,
    createdAt: row.created_at,
    readTime: row.read_time,
    status: row.status || "published"
  };
}

function mapDbUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    password: row.password,
    isEmailVerified: row.is_email_verified,
    verificationToken: row.verification_token,
    resetPasswordToken: row.reset_password_token,
    resetPasswordExpires: row.reset_password_expires ? Number(row.reset_password_expires) : null
  };
}

async function getAllPosts(statusFilter = "published") {
  if (isDbConnected()) {
    let sql = "SELECT * FROM posts ORDER BY id DESC;";
    let params = [];
    if (statusFilter !== "all") {
      sql = "SELECT * FROM posts WHERE status = $1 ORDER BY id DESC;";
      params = [statusFilter];
    }
    const res = await query(sql, params);
    if (res && res.rows) {
      return res.rows.map(mapDbPost);
    }
  }
  if (statusFilter === "all") return memoryPosts;
  return memoryPosts.filter(p => (p.status || "published") === statusFilter);
}

async function getPostsByAuthor(authorName, statusFilter = "published") {
  const queryAuthor = (authorName || "").trim().toLowerCase();
  if (isDbConnected()) {
    let sql = "SELECT * FROM posts WHERE LOWER(author) = $1 AND status = $2 ORDER BY id DESC;";
    const res = await query(sql, [queryAuthor, statusFilter]);
    if (res && res.rows) {
      return res.rows.map(mapDbPost);
    }
  }
  return memoryPosts.filter(
    p => p.author.toLowerCase() === queryAuthor && (p.status || "published") === statusFilter
  );
}

async function getPostById(id) {
  if (isDbConnected()) {
    const res = await query("SELECT * FROM posts WHERE id = $1;", [id]);
    if (res && res.rows.length > 0) {
      return mapDbPost(res.rows[0]);
    }
  }
  return memoryPosts.find(p => p.id === id) || null;
}

async function savePost(post) {
  if (isDbConnected()) {
    await query(
      `INSERT INTO posts (id, title, category, author, is_verified, cover_image, content, created_at, read_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
      [
        post.id,
        post.title,
        post.category,
        post.author,
        post.isVerified,
        post.coverImage,
        post.content,
        post.createdAt,
        post.readTime,
        post.status || "published"
      ]
    );
  }
  memoryPosts.unshift(post);
}

async function updatePost(id, updates) {
  if (isDbConnected()) {
    await query(
      `UPDATE posts 
       SET title = COALESCE($1, title),
           category = COALESCE($2, category),
           author = COALESCE($3, author),
           cover_image = COALESCE($4, cover_image),
           content = COALESCE($5, content),
           read_time = COALESCE($6, read_time),
           status = COALESCE($7, status)
       WHERE id = $8;`,
      [
        updates.title,
        updates.category,
        updates.author,
        updates.coverImage,
        updates.content,
        updates.readTime,
        updates.status,
        id
      ]
    );
  }
  const idx = memoryPosts.findIndex(p => p.id === id);
  if (idx !== -1) {
    memoryPosts[idx] = { ...memoryPosts[idx], ...updates };
  }
}

async function deletePostById(id) {
  if (isDbConnected()) {
    await query("DELETE FROM posts WHERE id = $1;", [id]);
  }
  memoryPosts = memoryPosts.filter(p => p.id !== id);
}

async function findUserById(id) {
  if (isDbConnected()) {
    const res = await query("SELECT * FROM users WHERE id = $1;", [id]);
    if (res && res.rows.length > 0) return mapDbUser(res.rows[0]);
  }
  return memoryUsers.find(u => u.id === id) || null;
}

async function findUserByUsername(username) {
  const queryVal = (username || "").trim().toLowerCase();
  if (isDbConnected()) {
    const res = await query("SELECT * FROM users WHERE LOWER(username) = $1;", [queryVal]);
    if (res && res.rows.length > 0) return mapDbUser(res.rows[0]);
  }
  return memoryUsers.find(u => u.username.toLowerCase() === queryVal) || null;
}

async function findUserByEmail(email) {
  const queryVal = (email || "").trim().toLowerCase();
  if (isDbConnected()) {
    const res = await query("SELECT * FROM users WHERE LOWER(email) = $1;", [queryVal]);
    if (res && res.rows.length > 0) return mapDbUser(res.rows[0]);
  }
  return memoryUsers.find(u => u.email.toLowerCase() === queryVal) || null;
}

async function findUserByIdentifier(identifier) {
  const queryVal = (identifier || "").trim().toLowerCase();
  if (isDbConnected()) {
    const res = await query(
      "SELECT * FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1;",
      [queryVal]
    );
    if (res && res.rows.length > 0) return mapDbUser(res.rows[0]);
  }
  return (
    memoryUsers.find(
      u => u.username.toLowerCase() === queryVal || u.email.toLowerCase() === queryVal
    ) || null
  );
}

async function saveUser(user) {
  if (isDbConnected()) {
    await query(
      `INSERT INTO users (id, username, email, password, is_email_verified, verification_token, reset_password_token, reset_password_expires)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [
        user.id,
        user.username,
        user.email,
        user.password,
        user.isEmailVerified,
        user.verificationToken,
        user.resetPasswordToken,
        user.resetPasswordExpires
      ]
    );
  }
  memoryUsers.push(user);
}

async function findUserByVerificationToken(token) {
  if (isDbConnected()) {
    const res = await query("SELECT * FROM users WHERE verification_token = $1;", [token]);
    if (res && res.rows.length > 0) return mapDbUser(res.rows[0]);
  }
  return memoryUsers.find(u => u.verificationToken === token) || null;
}

async function setAccountVerified(userId, username) {
  if (isDbConnected()) {
    await query(
      "UPDATE users SET is_email_verified = TRUE, verification_token = NULL WHERE id = $1;",
      [userId]
    );
    await query("UPDATE posts SET is_verified = TRUE WHERE LOWER(author) = LOWER($1);", [username]);
  }
  const u = memoryUsers.find(user => user.id === userId);
  if (u) {
    u.isEmailVerified = true;
    u.verificationToken = null;
  }
  memoryPosts.forEach(p => {
    if (p.author.toLowerCase() === username.toLowerCase()) {
      p.isVerified = true;
    }
  });
}

async function findUserByResetToken(token) {
  const now = Date.now();
  if (isDbConnected()) {
    const res = await query(
      "SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > $2;",
      [token, now]
    );
    if (res && res.rows.length > 0) return mapDbUser(res.rows[0]);
  }
  return (
    memoryUsers.find(
      u => u.resetPasswordToken === token && u.resetPasswordExpires > now
    ) || null
  );
}

async function setResetToken(userId, token, expires) {
  if (isDbConnected()) {
    await query(
      "UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3;",
      [token, expires, userId]
    );
  }
  const u = memoryUsers.find(user => user.id === userId);
  if (u) {
    u.resetPasswordToken = token;
    u.resetPasswordExpires = expires;
  }
}

async function updateUserPassword(userId, newPassword) {
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  if (isDbConnected()) {
    await query(
      "UPDATE users SET password = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2;",
      [hashedPassword, userId]
    );
  }
  const u = memoryUsers.find(user => user.id === userId);
  if (u) {
    u.password = hashedPassword;
    u.resetPasswordToken = null;
    u.resetPasswordExpires = null;
  }
}

app.post("/api/ai/generate", async (req, res) => {
  const { topic } = req.body;
  if (!topic || !topic.trim()) {
    return res.status(400).json({ success: false, error: "Topic prompt is required." });
  }
  const result = await generateArticleWithAgent(topic);
  res.json(result);
});

app.post("/api/ai/summarize", async (req, res) => {
  const { title, content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, error: "Article content is required for summarization." });
  }
  const result = await summarizeArticleWithAgent(title || "", content);
  res.json(result);
});

app.post("/api/ai/polish", async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, error: "Content is required to polish." });
  }
  const result = await polishArticleWithAgent(content);
  res.json(result);
});

app.get("/signup", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("signup");
});

app.post("/signup", async (req, res) => {
  const { username, email, password } = req.body;
  const trimmedUsername = (username || "").trim();
  const trimmedEmail = (email || "").trim().toLowerCase();

  const usernameExists = await findUserByUsername(trimmedUsername);
  if (usernameExists) {
    return res.render("signup", {
      error: `The username '${trimmedUsername}' is already taken. Please choose another username.`
    });
  }

  const emailExists = await findUserByEmail(trimmedEmail);
  if (emailExists) {
    return res.render("signup", {
      error: "An account with this email address already exists. Please sign in instead."
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const verificationToken = randomUUID();
  const newUser = {
    id: randomUUID(),
    username: trimmedUsername,
    email: trimmedEmail,
    password: hashedPassword,
    isEmailVerified: false,
    verificationToken,
    resetPasswordToken: null,
    resetPasswordExpires: null
  };

  await saveUser(newUser);
  req.session.user = newUser;

  await sendVerificationEmail(newUser.email, newUser.username, verificationToken);

  res.redirect("/");
});

app.get("/verify-email", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect("/");

  const user = await findUserByVerificationToken(token);

  if (user) {
    await setAccountVerified(user.id, user.username);
    user.isEmailVerified = true;
    user.verificationToken = null;

    req.session.user = user;

    const posts = await getAllPosts("published");
    return res.render("index", {
      posts,
      success: `Congratulations @${user.username}! Your email has been verified. You now have a Verified Author badge on all your posts!`
    });
  }

  res.redirect("/");
});

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/");
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  const user = await findUserByIdentifier(identifier);

  if (!user) {
    return res.render("login", {
      error: "Invalid email/username or password."
    });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.render("login", {
      error: "Invalid email/username or password."
    });
  }

  req.session.user = user;
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/forgot-password", (req, res) => {
  res.render("forgot-password");
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  const user = await findUserByEmail(email);

  if (!user) {
    return res.render("forgot-password", {
      error: "No registered account found with that email address."
    });
  }

  const token = randomUUID();
  const expires = Date.now() + 3600000;
  await setResetToken(user.id, token, expires);

  const mailResult = await sendPasswordResetEmail(user.email, user.username, token);
  res.render("forgot-password", {
    resetLink: mailResult.resetUrl,
    mailSent: mailResult.success,
    targetEmail: user.email
  });
});

app.get("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const user = await findUserByResetToken(token);

  if (!user) {
    return res.render("forgot-password", {
      error: "Password reset token is invalid or has expired."
    });
  }

  res.render("reset-password", { token });
});

app.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  const user = await findUserByResetToken(token);

  if (!user) {
    return res.render("forgot-password", {
      error: "Password reset token is invalid or has expired."
    });
  }

  await updateUserPassword(user.id, password);

  res.render("login", {
    success: "Your password has been successfully reset! Please sign in with your new password."
  });
});

app.get("/", async (req, res) => {
  const posts = await getAllPosts("published");
  res.render("index", { posts });
});

app.get("/posts", (req, res) => {
  res.redirect("/");
});

app.get("/my-posts", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const posts = await getPostsByAuthor(req.session.user.username, "published");
  const drafts = await getPostsByAuthor(req.session.user.username, "draft");
  res.render("dashboard", {
    activeTab: "published",
    posts,
    draftCount: drafts.length
  });
});

app.get("/my-drafts", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const posts = await getPostsByAuthor(req.session.user.username, "draft");
  const published = await getPostsByAuthor(req.session.user.username, "published");
  res.render("dashboard", {
    activeTab: "drafts",
    posts,
    draftCount: posts.length,
    publishedCount: published.length
  });
});

function canUserEditPost(user, post) {
  if (!user || !user.username || !post || !post.author) return false;
  return user.username.toLowerCase() === post.author.toLowerCase();
}

app.post("/post/:id/publish", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const postId = req.params.id;
  const existingPost = await getPostById(postId);
  if (existingPost && canUserEditPost(req.session.user, existingPost)) {
    await updatePost(postId, { status: "published" });
    return res.redirect(`/post/${postId}`);
  }
  res.redirect("/my-drafts");
});

app.get("/create-blog", (req, res) => {
  res.render("new");
});

app.post("/create-blog", async (req, res) => {
  const { title, category, author, coverImage, content, status } = req.body;
  let finalAuthor = "";
  let isVerified = false;

  if (req.session.user) {
    finalAuthor = req.session.user.username;
    isVerified = req.session.user.isEmailVerified;
  } else {
    finalAuthor = (author || "").trim() || "Anonymous";
    isVerified = false;
  }

  const postStatus = (status === "draft" && req.session.user) ? "draft" : "published";

  const newPost = {
    id: randomUUID(),
    title: title || "Untitled Article",
    category: category || "General",
    author: finalAuthor,
    isVerified,
    coverImage: coverImage || "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80",
    content: content || "",
    createdAt: formatDate(),
    readTime: calculateReadTime(content),
    status: postStatus
  };

  await savePost(newPost);
  if (postStatus === "draft") {
    return res.redirect("/my-drafts");
  }
  res.redirect(`/post/${newPost.id}`);
});

app.get("/post/:id", async (req, res) => {
  const postId = req.params.id;
  const post = await getPostById(postId);

  if (!post) {
    const posts = await getAllPosts("published");
    return res.status(404).render("index", { posts, error: "Post not found" });
  }

  if (post.status === "draft") {
    if (!req.session.user || !canUserEditPost(req.session.user, post)) {
      const posts = await getAllPosts("published");
      return res.status(403).render("index", { posts, error: "This post is a private draft." });
    }
  }

  res.render("post", { post });
});

app.get("/post/:id/edit", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const postId = req.params.id;
  const post = await getPostById(postId);

  if (!post) {
    return res.redirect("/");
  }

  if (!canUserEditPost(req.session.user, post)) {
    const posts = await getAllPosts("published");
    return res.status(403).render("index", {
      posts,
      error: "Access denied. You can only edit your own articles."
    });
  }

  res.render("edit", { post });
});

app.post("/post/:id/edit", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const postId = req.params.id;
  const existingPost = await getPostById(postId);

  if (!existingPost) {
    return res.redirect("/");
  }

  if (!canUserEditPost(req.session.user, existingPost)) {
    const posts = await getAllPosts("published");
    return res.status(403).render("index", {
      posts,
      error: "Access denied. You can only edit your own articles."
    });
  }

  const { title, category, coverImage, content, status } = req.body;
  const postStatus = (status === "draft" && req.session.user) ? "draft" : "published";

  const updates = {
    title: title || existingPost.title,
    category: category || existingPost.category,
    author: req.session.user.username,
    coverImage: coverImage || existingPost.coverImage,
    content: content || existingPost.content,
    readTime: calculateReadTime(content || existingPost.content),
    status: postStatus
  };

  await updatePost(postId, updates);
  if (postStatus === "draft") {
    return res.redirect("/my-drafts");
  }

  res.redirect(`/post/${postId}`);
});

app.post("/post/:id/delete", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  const postId = req.params.id;
  const existingPost = await getPostById(postId);

  if (!existingPost) {
    return res.redirect("/");
  }

  if (!canUserEditPost(req.session.user, existingPost)) {
    const posts = await getAllPosts("published");
    return res.status(403).render("index", {
      posts,
      error: "Access denied. You can only delete your own articles."
    });
  }

  await deletePostById(postId);
  res.redirect("/");
});

const PORT = process.env.PORT || 3000;

await initDb();

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

export default app;