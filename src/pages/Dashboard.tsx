import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle,
  Clock3,
  Download,
  ExternalLink,
  Film,
  Image,
  Instagram,
  Languages,
  LayoutDashboard,
  Plus,
  Sparkles,
  Trash2,
  Video,
  Wand2,
  Youtube
} from "lucide-react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { apiFetch } from "../services/api";

interface DashboardProps {
  user: any;
}

interface FeatureCard {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  color: string;
  link: string;
  badge?: string;
  stat?: string;
}

export function Dashboard({ user }: DashboardProps) {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeatureCards, setShowFeatureCards] = useState(true);
  const [dashboardMessage, setDashboardMessage] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const hasActiveJob = (ad: any) =>
    ad?.latestJob && (ad.latestJob.status === "queued" || ad.latestJob.status === "processing");

  const getStatusBadge = (ad: any) => {
    if (hasActiveJob(ad)) {
      return {
        tone: "amber",
        label: `${ad.latestJob.type === "generate-video" ? "Generating video" : ad.latestJob.label || "Processing"}${typeof ad.latestJob.progress === "number" ? ` ${ad.latestJob.progress}%` : ""}`
      };
    }

    if (ad.status === "completed") {
      return { tone: "green", label: "Completed" };
    }

    if (ad.latestJob?.status === "failed") {
      return { tone: "red", label: "Needs attention" };
    }

    return { tone: "slate", label: String(ad.status || "draft").replace(/_/g, " ") };
  };

  const fetchAds = async () => {
    try {
      const res = await apiFetch(`/api/users/${user.id}/ads`);
      const data = await res.json();
      setAds(data);
      setDashboardError(null);
      setLoading(false);
    } catch (error) {
      console.error("Failed to fetch ads", error);
      setDashboardError("Failed to load your project list.");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAds();

    const interval = setInterval(() => {
      setAds((currentAds) => {
        if (currentAds.some((ad) => hasActiveJob(ad) || ad.status === "processing" || ad.status === "pending_generation")) {
          fetchAds();
        }
        return currentAds;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [user.id]);

  const handleDeleteAd = async (adId: string) => {
    if (!confirm("Are you sure you want to delete this ad?")) return;
    try {
      const response = await apiFetch(`/api/ads/${adId}`, { method: "DELETE" });
      if (response.ok) {
        setAds((prev) => prev.filter((ad) => ad.id !== adId));
        setDashboardMessage("Project deleted.");
        setDashboardError(null);
      } else {
        setDashboardError("Failed to delete project.");
      }
    } catch (error) {
      setDashboardError("Failed to delete project.");
    }
  };

  const handleGenerateVideo = async (adId: string) => {
    setAds((prev) =>
      prev.map((ad) =>
        ad.id === adId
          ? {
              ...ad,
              status: "processing",
              latestJob: {
                id: `pending-${adId}`,
                type: "generate-video",
                status: "queued",
                progress: 0,
                label: "Video generation queued"
              }
            }
          : ad
      )
    );
    try {
      const response = await apiFetch(`/api/ads/${adId}/generate-video`, { method: "POST" });
      const data = await response.json();

      if (!response.ok || data.error) {
        setDashboardError(data.error || "Failed to start generation");
        fetchAds();
        return;
      }
      setDashboardMessage("Video generation started. You can keep working while it finishes.");
      setDashboardError(null);
      fetchAds();
    } catch (error) {
      console.error("Generate video error:", error);
      setDashboardError("Failed to start generation");
      fetchAds();
    }
  };

  const featureCards: FeatureCard[] = [
    {
      id: "ads",
      icon: Video,
      title: "Create Ads",
      description: "Website to ad script, scenes, voice, visuals, and export-ready video.",
      color: "from-fuchsia-500 via-pink-500 to-rose-500",
      link: "/create?type=ad",
      badge: "Best for campaigns",
      stat: "16:9"
    },
    {
      id: "reels",
      icon: Instagram,
      title: "Create Reels",
      description: "Mobile-first shorts with stronger hooks, pacing, and vertical layouts.",
      color: "from-orange-500 via-pink-500 to-purple-500",
      link: "/create-reels",
      stat: "9:16"
    },
    {
      id: "youtube",
      icon: Youtube,
      title: "YouTube Video",
      description: "Long-form storytelling with structured scenes and cinematic continuity.",
      color: "from-red-500 via-orange-500 to-amber-500",
      link: "/create?type=youtube",
      stat: "Story mode"
    },
    {
      id: "story",
      icon: Sparkles,
      title: "Story Video",
      description: "Turn a title or plot idea into a cinematic story reel with realistic scene visuals.",
      color: "from-violet-500 via-fuchsia-500 to-pink-500",
      link: "/create?type=story",
      stat: "Cinematic"
    },
    {
      id: "images",
      icon: Image,
      title: "Image Ads",
      description: "Create editable banner creatives with product-led composition and copy.",
      color: "from-cyan-500 via-sky-500 to-indigo-500",
      link: "/create?type=image",
      stat: "Banner"
    }
  ];

  const projectMetrics = useMemo(() => {
    const completed = ads.filter((ad) => ad.status === "completed").length;
    const processing = ads.filter((ad) => hasActiveJob(ad) || ad.status === "processing").length;
    const drafts = ads.filter((ad) => !ad.video_url).length;
    return { total: ads.length, completed, processing, drafts };
  }, [ads]);

  const featuredProject = ads[0];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#f4f7fb_0%,_#ffffff_22%,_#eef2ff_100%)]">
      <div className="border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-700">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Creative command center
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
                Welcome back, {user.name.split(" ")[0]}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                Create new campaigns fast, monitor generation progress, and jump back into editing without losing momentum.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                to="/create?type=ad"
                className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 px-6 py-3 font-semibold text-white shadow-lg shadow-pink-500/20 transition hover:scale-[1.01]"
              >
                <Plus className="h-5 w-5" />
                New Ad
              </Link>
              <Link
                to="/create-reels"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:border-fuchsia-200 hover:bg-fuchsia-50"
              >
                <Film className="h-5 w-5 text-fuchsia-500" />
                New Reel
              </Link>
              <Link
                to="/create?type=story"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3 font-semibold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50"
              >
                <Sparkles className="h-5 w-5 text-violet-500" />
                New Story
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Projects", value: projectMetrics.total, note: "All creatives in your workspace", icon: Sparkles, tone: "from-fuchsia-500 to-pink-500" },
            { label: "Completed", value: projectMetrics.completed, note: "Ready to download or edit", icon: CheckCircle, tone: "from-emerald-500 to-teal-500" },
            { label: "In Progress", value: projectMetrics.processing, note: "Currently generating assets", icon: Clock3, tone: "from-amber-500 to-orange-500" },
            { label: "Localized", value: "EN / HI / MR", note: "Language-ready creation flow", icon: Languages, tone: "from-cyan-500 to-blue-500" }
          ].map((metric) => (
            <div key={metric.label} className="min-h-[156px] rounded-[1.6rem] border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-500">{metric.label}</div>
                  <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">{metric.note}</div>
                </div>
                <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${metric.tone} text-white shadow-md`}>
                  <metric.icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-[1.9rem] border border-slate-200 bg-[linear-gradient(135deg,_#12071f,_#23123b,_#101a37)] p-7 text-white shadow-[0_20px_60px_rgba(76,29,149,0.16)]">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                  <Wand2 className="h-3.5 w-3.5" />
                  Recommended next move
                </div>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                  Give users a fast first win.
                </h2>
                <p className="mt-4 text-sm leading-7 text-white/70">
                  The strongest conversion path is still simple: one idea, one language, one duration, then a visible preview. Keep that front and center.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {featureCards.slice(0, 2).map((card) => (
                  <Link
                    key={card.id}
                    to={card.link}
                    className="rounded-[1.5rem] border border-white/10 bg-white/8 p-4 transition hover:bg-white/12"
                  >
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${card.color} text-white shadow-lg`}>
                      <card.icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 text-lg font-semibold">{card.title}</div>
                    <div className="mt-2 text-sm leading-6 text-white/62">{card.description}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-[1.9rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-500">Featured Project</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">
                  {featuredProject?.business_name || "Create your first project"}
                </div>
              </div>
              {featuredProject && (
                <Link
                  to={`/editor/${featuredProject.id}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Open
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>

            {featuredProject ? (
              <div className="mt-5 space-y-4">
                <div className="aspect-video overflow-hidden rounded-[1.4rem] bg-slate-100">
                  {featuredProject.video_url ? (
                    featuredProject.type === "image" ? (
                      <img
                        src={featuredProject.video_url}
                        alt={featuredProject.business_name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <video
                        src={featuredProject.video_url}
                        className="h-full w-full object-cover"
                        muted
                        autoPlay
                        loop
                        playsInline
                      />
                    )
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.25),transparent_35%),linear-gradient(180deg,_#0f172a,_#1e1b4b)]">
                      <div className="rounded-full bg-white/15 p-4 text-white">
                        <Video className="h-8 w-8" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Status</div>
                    <div className="mt-2 font-semibold text-slate-800">{getStatusBadge(featuredProject).label}</div>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Type</div>
                    <div className="mt-2 font-semibold capitalize text-slate-800">{featuredProject.type || "video"}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-900">No creations yet</div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  Start with an ad or reel and this area becomes your quick-launch preview.
                </div>
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {showFeatureCards && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-10"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Create New Content</h2>
                  <p className="mt-1 text-sm text-slate-500">Choose the output that matches the channel you want to win on.</p>
                </div>
                <button onClick={() => setShowFeatureCards(false)} className="text-sm font-medium text-slate-500 transition hover:text-slate-800">
                  Hide
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {featureCards.map((card, index) => (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.08 }}
                  >
                    <Link
                      to={card.link}
                      className="group flex min-h-[230px] flex-col rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-fuchsia-200 hover:shadow-xl"
                    >
                      <div className="flex items-center justify-between">
                        <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${card.color} text-white shadow-lg`}>
                          <card.icon className="h-6 w-6" />
                        </div>
                        {card.badge && (
                          <div className="rounded-full bg-fuchsia-50 px-3 py-1 text-xs font-semibold text-fuchsia-700">
                            {card.badge}
                          </div>
                        )}
                      </div>
                      <div className="mt-5 flex items-center justify-between">
                        <h3 className="text-xl font-semibold text-slate-900">{card.title}</h3>
                        {card.stat && <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{card.stat}</span>}
                      </div>
                      <p className="mt-3 flex-1 text-sm leading-6 text-slate-500">{card.description}</p>
                      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-fuchsia-600 transition group-hover:gap-3">
                        Start now
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!showFeatureCards && (
          <button
            onClick={() => setShowFeatureCards(true)}
            className="mt-8 inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50 px-4 py-2 text-sm font-semibold text-fuchsia-700 transition hover:bg-fuchsia-100"
          >
            <Sparkles className="h-4 w-4" />
            Show creation options
          </button>
        )}

        <div className="mt-10">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Recent Projects</h2>
              <p className="mt-1 text-sm text-slate-500">Pick up where you left off or export finished work.</p>
            </div>
          </div>

          {dashboardError && (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {dashboardError}
            </div>
          )}

          {dashboardMessage && (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {dashboardMessage}
            </div>
          )}

          {loading ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="aspect-video animate-pulse rounded-[1.6rem] bg-slate-200" />
              ))}
            </div>
          ) : ads.length === 0 ? (
            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-16 text-center shadow-sm">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-100 to-pink-100">
                <Video className="h-10 w-10 text-fuchsia-500" />
              </div>
              <h3 className="mt-6 text-2xl font-semibold text-slate-900">No projects yet</h3>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-slate-500">
                Your workspace is ready. Create an ad, reel, YouTube video, or banner and we’ll turn this into a live campaign dashboard.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  to="/create?type=ad"
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 px-6 py-3 font-semibold text-white shadow-lg shadow-pink-500/20 transition hover:scale-[1.01]"
                >
                  Create your first ad
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/create-reels"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-3 font-semibold text-slate-700 transition hover:bg-slate-100"
                >
                  Create a reel
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {ads.map((ad, index) => {
                const statusBadge = getStatusBadge(ad);
                return (
                  <motion.div
                    key={ad.id}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.06 }}
                    className="group flex h-full flex-col overflow-hidden rounded-[1.7rem] border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:border-fuchsia-200 hover:shadow-xl"
                  >
                    <div className="relative aspect-video overflow-hidden bg-slate-100">
                      {ad.video_url ? (
                        ad.type === "image" ? (
                          <img
                            src={ad.video_url}
                            alt={ad.business_name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <video
                            src={ad.video_url}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                            muted
                            onMouseOver={(e) => (e.target as HTMLVideoElement).play()}
                            onMouseOut={(e) => {
                              const v = e.target as HTMLVideoElement;
                              v.pause();
                              v.currentTime = 0;
                            }}
                          />
                        )
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(217,70,239,0.22),transparent_35%),linear-gradient(180deg,_#e2e8f0,_#cbd5e1)]">
                          <div className="rounded-full bg-white/75 p-4 text-slate-500">
                            <Video className="h-7 w-7" />
                          </div>
                        </div>
                      )}

                      <div className="absolute left-4 top-4">
                        {statusBadge.tone === "amber" ? (
                          <div className="flex items-center gap-1.5 rounded-full bg-amber-100/95 px-3 py-1.5 text-xs font-semibold text-amber-700">
                            <Clock3 className="h-3.5 w-3.5 animate-spin" />
                            {statusBadge.label}
                          </div>
                        ) : statusBadge.tone === "green" ? (
                          <div className="flex items-center gap-1.5 rounded-full bg-emerald-100/95 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle className="h-3.5 w-3.5" />
                            {statusBadge.label}
                          </div>
                        ) : statusBadge.tone === "red" ? (
                          <div className="rounded-full bg-red-100/95 px-3 py-1.5 text-xs font-semibold text-red-700">
                            {statusBadge.label}
                          </div>
                        ) : (
                          <div className="rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                            {statusBadge.label}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">{ad.business_name}</h3>
                          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                            <ExternalLink className="h-3.5 w-3.5" />
                            {ad.website_url?.replace("https://", "").replace("http://", "").split("/")[0] || "AI project"}
                          </div>
                        </div>
                        <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                          {ad.type || "video"}
                        </div>
                      </div>

                      {ad.latestJob && (
                        <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                            <span className="font-medium text-slate-700">
                              {ad.latestJob.type === "generate-video"
                                ? "Latest video job"
                                : ad.latestJob.type === "render"
                                  ? "Latest render"
                                  : ad.latestJob.type === "voice"
                                    ? "Latest voice preview"
                                    : "Latest image generation"}
                            </span>
                            <span className="uppercase tracking-[0.16em]">{ad.latestJob.status}</span>
                          </div>
                          <div className="mt-1 text-sm text-slate-600">{ad.latestJob.label || "Working on your project"}</div>
                          {typeof ad.latestJob.progress === "number" && (
                            <>
                              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className={`h-full rounded-full ${
                                    ad.latestJob.status === "failed"
                                      ? "bg-red-500"
                                      : ad.latestJob.status === "completed"
                                        ? "bg-emerald-500"
                                        : "bg-gradient-to-r from-fuchsia-500 to-pink-500"
                                  }`}
                                  style={{ width: `${Math.max(6, Math.min(ad.latestJob.progress, 100))}%` }}
                                />
                              </div>
                              <div className="mt-1 text-right text-[11px] text-slate-400">{ad.latestJob.progress}%</div>
                            </>
                          )}
                        </div>
                      )}

                      <div className="mt-auto pt-5 flex gap-2">
                        {ad.video_url && ad.type !== "image" && (
                          <Link
                            to={`/editor/${ad.id}`}
                            className="flex-1 rounded-xl bg-fuchsia-50 px-4 py-2.5 text-center text-sm font-semibold text-fuchsia-700 transition hover:bg-fuchsia-100"
                          >
                            Edit Video
                          </Link>
                        )}
                        <button
                          onClick={() => {
                            if (ad.type === "image") {
                              const link = document.createElement("a");
                              link.href = ad.video_url || "#";
                              link.download = `${ad.business_name}-ad.png`;
                              link.click();
                            } else if (ad.video_url) {
                              window.open(ad.video_url, "_blank");
                            }
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                          disabled={!ad.video_url}
                        >
                          <Download className="h-4 w-4" />
                          Download
                        </button>
                        <button
                          onClick={() => handleDeleteAd(ad.id)}
                          className="rounded-xl p-2.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                          title="Delete ad"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {!ad.video_url && (
                        <button
                          onClick={() => handleGenerateVideo(ad.id)}
                          disabled={hasActiveJob(ad) || ad.status === "processing"}
                          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:from-fuchsia-500 hover:to-rose-500 disabled:opacity-50"
                        >
                          {hasActiveJob(ad) || ad.status === "processing" ? "Working..." : "Generate Video"}
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
