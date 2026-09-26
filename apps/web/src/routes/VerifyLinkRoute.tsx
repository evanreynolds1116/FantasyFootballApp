import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { verifySignIn, type VerifiedSession } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorMessage, LoginCard, NameStep, safeNext } from "../components/login/LoginCard";

/** Where the emailed link lands: /login/verify?t=… signs this browser in. */
export function VerifyLinkRoute() {
  const [params] = useSearchParams();
  const token = params.get("t");
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(token ? "" : "This sign-in link is incomplete.");
  const [needsName, setNeedsName] = useState<VerifiedSession | null>(null);
  // A link works once; React's dev double-effect mustn't spend it twice.
  const tried = useRef(false);

  useEffect(() => {
    if (!token || tried.current) return;
    tried.current = true;
    verifySignIn({ token })
      .then((verified) => {
        signIn({ token: verified.token, userId: verified.userId });
        if (verified.needsName) setNeedsName(verified);
        else navigate(safeNext(verified.next), { replace: true });
      })
      .catch((err) => setError(errorMessage(err, "Couldn't sign you in with this link.")));
  }, [token, signIn, navigate]);

  return (
    <LoginCard>
      {needsName ? (
        <NameStep token={needsName.token} suggested="" onDone={() => navigate(safeNext(needsName.next), { replace: true })} />
      ) : error ? (
        <>
          <div role="alert" className="text-[15px] font-semibold text-warn">
            {error}
          </div>
          <Link to="/login" className="flex h-12 items-center justify-center rounded-ctl border border-line font-semibold">
            Get a new code
          </Link>
        </>
      ) : (
        <div className="text-muted">Signing you in…</div>
      )}
    </LoginCard>
  );
}
