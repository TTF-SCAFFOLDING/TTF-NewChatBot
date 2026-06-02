import nodemailer from "nodemailer";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LeadPayload = {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  message?: unknown;
  source?: unknown; // e.g. "v2" | "v1"
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(req: NextRequest) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.LEAD_EMAIL_FROM || user;
  const to = process.env.LEAD_EMAIL_TO;

  if (!host || !user || !pass || !from || !to) {
    return new Response("Email transport not configured", { status: 500 });
  }

  let payload: LeadPayload;
  try {
    payload = (await req.json()) as LeadPayload;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  const source = typeof payload.source === "string" ? payload.source : "";

  if (!name || !phone || !email) {
    return new Response("Missing required fields", { status: 400 });
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const subject = `New chatbot lead — ${name}`;

  const text = [
    `New chat lead from the TTF Scaffolding website chatbot.`,
    ``,
    `Name:    ${name}`,
    `Phone:   ${phone}`,
    `Email:   ${email}`,
    source ? `Source:  ${source}` : "",
    ``,
    `First message:`,
    message || "(no message provided)",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;line-height:1.5">
      <h2 style="margin:0 0 12px;font-size:16px">New chatbot lead</h2>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td style="padding:4px 0"><strong>${esc(name)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td style="padding:4px 0"><a href="tel:${esc(phone)}">${esc(phone)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td style="padding:4px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        ${source ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Source</td><td style="padding:4px 0">${esc(source)}</td></tr>` : ""}
      </table>
      <h3 style="margin:18px 0 6px;font-size:14px">First message</h3>
      <div style="padding:10px 12px;background:#f4f4f5;border-radius:8px;white-space:pre-wrap;font-size:14px">${esc(message || "(no message provided)")}</div>
      <p style="margin-top:18px;color:#888;font-size:12px">Sent automatically from the TTF chatbot.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from,
      to,
      replyTo: email,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error("Lead email failed:", err);
    return new Response("Email send failed", { status: 502 });
  }

  return Response.json({ ok: true });
}
