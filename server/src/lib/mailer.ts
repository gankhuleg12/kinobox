import nodemailer, { type Transporter } from 'nodemailer';
import { settings } from '../modules/settings/settings.service.js';
import { logger } from './logger.js';

let cached: { fingerprint: string; transporter: Transporter } | null = null;

async function transporter() {
  const s = await settings.require(['smtp.host', 'smtp.from'], 'SMTP');
  const rest = await settings.getMany(['smtp.port', 'smtp.secure', 'smtp.user', 'smtp.password']);
  const fingerprint = JSON.stringify([s['smtp.host'], rest['smtp.port'], rest['smtp.secure'], rest['smtp.user'], rest['smtp.password']]);
  if (!cached || cached.fingerprint !== fingerprint) {
    cached = {
      fingerprint,
      transporter: nodemailer.createTransport({
        host: s['smtp.host'],
        port: rest['smtp.port'],
        secure: rest['smtp.secure'],
        auth: rest['smtp.user'] ? { user: rest['smtp.user'], pass: rest['smtp.password'] } : undefined,
      }),
    };
  }
  return { transporter: cached.transporter, from: s['smtp.from'] };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const mailer = {
  async send(to: string, subject: string, text: string, html?: string) {
    const { transporter: t, from } = await transporter();
    await t.sendMail({ from, to, subject, text, html });
    logger.info({ subject }, 'email sent');
  },

  async verify() {
    const { transporter: t } = await transporter();
    await t.verify();
  },

  async sendPasswordReset(to: string, name: string, link: string, siteName: string) {
    const text = `Сайн байна уу, ${name}!\n\nНууц үгээ шинэчлэхийн тулд доорх холбоос дээр дарна уу (30 минут хүчинтэй):\n${link}\n\nХэрэв та хүсэлт илгээгээгүй бол энэ имэйлийг үл тоомсорлоно уу.\n\n— ${siteName}`;
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="margin:0 0 16px">${escapeHtml(siteName)}</h2>
      <p>Сайн байна уу, ${escapeHtml(name)}!</p>
      <p>Нууц үгээ шинэчлэхийн тулд доорх товч дээр дарна уу. Холбоос 30 минут хүчинтэй.</p>
      <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none">Нууц үг шинэчлэх</a></p>
      <p style="color:#888;font-size:13px">Хэрэв та хүсэлт илгээгээгүй бол энэ имэйлийг үл тоомсорлоно уу.</p>
    </div>`;
    await this.send(to, `${siteName} — нууц үг шинэчлэх`, text, html);
  },
};
