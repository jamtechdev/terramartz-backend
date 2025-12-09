// Test Mailtrap Configuration
import nodemailer from "nodemailer";
import { MailtrapTransport } from "mailtrap";
import dotenv from "dotenv";

dotenv.config();

const TOKEN = process.env.MAILTRAP_API_TOKEN || "3de2cd6f0a38f0e9c9705944d7d4955b";

console.log("🔑 Testing Mailtrap with token:", TOKEN.substring(0, 10) + "...");

const transport = nodemailer.createTransport(
  MailtrapTransport({
    token: TOKEN.trim(),
  })
);

const sender = {
  address: "hello@demomailtrap.co",
  name: "Mailtrap Test",
};

const recipients = ["jamtest119@gmail.com"];

transport
  .sendMail({
    from: sender,
    to: recipients,
    subject: "You are awesome!",
    text: "Congrats for sending test email with Mailtrap!",
    category: "Integration Test",
  })
  .then((result) => {
    console.log("✅ Email sent successfully!", result);
  })
  .catch((error) => {
    console.error("❌ Error:", error.message);
    console.error("Full error:", error);
  });

