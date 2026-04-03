import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Lock, Mail, PlayCircle, Sparkles, User as UserIcon } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { AuthUser } from "../services/auth";
import {
  getFirebaseFriendlyError,
  signInWithFirebaseGoogle
} from "../services/firebase";
import { apiFetch } from "../services/api";

interface LoginProps {
  onLogin: (user: AuthUser) => void;
  user: AuthUser | null;
}

export function Login({ onLogin, user }: LoginProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = useMemo(() => searchParams.get("redirect") || "/dashboard", [searchParams]);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"google" | "demo" | "form" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, redirectTo]);

  const completeLogin = (userData: AuthUser) => {
    onLogin(userData);
    navigate(redirectTo);
  };

  const loginWithBackend = async (payload: { email: string; name: string }) => {
    const response = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const userData = await response.json();
    if (!response.ok || userData.error) {
      throw new Error(userData.error || "Unable to sign in right now");
    }
    return userData as AuthUser;
  };

  const ensureFirebaseSafeHost = () => {
    if (typeof window === "undefined") return false;
    if (window.location.hostname !== "127.0.0.1") return false;

    const safeUrl = new URL(window.location.href);
    safeUrl.hostname = "localhost";
    window.location.replace(safeUrl.toString());
    return true;
  };

  const handleGoogle = async () => {
    if (ensureFirebaseSafeHost()) return;
    setLoadingAction("google");
    setError("");
    try {
      const userData = await Promise.race([
        signInWithFirebaseGoogle(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Google sign-in took too long. Please try again or use email login.")), 15000)
        )
      ]);
      completeLogin(userData);
    } catch (err) {
      setError(getFirebaseFriendlyError(err));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDemoAccess = async () => {
    setLoadingAction("demo");
    setError("");
    try {
      const userData = await loginWithBackend({
        email: "demo@example.com",
        name: "Demo User"
      });
      completeLogin(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to continue as demo");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoadingAction("form");
    setError("");

    try {
      const resolvedName =
        (mode === "signup" ? name : "").trim() ||
        email.split("@")[0] ||
        "User";

      const userData = await loginWithBackend({
        email: email.trim(),
        name: resolvedName
      });
      completeLogin(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : getFirebaseFriendlyError(err));
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b1020] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(217,70,239,0.18),_transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.16),_transparent_24%),linear-gradient(180deg,_#0b1020_0%,_#0f1327_45%,_#0b1020_100%)]" />

      <div className="relative z-10 mx-auto grid min-h-screen max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_480px] lg:px-8">
        <div className="flex flex-col justify-center">
          <Link to="/" className="inline-flex w-fit items-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white">
            <PlayCircle className="h-4 w-4 text-fuchsia-300" />
            Back to landing
          </Link>

          <div className="mt-8 inline-flex w-fit items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-2 text-sm font-medium text-fuchsia-100">
            <Sparkles className="h-4 w-4 text-fuchsia-300" />
            Secure access to your creative workspace
          </div>

          <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-6xl">
            Sign in and keep every ad, reel, banner, and video in one place.
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-8 text-white/62">
            Use Google for the fastest entry, or create an account with email and password. Your projects stay connected to the same workflow after login.
          </p>

          <div className="mt-10 grid max-w-2xl gap-4 sm:grid-cols-3">
            {[
              { title: "Google sign-in", text: "Fastest way to enter the workspace." },
              { title: "Create account", text: "Start with email and password if preferred." },
              { title: "Firestore sync", text: "User profile is saved into your Firebase project." }
            ].map((item) => (
              <div key={item.title} className="rounded-[1.4rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                <div className="text-base font-semibold text-white">{item.title}</div>
                <div className="mt-2 text-sm leading-7 text-white/56">{item.text}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center">
          <div className="w-full rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.30)] backdrop-blur-2xl">
            <div className="mb-6 flex rounded-2xl bg-[#0d1324] p-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${mode === "login" ? "bg-white text-slate-900" : "text-white/65 hover:text-white"}`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition ${mode === "signup" ? "bg-white text-slate-900" : "text-white/65 hover:text-white"}`}
              >
                Create account
              </button>
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-[#0d1324] p-6">
              <div className="text-2xl font-semibold text-white">{mode === "login" ? "Welcome back" : "Create your account"}</div>
              <div className="mt-2 text-sm leading-7 text-white/56">
                {mode === "login" ? "Login to continue creating content." : "Create an account to save and manage your AI projects."}
              </div>

              {error && (
                <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  {error}
                </div>
              )}

              <div className="mt-6 grid gap-3">
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loadingAction === "google"}
                  className="inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-semibold text-slate-900 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loadingAction === "google" ? "Opening Google..." : "Continue with Google"}
                  <ArrowRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={handleDemoAccess}
                  disabled={loadingAction === "demo"}
                  className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-white/12 bg-white/5 px-5 py-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loadingAction === "demo" ? "Signing in..." : "Continue as Demo"}
                </button>
              </div>

              <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-white/30">
                <div className="h-px flex-1 bg-white/10" />
                Or use email
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <form className="space-y-4" onSubmit={handleSubmit}>
                {mode === "signup" && (
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-white/72">Full name</div>
                    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                      <UserIcon className="h-4 w-4 text-white/45" />
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="w-full bg-transparent text-white outline-none placeholder:text-white/35"
                        required={mode === "signup"}
                      />
                    </div>
                  </label>
                )}

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-white/72">Email</div>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <Mail className="h-4 w-4 text-white/45" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className="w-full bg-transparent text-white outline-none placeholder:text-white/35"
                      required
                    />
                  </div>
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-white/72">Password</div>
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <Lock className="h-4 w-4 text-white/45" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      className="w-full bg-transparent text-white outline-none placeholder:text-white/35"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="text-white/45 transition hover:text-white/75"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>

                <button
                  type="submit"
                  disabled={loadingAction === "form"}
                  className="inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 px-5 py-4 text-sm font-semibold text-white transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loadingAction === "form" ? "Please wait..." : mode === "login" ? "Login" : "Create account"}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </form>

              <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-white/55">
                Google sign-in needs <span className="text-white/80">localhost</span> added in Firebase authorized domains.
                Email login now uses the app's built-in session auth, so you can sign in here without Firebase email/password setup.
              </div>

              <div className="mt-5 text-center text-sm text-white/55">
                {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setMode(mode === "login" ? "signup" : "login");
                    setError("");
                  }}
                  className="font-semibold text-fuchsia-200 transition hover:text-white"
                >
                  {mode === "login" ? "Create one" : "Login instead"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
