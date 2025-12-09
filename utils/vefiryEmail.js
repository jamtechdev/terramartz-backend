import pug from "pug";
import { convert } from "html-to-text";
// Old SendGrid import (commented)
// import sgMail from "@sendgrid/mail";
// New Nodemailer + Mailtrap import
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
    // Hardcoded for Mailtrap
    this.from = process.env.MAILTRAP_API_TOKEN 
      ? "hello@demomailtrap.co"
      : (process.env.EMAIL_FROM || "Terramartzinfo@mail.com");
    this.baseUrl = baseUrl;
    this.emailOtp = docs?.emailOtp ? docs?.emailOtp : "";
  }

  // ✅ New: Create reusable Nodemailer transporter (Mailtrap - Development/Testing)
  createTransporter() {
    // Check if Mailtrap token is configured
    const mailtrapToken = process.env.MAILTRAP_API_TOKEN;
    
    if (mailtrapToken) {
      console.log("📧 Using Mailtrap for email sending...");
      console.log("🔑 Token loaded:", mailtrapToken.substring(0, 10) + "...");
      
      // Use Mailtrap for development/testing
      const transportConfig = {
        token: mailtrapToken.trim(), // Remove any whitespace
      };
      
      // Add inbox ID if provided (optional)
      if (process.env.MAILTRAP_INBOX_ID) {
        transportConfig.inboxId = process.env.MAILTRAP_INBOX_ID;
      }
      
      return nodemailer.createTransport(
        MailtrapTransport(transportConfig)
      );
    }
    
    // Fallback to SMTP (Mail.com or other) if Mailtrap not configured
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

    // Mailtrap requires specific from format (object with address and name)
    let fromField;
    if (process.env.MAILTRAP_API_TOKEN) {
      // Mailtrap format: Hardcoded as per test script
      fromField = {
        address: "hello@demomailtrap.co",
        name: "TerraMartz"
      };
    } else {
      // SMTP format: string or object
      fromField = this.from;
    }

    const mailOptions = {
      from: fromField,
      to: this.to,
      subject,
      html,
      text: convert(html),
    };

    // ✅ New: Mailtrap (Development/Testing) - Active Code
    // Check if Mailtrap token or SMTP credentials are configured
    const mailtrapToken = process.env.MAILTRAP_API_TOKEN;
    
    if (!mailtrapToken && !process.env.SMTP_USER && !process.env.SMTP_PASS) {
      throw new Error("Email service not configured. Please set MAILTRAP_API_TOKEN or SMTP credentials in environment variables");
    }

    // Create transporter and send email using Mailtrap or SMTP
    try {
      console.log("📧 Preparing to send email...");
      console.log("📧 To:", this.to);
      console.log("📧 From:", JSON.stringify(fromField));
      console.log("📧 Using Mailtrap:", !!mailtrapToken);
      
      const transporter = this.createTransporter();
      
      // Only verify connection for SMTP (not needed for Mailtrap)
      if (!mailtrapToken) {
        console.log("🔍 Verifying SMTP connection...");
        await transporter.verify();
      }
      
      console.log("📤 Sending email via Mailtrap...");
      const result = await transporter.sendMail(mailOptions);
      console.log("✅ Email sent successfully!", result);
      
    } catch (emailError) {
      console.error("❌ Email Error Details:");
      console.error("   Message:", emailError.message);
      console.error("   Code:", emailError.code);
      console.error("   Response:", emailError.response);
      console.error("   Full Error:", emailError);
      throw new Error(`Failed to send email: ${emailError.message || emailError.code || 'Unknown error'}`);
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
