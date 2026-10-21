const { Resend } = require('resend');

const env = require('../config/env');

const resend = new Resend(env.RESEND_API_KEY);

const send = async ({ to, subject, html }) => {
  const result = await resend.emails.send({
    from: 'ShiftBuddy <noreply@manjeetyadav.me>', // domain verify hone ke baad ye badlenge
    to,
    subject,
    html,
  });

  // 📌 Resend ka SDK error THROW nahi karta — { data, error } return karta hai.
  // Isko check karna zaroori hai, warna failure bhi "success" jaisa dikhega.
  if (result.error) {
    console.error('Resend send failed:', result.error);
    throw new Error(`Failed to send email: ${result.error.message}`);
  }
  return result.data;
};

// Every "here's your 6-digit code" email looks the same; only the wording changes.
const sendCodeEmail = ({ to, subject, heading, intro, code }) =>
  send({
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

// A short "this happened to your account" note. Only our own words go in: no names or other user input.
const sendNoticeEmail = ({ to, subject, heading, paragraphs }) =>
  send({
    to,
    subject,
    html: `
      <div style="font-family: sans-serif; max-width: 440px;">
        <h2>${heading}</h2>
        ${paragraphs.map((text) => `<p>${text}</p>`).join('')}
      </div>
    `,
  });

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

// `purgeDate` is shown as a calendar day in UTC: the server doesn't know the reader's zone
const longDate = (date) => date.toLocaleDateString('en-CA', { dateStyle: 'long', timeZone: 'UTC' });

const sendDeletionScheduledEmail = (toEmail, purgeDate) =>
  sendNoticeEmail({
    to: toEmail,
    subject: 'Your ShiftBuddy account will be deleted',
    heading: 'Your account is set to be deleted',
    paragraphs: [
      `You asked us to delete your ShiftBuddy account. It is signed out everywhere and hidden now, and it will be erased for good on <strong>${longDate(purgeDate)}</strong> — your jobs, shifts, hours and shares with it.`,
      'Changed your mind? Sign in to ShiftBuddy before then and choose <strong>Restore account</strong>. Everything comes back as it was.',
      'If you didn’t ask for this, sign in and restore your account now, then change your password.',
    ],
  });

const sendAccountRestoredEmail = (toEmail) =>
  sendNoticeEmail({
    to: toEmail,
    subject: 'Your ShiftBuddy account is back',
    heading: 'Welcome back',
    paragraphs: [
      'Your ShiftBuddy account was restored and won’t be deleted. Your jobs, shifts and hours are just as you left them.',
      'If this wasn’t you, change your password right away.',
    ],
  });

module.exports = { sendPasswordResetEmail, sendVerificationEmail, sendDeletionScheduledEmail, sendAccountRestoredEmail };