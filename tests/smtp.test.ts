import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMessage,
  sendMail,
  SmtpError,
  type Mail,
  type SmtpSettings,
  type Transport,
} from "../supabase/functions/_shared/smtp";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A scripted mail server. `handle` answers each command line; DATA content is
 * collected until the lone "." line.
 */
function fakeServer(options: {
  starttls?: boolean;
  auth?: string;
  password?: string;
  silent?: boolean;
}) {
  const log: string[] = [];
  let pending: string[] = [];
  let waiting: ((value: Uint8Array | null) => void) | undefined;
  let inData = false;
  let data = "";
  let tls = false;
  let partial = "";
  const reply = (text: string) => {
    if (waiting) {
      const w = waiting;
      waiting = undefined;
      w(encoder.encode(text));
    } else pending.push(text);
  };
  const ehlo = () =>
    reply(
      [
        "250-mail.example.co.za Hello",
        ...(options.starttls && !tls ? ["250-STARTTLS"] : []),
        `250-AUTH ${options.auth ?? "PLAIN LOGIN"}`,
        "250 SIZE 52428800",
      ].join("\r\n") + "\r\n",
    );
  let loginStep = 0;
  const handle = (line: string) => {
    if (inData) {
      if (line === ".") {
        inData = false;
        reply("250 OK id=1abc\r\n");
      } else data += `${line}\r\n`;
      return;
    }
    log.push(line);
    if (loginStep === 1) {
      loginStep = 2;
      return reply("334 UGFzc3dvcmQ6\r\n");
    }
    if (loginStep === 2) {
      loginStep = 0;
      const ok =
        decoder.decode(Uint8Array.from(atob(line), (c) => c.charCodeAt(0))) ===
        (options.password ?? "secret");
      return reply(
        ok
          ? "235 Authentication succeeded\r\n"
          : "535 Incorrect authentication data\r\n",
      );
    }
    if (/^EHLO /.test(line)) return ehlo();
    if (line === "STARTTLS") return reply("220 Ready to start TLS\r\n");
    if (line.startsWith("AUTH PLAIN ")) {
      const [, user, pass] = atob(line.slice(11)).split("\0");
      return reply(
        user === "info@example.co.za" && pass === (options.password ?? "secret")
          ? "235 Authentication succeeded\r\n"
          : "535 Incorrect authentication data\r\n",
      );
    }
    if (line === "AUTH LOGIN") {
      loginStep = 1;
      return reply("334 VXNlcm5hbWU6\r\n");
    }
    if (line.startsWith("MAIL FROM:")) return reply("250 OK\r\n");
    if (line.startsWith("RCPT TO:")) return reply("250 Accepted\r\n");
    if (line === "DATA") {
      inData = true;
      return reply("354 Enter message\r\n");
    }
    if (line === "QUIT") return reply("221 Bye\r\n");
    reply("500 Unknown\r\n");
  };
  const transport: Transport = {
    read: () =>
      pending.length
        ? Promise.resolve(encoder.encode(pending.shift()!))
        : new Promise((resolve) => (waiting = resolve)),
    async write(bytes) {
      partial += decoder.decode(bytes);
      let end;
      while ((end = partial.indexOf("\r\n")) >= 0) {
        const line = partial.slice(0, end);
        partial = partial.slice(end + 2);
        handle(line);
      }
    },
    async startTls() {
      tls = true;
      pending = [];
    },
    close() {},
  };
  if (!options.silent) reply("220 mail.example.co.za ESMTP Exim\r\n");
  return { transport, log, data: () => data, tls: () => tls };
}

const settings: SmtpSettings = {
  host: "mail.example.co.za",
  port: 465,
  username: "info@example.co.za",
  password: "secret",
};
const mail: Mail = {
  from: { name: "Africonnect Solutions", address: "info@example.co.za" },
  to: ["client@customer.example"],
  cc: ["finance@customer.example"],
  replyTo: "hello@example.co.za",
  subject: "Invoice INV-0001 – March",
  text: "Good day\n.\nRegards",
  html: "<p>Good day</p>",
  attachments: [
    {
      filename: "Invoice-INV-0001.pdf",
      contentType: "application/pdf",
      content: new Uint8Array(200).fill(65),
    },
  ],
};

test("sends through port 465: login, sender, every recipient, message", async () => {
  const server = fakeServer({});
  const result = await sendMail(async () => server.transport, settings, mail);
  assert.equal(result.response, "250 OK id=1abc");
  assert.equal(server.tls(), false); // 465 is encrypted from the start
  assert.deepEqual(
    server.log.filter((l) => !l.startsWith("AUTH")),
    [
      "EHLO example.co.za",
      "MAIL FROM:<info@example.co.za>",
      "RCPT TO:<client@customer.example>",
      "RCPT TO:<finance@customer.example>",
      "DATA",
      "QUIT",
    ],
  );
  assert.match(
    server.data(),
    /^From: "Africonnect Solutions" <info@example.co.za>/,
  );
  assert.match(server.data(), /Cc: finance@customer.example/);
});

test("other ports require STARTTLS before the password is sent", async () => {
  const withTls = fakeServer({ starttls: true });
  await sendMail(
    async () => withTls.transport,
    { ...settings, port: 587 },
    mail,
  );
  assert.equal(withTls.tls(), true);
  assert.ok(
    withTls.log.indexOf("STARTTLS") <
      withTls.log.findIndex((l) => l.startsWith("AUTH")),
  );

  const plain = fakeServer({});
  await assert.rejects(
    sendMail(async () => plain.transport, { ...settings, port: 587 }, mail),
    /doesn’t offer encryption/,
  );
  assert.ok(!plain.log.some((l) => l.startsWith("AUTH")));
});

test("AUTH LOGIN servers, wrong passwords, refused connections and timeouts", async () => {
  const login = fakeServer({ auth: "LOGIN" });
  await sendMail(async () => login.transport, settings, mail);
  assert.ok(login.log.includes("AUTH LOGIN"));

  const wrong = fakeServer({ password: "other" });
  await assert.rejects(
    sendMail(async () => wrong.transport, settings, mail),
    (e: unknown) =>
      e instanceof SmtpError &&
      e.code === 535 &&
      /Login failed: 535 Incorrect authentication data/.test(e.message),
  );

  await assert.rejects(
    sendMail(
      async () => {
        throw new Error("Connection refused");
      },
      settings,
      mail,
    ),
    /Couldn’t connect to mail.example.co.za:465. Connection refused/,
  );

  const silent = fakeServer({ silent: true });
  await assert.rejects(
    sendMail(async () => silent.transport, settings, mail, 50),
    /didn’t answer in time/,
  );
});

test("messages: encoded headers, wrapped base64, attachment, dot-stuffing", () => {
  const message = buildMessage(
    {
      ...mail,
      from: { name: "Lumina Cube – Pty", address: "info@luminacube.co.za" },
    },
    { date: new Date("2026-11-14T08:00:00Z"), id: "abc" },
  );
  assert.match(
    message,
    /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <info@luminacube.co.za>\r\n/,
  );
  assert.match(message, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(message, /\r\nDate: Sat, 14 Nov 2026 08:00:00 \+0000\r\n/);
  assert.match(message, /\r\nMessage-ID: <abc@luminacube.co.za>\r\n/);
  assert.match(
    message,
    /Content-Disposition: attachment; filename="Invoice-INV-0001.pdf"/,
  );
  assert.ok(message.split("\r\n").every((line) => line.length <= 998));
  assert.ok(!/\r\n\.[^.]/.test(message));
  // Header injection is refused.
  assert.throws(
    () => buildMessage({ ...mail, to: ["a@b.co\r\nBcc: x@y.z"] }),
    /not a valid email address/,
  );
  // The plain-text body round-trips.
  const textPart = message
    .split(
      "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n",
    )[1]
    .split("\r\n--")[0];
  assert.equal(
    new TextDecoder().decode(
      Uint8Array.from(atob(textPart.replace(/\r\n/g, "")), (c) =>
        c.charCodeAt(0),
      ),
    ),
    "Good day\n.\nRegards",
  );
});
