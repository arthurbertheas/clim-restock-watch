import nodemailer from "nodemailer";

export interface Alert {
  nom: string;
  url: string;
}

export function buildAlertEmail(alerts: Alert[]): { subject: string; text: string } {
  const n = alerts.length;
  const subject =
    n === 1
      ? `Clim de nouveau en stock : ${alerts[0].nom}`
      : `${n} clims de nouveau en stock`;
  const body = alerts.map((a) => `- ${a.nom}\n  ${a.url}`).join("\n\n");
  const text = `Retour en stock detecte :\n\n${body}\n`;
  return { subject, text };
}

export async function sendAlertEmail(
  alerts: Alert[],
  cfg: { user: string; pass: string; to: string },
): Promise<void> {
  if (alerts.length === 0) return;
  const { subject, text } = buildAlertEmail(alerts);
  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: cfg.user, pass: cfg.pass },
  });
  await transport.sendMail({ from: cfg.user, to: cfg.to, subject, text });
}
