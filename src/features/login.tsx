"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Mail,
  LockKeyhole,
  FileCheck2,
  Building2,
  Download,
  Layers3,
} from "lucide-react";
import { useData } from "@/components/provider";
import { Brand } from "@/components/shell";
import { Button, Field } from "@/components/ui";
export function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { employee, signIn, backend, configError } = useData();
  const local = backend === "local";
  // Someone already signed in goes straight to the workspace.
  useEffect(() => {
    if (employee) router.replace("/overview");
  }, [employee, router]);
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-story-content">
          <span className="eyebrow light">AFRICONNECT EMPLOYEE WORKSPACE</span>
          <h1>
            Good business.
            <br />
            Great paperwork.
            <br />
            <em>All connected.</em>
          </h1>
          <p>
            A little less admin. A lot more progress.
            <br />
            Create professional quotations and invoices for the businesses you
            support.
          </p>
          <div className="login-features">
            {[
              [
                Building2,
                "Every business, organised",
                "Keep each client’s work in its own space.",
              ],
              [
                FileCheck2,
                "From quotation to invoice",
                "A simple flow from first quote to final document.",
              ],
              [
                Download,
                "Ready to share",
                "Beautiful PDFs with the right business identity.",
              ],
            ].map(([Icon, title, detail]) => {
              const I = Icon as typeof Building2;
              return (
                <div key={String(title)}>
                  <span>
                    <I size={20} />
                  </span>
                  <div>
                    <strong>{String(title)}</strong>
                    <small>{String(detail)}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <footer>
          © 2026 Africonnect Solutions. Built for the way we work.
        </footer>
      </section>
      <section className="login-form-area">
        <div className="login-card">
          <span className="login-symbol">
            <Layers3 size={27} />
          </span>
          <h2>Welcome back</h2>
          <p>Sign in to your invoicing workspace.</p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setError("");
              setBusy(true);
              try {
                await signIn(email, password);
                router.replace("/overview");
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            <Field label="Email address">
              <div className="input-icon">
                <Mail size={18} />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="you@africonnectsolutions.co.za"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </Field>
            <Field label="Password">
              <div className="input-icon">
                <LockKeyhole size={18} />
                <input
                  type={show ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </Field>
            {(configError || error) && (
              <div className="form-error" role="alert">
                {configError || error}
              </div>
            )}
            <Button type="submit" disabled={busy || !!configError}>
              {busy ? "Opening workspace…" : "Sign in"}
              <ArrowRight size={18} />
            </Button>
          </form>
          {local ? (
            <div className="demo-access">
              <strong>
                <span className="tiny-dot" /> Try the demo
              </strong>
              <p>
                Email: <b>user@africonnectsolutions.co.za</b>
                <br />
                Password: <b>User@2026</b>
              </p>
              <small>
                Demo access only. Records are stored in this browser; this is
                not production authentication.
              </small>
            </div>
          ) : (
            <p className="login-help">
              Use the account an Africonnect administrator set up for you.
              Forgotten your password? Ask an administrator to reset it.
            </p>
          )}
        </div>
        <p className="login-footnote">
          One connected ecosystem. Built by Africonnect.
        </p>
      </section>
    </main>
  );
}
