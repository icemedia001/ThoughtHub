import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { sendVerificationEmail, sendPasswordResetEmail } from "./utils/mailer.js";
import { initDb, query, isDbConnected, getPool } from "./config/db.js";

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

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
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

let memoryUsers = [
  {
    id: randomUUID(),
    username: "AlexRivers",
    email: "alex@example.com",
    password: "$2b$10$eW4yR3X1U0mZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2yZ2y",
    isEmailVerified: true,
    verificationToken: null,
    resetPasswordToken: null,
    resetPasswordExpires: null
  }
];

let memoryPosts = [
  {
    id: randomUUID(),
    title: "Building Modern Web Applications with Express & Glassmorphism",
    category: "Development",
    author: "AlexRivers",
    isVerified: true,
    coverImage: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&w=1200&q=80",
    content: `Web development has evolved drastically over the past few years. Modern interfaces prioritize visual aesthetics, responsive performance, and seamless interactive user experiences.\n\nIn this article, we explore how combining Express.js backend services with vanilla CSS glassmorphism, dynamic gradients, and CSS variables creates a sleek, high-performing user interface without bloated frameworks.\n\nKey takeaways:\n- Utilize native CSS custom properties for rapid theme changes.\n- Leverage backdrop-filters to achieve high-end blur translucent surfaces.\n- Keep server-side rendering fast and modular using EJS partials.`,
    createdAt: "Aug 3, 2026",
    readTime: "3 min read"
  },
  {
    id: randomUUID(),
    title: "The Future of AI-Assisted Pair Programming",
    category: "Technology",
    author: "Elena Rostova",
    isVerified: false,
    coverImage: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1200&q=80",
    content: `Artificial intelligence is changing the software engineering landscape rapidly. Rather than replacing developers, AI tools serve as supercharged pair programmers that speed up boilerplate generation, catch bug patterns early, and assist in architectural planning.\n\nAs developer tools become more context-aware, engineers can spend less time context switching and more time focusing on core problem solving and creative product design.`,
    createdAt: "Aug 2, 2026",
    readTime: "2 min read"
  },
  {
    id: randomUUID(),
    title: "Mastering UI Design: Micro-Animations & Contrast",
    category: "Design",
    author: "Marcus Vance",
    isVerified: false,
    coverImage: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80",
    content: `Micro-animations are subtle visual feedback moments that make a digital product feel responsive, fluid, and alive. From button hover elevations to smooth tab transitions, micro-interactions guide user attention effortlessly.\n\nPairing micro-animations with crisp color contrast ensures accessible, delightful user experiences for everyone.`,
    createdAt: "Jul 28, 2026",
    readTime: "2 min read"
  }
];

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
    readTime: row.read_time
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

async function getAllPosts() {
  if (isDbConnected()) {
    const res = await query("SELECT * FROM posts ORDER BY id DESC;");
    if (res && res.rows) {
      return res.rows.map(mapDbPost);
    }
  }
  return memoryPosts;
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
      `INSERT INTO posts (id, title, category, author, is_verified, cover_image, content, created_at, read_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [
        post.id,
        post.title,
        post.category,
        post.author,
        post.isVerified,
        post.coverImage,
        post.content,
        post.createdAt,
        post.readTime
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
           read_time = COALESCE($6, read_time)
       WHERE id = $7;`,
      [
        updates.title,
        updates.category,
        updates.author,
        updates.coverImage,
        updates.content,
        updates.readTime,
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

    if (req.session.user && req.session.user.id === user.id) {
      req.session.user = user;
    }

    const posts = await getAllPosts();
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
  const posts = await getAllPosts();
  res.render("index", { posts });
});

app.get("/posts", (req, res) => {
  res.redirect("/");
});

app.get("/create-blog", (req, res) => {
  res.render("new");
});

app.post("/create-blog", async (req, res) => {
  const { title, category, author, coverImage, content } = req.body;
  let finalAuthor = "";
  let isVerified = false;

  if (req.session.user) {
    finalAuthor = req.session.user.username;
    isVerified = req.session.user.isEmailVerified;
  } else {
    const guestAuthorInput = (author || "").trim();
    if (!guestAuthorInput) {
      finalAuthor = "Guest Writer";
    } else {
      const reservedUser = await findUserByUsername(guestAuthorInput);
      if (reservedUser) {
        return res.render("new", {
          error: `The username '${guestAuthorInput}' belongs to a registered account. Please sign in to post under this account or choose a different guest author name.`
        });
      }
      finalAuthor = guestAuthorInput;
    }
    isVerified = false;
  }

  const newPost = {
    id: randomUUID(),
    title: title || "Untitled Article",
    category: category || "General",
    author: finalAuthor,
    isVerified,
    coverImage: coverImage || "https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80",
    content: content || "",
    createdAt: formatDate(),
    readTime: calculateReadTime(content)
  };

  await savePost(newPost);
  res.redirect(`/post/${newPost.id}`);
});

app.get("/post/:id", async (req, res) => {
  const postId = req.params.id;
  const post = await getPostById(postId);

  if (!post) {
    const posts = await getAllPosts();
    return res.status(404).render("index", { posts, error: "Post not found" });
  }

  res.render("post", { post });
});

app.get("/post/:id/edit", async (req, res) => {
  const postId = req.params.id;
  const post = await getPostById(postId);

  if (!post) {
    return res.redirect("/");
  }

  res.render("edit", { post });
});

app.post("/post/:id/edit", async (req, res) => {
  const postId = req.params.id;
  const existingPost = await getPostById(postId);

  if (existingPost) {
    const { title, category, author, coverImage, content } = req.body;
    let updatedAuthor = existingPost.author;

    if (!req.session.user && author) {
      const reservedUser = await findUserByUsername(author.trim());
      if (!reservedUser) {
        updatedAuthor = author.trim();
      }
    }

    const updates = {
      title: title || existingPost.title,
      category: category || existingPost.category,
      author: updatedAuthor,
      coverImage: coverImage || existingPost.coverImage,
      content: content || existingPost.content,
      readTime: calculateReadTime(content || existingPost.content)
    };

    await updatePost(postId, updates);
  }

  res.redirect(`/post/${postId}`);
});

app.post("/post/:id/delete", async (req, res) => {
  const postId = req.params.id;
  await deletePostById(postId);
  res.redirect("/");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await initDb();
  console.log(`Server is running on http://localhost:${PORT}`);
});