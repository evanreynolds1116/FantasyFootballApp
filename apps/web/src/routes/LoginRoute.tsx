import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { getAuthConfig, startSignIn, verifySignIn, type VerifiedSession } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, FormError, inputClass, LoginCard, NameStep, primaryButton, safeNext } from "../components/login/LoginCard";

type Step = { kind: "email" } | { kind: "code"; email: string } | { kind: "name"; verified: VerifiedSession };

/**
 * Sign in with your email (SPEC FR-02: no passwords). We email a 6-digit
 * code and a link: type the code here, or open the link — the code is what
 * works on a phone where the link would open in a different browser.
 */
export function LoginRoute() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState<Step>({ kind: "email" });

  // Signed in already (and not mid-way through naming a new account).
  if (session && step.kind !== "name") return <Navigate to={next} replace />;

  const onVerified = (verified: VerifiedSession) => {
    signIn({ token: verified.token, userId: verified.userId });
    if (verified.needsName) setStep({ kind: "name", verified: { ...verified, next: verified.next ?? next } });
    else navigate(safeNext(verified.next ?? next), { replace: true });
  };

  return (
    <LoginCard>
      {step.kind === "email" && <EmailStep next={next} onSent={(email) => setStep({ kind: "code", email })} />}
      {step.kind === "code" && <CodeStep email={step.email} next={next} onVerified={onVerified} onBack={() => setStep({ kind: "email" })} />}
      {step.kind === "name" && (
        <NameStep token={step.verified.token} suggested="" onDone={() => navigate(safeNext(step.verified.next), { replace: true })} />
      )}
    </LoginCard>
  );
}

function EmailStep({ next, onSent }: { next: string; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [devLoginOn, setDevLoginOn] = useState(false);

  useEffect(() => {
    void getAuthConfig().then((c) => setDevLoginOn(c.devLogin));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return setError("Enter your email address.");
    setBusy(true);
    setError("");
    try {
      await startSignIn(trimmed, next);
      onSent(trimmed);
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the email. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[15px] text-muted">Sign in with your email. We&apos;ll send you a code — no password.</p>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" autoFocus className={inputClass} />
        </label>
        <FormError message={error} />
        <button type="submit" disabled={busy} className={primaryButton}>
          {busy ? "Sending…" : "Email me a code"}
        </button>
      </form>
      {devLoginOn && <DevLogin next={next} />}
    </>
  );
}

function CodeStep({ email, next, onVerified, onBack }: { email: string; next: string; onVerified: (v: VerifiedSession) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const verify = async (value: string) => {
    setBusy(true);
    setError("");
    try {
      onVerified(await verifySignIn({ email, code: value }));
    } catch (err) {
      setError(errorMessage(err, "Couldn't check the code. Try again."));
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    setNote("");
    try {
      await startSignIn(email, next);
      setCode("");
      setNote("New code sent. Use the newest email.");
    } catch (err) {
      setError(errorMessage(err, "Couldn't send the email. Try again."));
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-[15px]">
        We emailed a 6-digit code to <span className="font-semibold">{email}</span>. Type it here, or open the link in the email.
      </p>
      <label className="flex flex-col gap-1.5 text-sm text-muted">
        Code
        <input
          value={code}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            if (digits.length === 6 && !busy) void verify(digits);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="123456"
          className={`${inputClass} font-display text-2xl tracking-[0.3em]`}
        />
      </label>
      <FormError message={error} />
      {note && <div className="text-sm text-muted">{note}</div>}
      <button type="submit" disabled={busy || code.length !== 6} className={primaryButton}>
        {busy ? "Checking…" : "Sign in"}
      </button>
      <div className="flex justify-between text-sm font-semibold">
        <button type="button" onClick={onBack} className="text-muted hover:text-text">
          Use a different email
        </button>
        <button type="button" onClick={() => void resend()} className="text-muted hover:text-text">
          Send a new code
        </button>
      </div>
      <p className="text-[13px] text-muted">Not there? Check spam. Codes expire after 15 minutes.</p>
    </form>
  );
}

/** Local testing only: shown when the server has DEV_LOGIN on. No check — anyone can be anyone. */
function DevLogin({ next }: { next: string }) {
  const { devLogin } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    try {
      await devLogin(name.trim(), email.trim() || undefined);
      navigate(next, { replace: true });
    } catch {
      setError("Could not start a dev session.");
    }
  };

  return (
    <details className="rounded-ctl border border-dashed border-line px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold text-muted">Developer login (testing only)</summary>
      <form onSubmit={submit} className="mt-3 flex flex-col gap-2">
        <input aria-label="Dev name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <input aria-label="Dev email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        <FormError message={error} />
        <button type="submit" className="h-10 rounded-ctl border border-line font-semibold">
          Continue without checking
        </button>
      </form>
    </details>
  );
}
