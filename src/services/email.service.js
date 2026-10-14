const { Resend } = require('resend');

const env = require('../config/env');

const resend = new Resend(env.RESEND_API_KEY);

// Every "here's your 6-digit code" email looks the same; only the wording changes.
const sendCodeEmail = async ({ to, subject, heading, intro, code }) => {
  const result = await resend.emails.send({
    from: 'ShiftBuddy <noreply@manjeetyadav.me>', // domain verify hone ke baad ye badlenge
    to,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 400px;">
        <h2>${heading}</h2>
        <p>${intro}</p>
        <p style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${code}</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  // 📌 Resend ka SDK error THROW nahi karta — { data, error } return karta hai.
  // Isko check karna zaroori hai, warna failure bhi "success" jaisa dikhega.
  if (result.error) {
    console.error('Resend send failed:', result.error);
    throw new Error(`Failed to send email: ${result.error.message}`);
  }
  return result.data;
};

const sendPasswordResetEmail = (toEmail, otpCode) =>
  sendCodeEmail({
    to: toEmail,
    subject: 'Your ShiftBuddy password reset code',
    heading: 'Reset your password',
    intro: 'Use this code in the app to reset your password. It expires in 10 minutes.',
    code: otpCode,
  });

const sendVerificationEmail = (toEmail, code) =>
  sendCodeEmail({
    to: toEmail,
    subject: 'Verify your ShiftBuddy email',
    heading: 'Confirm your email',
    intro: 'Enter this code in ShiftBuddy to verify your email. It expires in 10 minutes.',
    code,
  });

module.exports = { sendPasswordResetEmail, sendVerificationEmail };