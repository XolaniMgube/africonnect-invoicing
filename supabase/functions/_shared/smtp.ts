/**
 * A small SMTP client: sends one message through a mailbox's own server
 * (e.g. Afrihost cPanel: mail.<domain>, port 465 with SSL), logging in with
 * the mailbox address and password.
 *
 * It has no imports and doesn't open connections itself: the caller passes a
 * `Transport` (Deno TLS sockets in the Edge Function, fakes in the tests).
 *   * Port 465: the connection is encrypted from the start.
 *   * Other ports (587, 2525): STARTTLS is required before logging in, so a
 *     password is never sent unencrypted.
 */

export type Transport = {
  read(): Promise<Uint8Array | null>;
  write(data: Uint8Array): Promise<void>;
  /** Upgrades a plain connection to TLS (after "STARTTLS"). */
  startTls(): Promise<void>;
  close(): void;
};

export type SmtpSettings = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export type Attachment = {
  filename: string;
  contentType: string;
  content: Uint8Array;
};

export type Mail = {
  from: { name: string; address: string };
  to: string[];
  cc?: string[];
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Attachment[];
};

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const base64Text = (text: string) => base64(encoder.encode(text));
/** Base64 in 76-character lines, as MIME requires. */
const wrapped = (b64: string) => b64.replace(/.{1,76}/g, "$&\r\n");

/** Header text: plain ASCII as is, anything else as a UTF-8 encoded-word. */
function headerText(text: string) {
  const clean = text.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${base64Text(clean)}?=`;
}

const address = (value: string) => {
  const clean = value.trim();
  if (/[\r\n<>\s]/.test(clean) || !clean.includes("@"))
    throw new SmtpError(`“${value}” is not a valid email address.`);
  return clean;
};

function displayName(name: string) {
  const text = headerText(name);
  return text.startsWith("=?") ? text : `"${text.replace(/["\\]/g, "")}"`;
}

/** The message as sent after DATA (CRLF line endings, no final dot). */
export function buildMessage(
  mail: Mail,
  options: { date?: Date; id?: string } = {},
) {
  const boundary = `----=_Part_${crypto.randomUUID()}`;
  const alternative = `----=_Alt_${crypto.randomUUID()}`;
  const domain = address(mail.from.address).split("@")[1];
  const headers = [
    `From: ${displayName(mail.from.name)} <${address(mail.from.address)}>`,
    `To: ${mail.to.map(address).join(", ")}`,
    ...(mail.cc?.length ? [`Cc: ${mail.cc.map(address).join(", ")}`] : []),
    ...(mail.replyTo ? [`Reply-To: ${address(mail.replyTo)}`] : []),
    `Subject: ${headerText(mail.subject)}`,
    `Date: ${(options.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${options.id ?? crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    [
      `Content-Type: ${type}; charset=utf-8`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapped(base64Text(body)),
    ].join("\r\n");
  const lines = [
    ...headers,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    part("text/plain", mail.text),
    ...(mail.html ? [`--${alternative}`, part("text/html", mail.html)] : []),
    `--${alternative}--`,
  ];
  for (const a of mail.attachments ?? []) {
    const name = headerText(a.filename).replace(/"/g, "");
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      wrapped(base64(a.content)),
    );
  }
  lines.push(`--${boundary}--`, "");
  // Lines starting with "." are doubled so they don't end the message early.
  return lines.join("\r\n").replace(/\r\n\./g, "\r\n..");
}

/** Reads SMTP replies (possibly multi-line: "250-…" then "250 …"). */
class Replies {
  private buffer = "";
  constructor(private transport: Transport) {}

  async next(): Promise<{ code: number; text: string; lines: string[] }> {
    const lines: string[] = [];
    for (;;) {
      let end = this.buffer.indexOf("\r\n");
      while (end < 0) {
        const chunk = await this.transport.read();
        if (!chunk)
          throw new SmtpError("The mail server closed the connection.");
        this.buffer += decoder.decode(chunk);
        end = this.buffer.indexOf("\r\n");
      }
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      lines.push(line);
      if (line.length < 4 || line[3] !== "-")
        return {
          code: Number(line.slice(0, 3)),
          text: lines.map((l) => l.slice(4)).join(" "),
          lines,
        };
    }
  }

  /** Data left over after a reply can't be trusted across STARTTLS. */
  clear() {
    this.buffer = "";
  }
}

/**
 * Sends `mail` through the mailbox's server. Throws a `SmtpError` with the
 * server's own explanation (e.g. "535 Incorrect authentication data").
 */
export async function sendMail(
  open: (settings: SmtpSettings) => Promise<Transport>,
  settings: SmtpSettings,
  mail: Mail,
  timeoutMs = 30_000,
) {
  let transport: Transport | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new SmtpError(
            `The mail server ${settings.host}:${settings.port} didn’t answer in time.`,
          ),
        ),
      timeoutMs,
    );
  });
  const run = async () => {
    try {
      transport = await open(settings);
    } catch (e) {
      throw new SmtpError(
        `Couldn’t connect to ${settings.host}:${settings.port}. ${e instanceof Error ? e.message : ""}`.trim(),
      );
    }
    const t = transport;
    const replies = new Replies(t);
    const send = (line: string) => t.write(encoder.encode(`${line}\r\n`));
    const expect = async (codes: number[], step: string) => {
      const reply = await replies.next();
      if (!codes.includes(reply.code))
        throw new SmtpError(
          `${step} failed: ${reply.code} ${reply.text}`.trim(),
          reply.code,
        );
      return reply;
    };
    const from = address(mail.from.address);
    const domain = from.split("@")[1];

    await expect([220], "Connecting");
    await send(`EHLO ${domain}`);
    let hello = await expect([250], "Greeting");
    if (settings.port !== 465) {
      if (!hello.lines.some((l) => /^250[ -]STARTTLS/i.test(l)))
        throw new SmtpError(
          "The mail server doesn’t offer encryption on this port. Use port 465.",
        );
      await send("STARTTLS");
      await expect([220], "Starting encryption");
      replies.clear();
      await t.startTls();
      await send(`EHLO ${domain}`);
      hello = await expect([250], "Greeting");
    }
    const auth = hello.lines.find((l) => /^250[ -]AUTH[ =]/i.test(l)) ?? "";
    if (/\bPLAIN\b/i.test(auth) || !/\bLOGIN\b/i.test(auth)) {
      await send(
        `AUTH PLAIN ${base64Text(`\0${settings.username}\0${settings.password}`)}`,
      );
      await expect([235], "Login");
    } else {
      await send("AUTH LOGIN");
      await expect([334], "Login");
      await send(base64Text(settings.username));
      await expect([334], "Login");
      await send(base64Text(settings.password));
      await expect([235], "Login");
    }
    await send(`MAIL FROM:<${from}>`);
    await expect([250], "Sender");
    for (const rcpt of [...mail.to, ...(mail.cc ?? [])]) {
      await send(`RCPT TO:<${address(rcpt)}>`);
      await expect([250, 251], `Recipient ${rcpt}`);
    }
    await send("DATA");
    await expect([354], "Sending");
    await t.write(encoder.encode(`${buildMessage(mail)}\r\n.\r\n`));
    const accepted = await expect([250], "Sending");
    await send("QUIT").catch(() => undefined);
    return { response: `${accepted.code} ${accepted.text}` };
  };
  const running = run();
  // After a timeout the abandoned attempt still fails; that's expected.
  running.catch(() => undefined);
  try {
    return await Promise.race([running, timeout]);
  } finally {
    clearTimeout(timer);
    transport?.close();
  }
}

/** Ports the app allows (the database repeats this list). */
export const MAIL_PORTS = [465, 587, 2525];

/** Checks the mail settings form; the password may be kept when one is saved. */
export function validateMailSettings(
  settings: { host: string; port: number; username: string; password: string },
  passwordSaved: boolean,
) {
  const errors: string[] = [];
  if (!/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(settings.host.trim()))
    errors.push("Enter the outgoing mail server, e.g. mail.yourdomain.co.za.");
  if (!MAIL_PORTS.includes(settings.port))
    errors.push("Use port 465 (SSL), or 587 or 2525 (STARTTLS).");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(settings.username.trim()))
    errors.push("Enter the mailbox’s full email address as the username.");
  if (!passwordSaved && !settings.password)
    errors.push("Enter the mailbox password.");
  return errors;
}
