export type MailMessage = { to: string; subject: string; text: string };

export type Mailer = { send(message: MailMessage): Promise<void> };

/** Development: prints the email to the server console instead of sending it. */
export function consoleMailer(log: (line: string) => void = console.log): Mailer {
  return {
    async send({ to, subject, text }) {
      log(["", "─── email (not sent: no mail provider configured) ───", `To: ${to}`, `Subject: ${subject}`, "", text, "─────────────────────────────────────────────────────", ""].join("\n"));
    },
  };
}

/** Resend (resend.com) over its HTTP API — no SDK needed. */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send({ to, subject, text }) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!res.ok) throw new Error(`Resend rejected the email: ${res.status} ${await res.text()}`);
    },
  };
}

/**
 * Picks the mail provider from the environment. Today that's Resend when
 * RESEND_API_KEY is set (MAIL_FROM is the sender), otherwise the console.
 * Adding another provider (SMTP, Postmark…) means one more branch here.
 */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM ?? "Draft Day <onboarding@resend.dev>");
  return consoleMailer();
}
