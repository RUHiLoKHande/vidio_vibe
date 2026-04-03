import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Image,
  Instagram,
  Languages,
  PlayCircle,
  Sparkles,
  Video,
  Wand2,
  Youtube
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../services/auth";

interface LandingProps {
  onLogin: (user: AuthUser) => void;
  user: any;
}

const contentModes = [
  {
    icon: Video,
    title: "Ads",
    description: "Generate conversion-focused video ads from a website or idea."
  },
  {
    icon: Instagram,
    title: "Reels",
    description: "Create vertical short-form content with stronger hooks and pacing."
  },
  {
    icon: Youtube,
    title: "YouTube",
    description: "Build longer story-driven videos with scene structure and editing."
  },
  {
    icon: Sparkles,
    title: "Story",
    description: "Turn a title or plot idea into a cinematic video with realistic scenes."
  },
  {
    icon: Image,
    title: "Banners",
    description: "Make editable ad creatives with product-first layouts."
  }
];

const previewSteps = [
  {
    step: "01",
    title: "Input",
    text: "Website, product image, or topic"
  },
  {
    step: "02",
    title: "AI Output",
    text: "Script, scenes, voice, and visuals"
  },
  {
    step: "03",
    title: "Editor",
    text: "Preview, adjust, and export"
  }
];

const trustPoints = [
  "Multi-language generation",
  "Scene-based editing",
  "Voice preview before render",
  "Ad, Reel, Story, YouTube, and Banner support"
];

const contentModeLinks: Record<string, string> = {
  Ads: "/create?type=ad",
  Reels: "/create-reels",
  Story: "/create?type=story",
  YouTube: "/create?type=youtube",
  Banners: "/image-ads"
};

const demoExamples = [
  {
    title: "Performance Ad Demo",
    type: "Ad",
    description: "Conversion-focused product creative with aligned voice, scenes, and export-ready pacing.",
    src: "/uploads/9f57c5a4-7be0-4772-9cd0-a871f8273f0c/final_ad.mp4",
    cta: "/create?type=ad"
  },
  {
    title: "Vertical Reel Demo",
    type: "Reel",
    description: "Short-form mobile storytelling with quick hooks, clean visuals, and vertical-first layout.",
    src: "/uploads/039fc832-97c1-4cef-9c52-2fac44017a15/final_ad.mp4",
    cta: "/create-reels"
  },
  {
    title: "Story Video Demo",
    type: "YouTube",
    description: "Longer-form AI video flow with script structure, scenes, narration, and final render.",
    src: "/uploads/1ab4f52f-23f8-4640-97c6-eb2145569174/final_ad.mp4",
    cta: "/create?type=youtube"
  }
];

export function Landing({ onLogin, user }: LandingProps) {
  const navigate = useNavigate();

  const goToRoute = (route: string) => {
    if (user) {
      navigate(route);
      return;
    }
    navigate(`/login?redirect=${encodeURIComponent(route)}`);
  };

  const goPrimary = () => {
    goToRoute("/dashboard");
  };

  return (
    <div className="min-h-screen bg-[#0b1020] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(217,70,239,0.18),_transparent_26%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.16),_transparent_24%),linear-gradient(180deg,_#0b1020_0%,_#0f1327_45%,_#0b1020_100%)]" />

      <div className="relative z-10 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-10 flex flex-col gap-4 rounded-[1.6rem] border border-white/10 bg-white/5 px-5 py-4 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-500 shadow-lg shadow-pink-500/20">
                <PlayCircle className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-lg font-semibold">VibeAI Ad Studio</div>
                <div className="text-sm text-white/55">AI creation for ads, reels, stories, YouTube, banners, and Firebase login</div>
              </div>
            </div>

            <button
              onClick={goPrimary}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-white/90"
            >
              {user ? "Open Dashboard" : "Sign In"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <section className="grid items-center gap-10 lg:grid-cols-[1fr_520px] lg:gap-16">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
              className="max-w-3xl"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-2 text-sm font-medium text-fuchsia-100">
                <Sparkles className="h-4 w-4 text-fuchsia-300" />
                AI-powered creation for performance marketing
              </div>

              <h1 className="mt-6 max-w-4xl text-5xl font-semibold leading-[1.02] tracking-tight text-white sm:text-6xl xl:text-7xl">
                Create content that looks
                <span className="bg-gradient-to-r from-fuchsia-400 via-pink-300 to-cyan-300 bg-clip-text text-transparent"> ready to launch </span>
                without the messy workflow.
              </h1>

              <p className="mt-6 max-w-2xl text-lg leading-8 text-white/66 sm:text-xl">
                Turn one idea into a script, voice preview, aligned visuals, and an editable final output from one clean workspace.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <button
                  onClick={goPrimary}
                  className="inline-flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 px-7 py-4 text-base font-semibold text-white shadow-2xl shadow-pink-500/20 transition hover:scale-[1.01]"
                >
                  {user ? "Go To Dashboard" : "Sign In With Google"}
                  <ArrowRight className="h-5 w-5" />
                </button>

                <button
                  onClick={() => goToRoute("/create?type=ad")}
                  className="inline-flex items-center justify-center gap-3 rounded-2xl border border-white/12 bg-white/5 px-7 py-4 text-base font-semibold text-white transition hover:bg-white/10"
                >
                  <Wand2 className="h-5 w-5 text-cyan-300" />
                  Explore Workflow
                </button>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                {trustPoints.map((item) => (
                  <div
                    key={item}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/72"
                  >
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="w-full"
            >
              <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.30)] backdrop-blur-2xl">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.28em] text-white/40">Product Preview</div>
                    <div className="mt-1 text-2xl font-semibold">Campaign Studio</div>
                  </div>
                  <div className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    Script ready
                  </div>
                </div>

                <div className="rounded-[1.6rem] border border-white/10 bg-[#0d1324] p-6">
                  <div className="rounded-[1.4rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-6">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Live workflow</div>
                    <div className="mt-3 max-w-sm text-3xl font-semibold leading-tight text-white">
                      One clean workspace for script, visuals, voice, and export.
                    </div>
                    <div className="mt-3 max-w-md text-sm leading-7 text-white/58">
                      A simpler creation flow that feels guided from first idea to final output.
                    </div>

                    <div className="mt-6 grid gap-4">
                      <div className="rounded-[1.2rem] bg-[linear-gradient(180deg,_rgba(255,255,255,0.14),_rgba(236,72,153,0.18)),linear-gradient(180deg,_#211934,_#4b204c)] p-5">
                        <div className="flex items-center justify-between">
                          <div className="rounded-full bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-900">
                            Editor View
                          </div>
                          <div className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/75">15s ad</div>
                        </div>

                        <div className="mt-16 text-center text-3xl font-semibold leading-tight text-white">
                          Smart ads.
                          <br />
                          Faster launches.
                        </div>

                        <button
                          onClick={() => goToRoute("/create?type=ad")}
                          className="mt-10 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition hover:bg-white/90"
                        >
                          Open Ad Workflow
                          <ArrowRight className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {previewSteps.map((item) => (
                          <div key={item.step} className="rounded-[1rem] border border-white/8 bg-white/[0.03] p-4">
                            <div className="text-[10px] uppercase tracking-[0.22em] text-fuchsia-200/80">{item.step}</div>
                            <div className="mt-2 text-sm font-semibold text-white">{item.title}</div>
                            <div className="mt-2 text-xs leading-6 text-white/55">{item.text}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </section>

          <section className="mt-16">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-2 text-sm font-medium text-fuchsia-100">
                  <PlayCircle className="h-4 w-4 text-fuchsia-300" />
                  Example Work
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">Show users what the product can already make.</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">
                  Real demo outputs help people trust the workflow faster than feature text alone.
                </p>
              </div>

              <button
                onClick={() => goToRoute("/dashboard")}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                Open Workspace
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-3">
              {demoExamples.map((example) => (
                <div key={example.title} className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-white/5 backdrop-blur-xl">
                  <div className="aspect-video bg-black">
                    <video
                      src={example.src}
                      className="h-full w-full object-cover"
                      muted
                      loop
                      playsInline
                      autoPlay
                    />
                  </div>

                  <div className="p-5">
                    <div className="inline-flex rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                      {example.type}
                    </div>
                    <div className="mt-3 text-xl font-semibold text-white">{example.title}</div>
                    <div className="mt-2 text-sm leading-7 text-white/58">{example.description}</div>

                    <button
                      onClick={() => goToRoute(example.cta)}
                      className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-fuchsia-200 transition hover:text-white"
                    >
                      Create something similar
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-16 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {contentModes.map((mode, index) => (
              <motion.div
                key={mode.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.08 }}
                className="rounded-[1.6rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white shadow-lg shadow-pink-500/20">
                  <mode.icon className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">{mode.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/62">{mode.description}</p>
                <button
                  onClick={() => goToRoute(contentModeLinks[mode.title])}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 transition hover:text-cyan-200"
                >
                  Open {mode.title}
                  <ArrowRight className="h-4 w-4" />
                </button>
              </motion.div>
            ))}
          </section>

          <section className="mt-16 rounded-[2rem] border border-white/10 bg-white/5 p-8 backdrop-blur-2xl lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100">
                  <Languages className="h-4 w-4" />
                  Built for fast, localized creation
                </div>
                <h2 className="mt-5 text-3xl font-semibold tracking-tight">Users should understand the product in seconds.</h2>
                <p className="mt-4 max-w-xl text-base leading-8 text-white/64">
                  The best first impression is a clear promise, a believable preview, and a workflow that feels easy to trust.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  {
                    title: "Localized output",
                    text: "Generate English, Hindi, and Marathi scripts and voice previews from the same flow."
                  },
                  {
                    title: "Real editing control",
                    text: "Adjust scenes, durations, visuals, and voice before the final output."
                  },
                  {
                    title: "Structured pipeline",
                    text: "Script, images, voice, and render stay connected instead of feeling separate."
                  },
                  {
                    title: "Faster launch flow",
                    text: "Ads, reels, YouTube, and banners all start from one familiar workspace."
                  }
                ].map((card) => (
                  <div key={card.title} className="rounded-[1.3rem] border border-white/10 bg-[#101728]/75 p-5">
                    <div className="text-lg font-semibold text-white">{card.title}</div>
                    <div className="mt-2 text-sm leading-7 text-white/58">{card.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <footer className="mt-16 border-t border-white/10 py-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-lg font-semibold text-white">VibeAI Ad Studio</div>
                <div className="mt-2 max-w-md text-sm leading-7 text-white/52">
                  Create ads, reels, YouTube videos, and banners from one clean AI workflow.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm">
                <button
                  onClick={() => goToRoute("/dashboard")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-white/72 transition hover:bg-white/10 hover:text-white"
                >
                  Dashboard
                </button>
                <button
                  onClick={() => goToRoute("/create?type=ad")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-white/72 transition hover:bg-white/10 hover:text-white"
                >
                  Create Ad
                </button>
                <button
                  onClick={() => goToRoute("/create-reels")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-white/72 transition hover:bg-white/10 hover:text-white"
                >
                  Create Reel
                </button>
                <button
                  onClick={() => goToRoute("/image-ads")}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-white/72 transition hover:bg-white/10 hover:text-white"
                >
                  Banner Studio
                </button>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-white/40 sm:flex-row sm:items-center sm:justify-between">
              <div>AI-powered creation for modern marketing teams.</div>
              <div>Ads, Reels, YouTube, Banners</div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
