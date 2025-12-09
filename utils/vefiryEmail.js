import pug from "pug";
import { convert } from "html-to-text";
// Old SendGrid import (commented)
// import sgMail from "@sendgrid/mail";
// New Nodemailer import
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import { dirname } from "path";

// ESM e __dirname recreate
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default class Email {
  constructor(docs, url = null, baseUrl = null) {
    this.to = docs.email;
    this.firstName = docs?.firstName ? docs.firstName.split(" ")[0] : "";
    this.url = url;
    this.from = process.env.EMAIL_FROM || "Terramartzinfo@mail.com";
    this.baseUrl = baseUrl;
    this.emailOtp = docs?.emailOtp ? docs?.emailOtp : "";
  }

  // ✅ New: Create reusable Nodemailer transporter (Mail.com SMTP)
  createTransporter() {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.mail.com",
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true" || false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER || "Terramartzinfo@mail.com",
        pass: process.env.SMTP_PASS || "Marketplace3457&",
      },
    });
  }

  // Send the actual email start
  async send(template, subject) {
    // 1) Render HTML based on a pug template
    const html = pug.renderFile(`${__dirname}/../views/email/${template}.pug`, {
      firstName: this.firstName ? this.firstName : "",
      front_end_url: this.baseUrl
        ? `${this.baseUrl}/${
            process.env.WEBSITE_RESET_PASSWORD_URL
          }?token=${this.url.substring(this.url.lastIndexOf("/") + 1)}`
        : "",
      subject,
      url: this.url || "",
      otp: this.emailOtp,
    });

    const mailOptions = {
      from: this.from,
      to: this.to,
      subject,
      html,
      text: convert(html),
    };

    // ✅ New: Nodemailer (Mail.com SMTP) - Active Code
    // Check if SMTP credentials are configured
    if (!process.env.SMTP_USER && !process.env.SMTP_PASS) {
      throw new Error("SMTP credentials are not configured in environment variables");
    }

    // Create transporter and send email using Nodemailer
    const transporter = this.createTransporter();
    await transporter.sendMail(mailOptions);

    // ❌ Old SendGrid Code (Commented - Keep for reference)
    // // Check if SendGrid API key is configured
    // if (!process.env.SENDGRID_API_KEY) {
    //   throw new Error("SENDGRID_API_KEY is not configured in environment variables");
    // }
    //
    // if (!process.env.EMAIL_FROM) {
    //   throw new Error("EMAIL_FROM is not configured in environment variables");
    // }
    //
    // // Send email (works in both development and production)
    // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    // await sgMail.send(mailOptions);
  }
  // Send the actual email end

  async sendPasswordReset() {
    await this.send(
      "passwordReset",
      "Your password reset token (valid for only 30 minutes)"
    );
  }
  async sendEmailVerificationOtpFn() {
    await this.send(
      "emailVarificationOtp",
      "Your OTP Code (Valid for 5 Minutes)"
    );
  }
}
