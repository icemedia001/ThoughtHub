import nodemailer from "nodemailer";

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;

  if (!user || !pass || user.includes("your_email") || pass.includes("your_16_char")) {
    console.log("[Mailer Warning] Gmail SMTP credentials not configured in .env file.");
    return null;
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
  });
}

export async function sendVerificationEmail(toEmail, username, verificationToken) {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/verify-email?token=${verificationToken}`;

  const transporter = getTransporter();
  if (!transporter) return { success: false, verifyUrl };

  const mailOptions = {
    from: `"ThoughtHub" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "Verify Your Email Address - ThoughtHub",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 12px;">
        <h2 style="color: #6366f1; text-align: center;">Welcome to ThoughtHub, @${username}!</h2>
        <p style="font-size: 16px; line-height: 1.6;">Thank you for registering your account. Please verify your email address to unlock your <strong>Verified Author</strong> badge across the platform.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyUrl}" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Verify Email Address</a>
        </div>
        <p style="font-size: 14px; color: #94a3b8;">If the button above does not work, copy and paste this link into your browser:</p>
        <p style="font-size: 13px; word-break: break-all; color: #6366f1;">${verifyUrl}</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("[Mailer] Verification email sent to:", toEmail, info.messageId);
    return { success: true, verifyUrl };
  } catch (error) {
    console.error("[Mailer Error] Failed to send verification email:", error.message);
    return { success: false, verifyUrl, error: error.message };
  }
}

export async function sendPasswordResetEmail(toEmail, username, resetToken) {
  const baseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password/${resetToken}`;

  const transporter = getTransporter();
  if (!transporter) return { success: false, resetUrl };

  const mailOptions = {
    from: `"ThoughtHub Support" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: "Reset Your ThoughtHub Password",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #0f172a; color: #f8fafc; border-radius: 12px;">
        <h2 style="color: #6366f1; text-align: center;">Account Password Reset</h2>
        <p style="font-size: 16px; line-height: 1.6;">Hello @${username}, we received a request to reset your password. Click the button below to set a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); color: #ffffff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Reset Password</a>
        </div>
        <p style="font-size: 14px; color: #94a3b8;">This password reset link is valid for 1 hour. If you did not request a password reset, you can safely ignore this email.</p>
        <p style="font-size: 13px; word-break: break-all; color: #6366f1;">${resetUrl}</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("[Mailer] Password reset email sent to:", toEmail, info.messageId);
    return { success: true, resetUrl };
  } catch (error) {
    console.error("[Mailer Error] Failed to send reset email:", error.message);
    return { success: false, resetUrl, error: error.message };
  }
}
