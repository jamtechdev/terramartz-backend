import pug from "pug";
import { convert } from "html-to-text";
// Old SendGrid import (commented)
// import sgMail from "@sendgrid/mail";
// New Nodemailer + Mailtrap Sending API
import nodemailer from "nodemailer";
import { MailtrapTransport } from "mailtrap";
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
    // Hardcoded from address - Mailtrap demo domain requires hello@demomailtrap.co
    this.from = "hello@demomailtrap.co";
    this.baseUrl = baseUrl;
    this.emailOtp = docs?.emailOtp ? docs?.emailOtp : "";
  }

  // ✅ New: Create reusable Nodemailer transporter (Mailtrap Sending API)
  createTransporter() {
    // Check if Mailtrap API token is configured
    const mailtrapToken = process.env.MAILTRAP_API_TOKEN;
    
    if (mailtrapToken) {
      console.log("📧 Using Mailtrap Sending API...");
      console.log("🔑 Token loaded:", mailtrapToken.substring(0, 10) + "...");
      
      // Use Mailtrap Sending API
      const transportConfig = {
        token: mailtrapToken.trim(),
      };
      
      // Add inbox ID if provided (optional)
      if (process.env.MAILTRAP_INBOX_ID) {
        transportConfig.inboxId = process.env.MAILTRAP_INBOX_ID;
      }
      
      return nodemailer.createTransport(
        MailtrapTransport(transportConfig)
      );
    }
    
    // Fallback to regular SMTP if Mailtrap not configured
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.mail.com",
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true" || false,
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

    // From field - Mailtrap format (demo domain requires hello@demomailtrap.co)
    const fromField = {
      address: "hello@demomailtrap.co",
      name: "TerraMartz"
    };

    const mailOptions = {
      from: fromField,
      to: this.to,
      subject,
      html,
      text: convert(html),
    };

    // ✅ Mailtrap Sending API - Active Code
    // Check if Mailtrap API token is configured
    const mailtrapToken = process.env.MAILTRAP_API_TOKEN;
    
    console.log("🔍 Debug - MAILTRAP_API_TOKEN exists:", !!mailtrapToken);
    console.log("🔍 Debug - MAILTRAP_API_TOKEN value:", mailtrapToken ? mailtrapToken.substring(0, 10) + "..." : "NOT SET");
    
    if (!mailtrapToken) {
      throw new Error("MAILTRAP_API_TOKEN is required. Please set it in environment variables.");
    }

    try {
      console.log("📧 Preparing to send email...");
      console.log("📧 To:", this.to);
      console.log("📧 From:", JSON.stringify(fromField));
      console.log("📧 Using Mailtrap Sending API:", true);
      
      const transporter = this.createTransporter();
      
      console.log("📤 Sending email via Mailtrap Sending API...");
      const result = await transporter.sendMail(mailOptions);
      console.log("✅ Email sent successfully!", result);
      
    } catch (emailError) {
      console.error("❌ Email Error Details:");
      console.error("   Message:", emailError.message);
      console.error("   Code:", emailError.code);
      console.error("   Response:", emailError.response);
      console.error("   Full Error:", emailError);
      throw new Error(`Failed to send email via Mailtrap: ${emailError.message || emailError.code || 'Unknown error'}`);
    }

    // ❌ Old Mail.com SMTP Code (Commented - Keep for reference)
    // // Check if SMTP credentials are configured
    // if (!process.env.SMTP_USER && !process.env.SMTP_PASS) {
    //   throw new Error("SMTP credentials are not configured in environment variables");
    // }
    //
    // // Create transporter and send email using Nodemailer
    // try {
    //   const transporter = this.createTransporter();
    //   await transporter.verify(); // Test connection first
    //   await transporter.sendMail(mailOptions);
    // } catch (smtpError) {
    //   console.error("❌ SMTP Error:", smtpError);
    //   throw new Error(`Failed to send email: ${smtpError.message || smtpError.code || 'Unknown SMTP error'}`);
    // }

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
