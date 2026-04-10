import pug from "pug";
import { convert } from "html-to-text";
import sgMail from "@sendgrid/mail";
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
    this.from = process.env.EMAIL_FROM;
    this.baseUrl = baseUrl;
    this.emailOtp = docs?.emailOtp ? docs?.emailOtp : "";
  }

  // Send the actual email start
  async send(template, subject) {
    const frontEndUrl =
      this.baseUrl && this.url && process.env.WEBSITE_RESET_PASSWORD_URL
        ? `${this.baseUrl}/${process.env.WEBSITE_RESET_PASSWORD_URL}?token=${String(
            this.url,
          ).substring(String(this.url).lastIndexOf("/") + 1)}`
        : "";

    // 1) Render HTML based on a pug template
    const html = pug.renderFile(`${__dirname}/../views/email/${template}.pug`, {
      firstName: this.firstName ? this.firstName : "",
      front_end_url: frontEndUrl,
      subject,
      url: this.url || "",
      otp: this.emailOtp,
    });

    const fromField = {
      email: this.from,
      name: "TerraMartz",
    };

    const mailOptions = {
      from: fromField,
      to: this.to,
      subject,
      html,
      text: convert(html),
    };

    if (!process.env.SENDGRID_API_KEY) {
      throw new Error("SENDGRID_API_KEY is required. Please set it in environment variables.");
    }

    if (!this.from) {
      throw new Error("EMAIL_FROM is required. Please set it in environment variables.");
    }

    try {
      console.log("📧 Preparing to send email...");
      console.log("📧 To:", this.to);
      console.log("📧 From:", JSON.stringify(fromField));
      console.log("📧 Using SendGrid:", true);

      sgMail.setApiKey(process.env.SENDGRID_API_KEY);

      console.log("📤 Sending email via SendGrid...");
      const [result] = await sgMail.send(mailOptions);
      console.log("✅ Email sent successfully!", result);
    } catch (emailError) {
      console.error("❌ Email Error Details:");
      console.error("   Message:", emailError.message);
      console.error("   Code:", emailError.code);
      console.error("   Response:", emailError.response);
      console.error("   Full Error:", emailError);
      throw new Error(`Failed to send email via SendGrid: ${emailError.message || emailError.code || "Unknown error"}`);
    }
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
