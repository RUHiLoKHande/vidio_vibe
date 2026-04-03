import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Video, Loader2, Wand2, Sparkles, Check, Play, Volume2, Music, Clock, Zap, Palette } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { generateReelsScript, SUPPORTED_LANGUAGES, type AdScript, type SupportedLanguage } from "../services/gemini";
import { apiFetch } from "../services/api";

interface CreateReelProps {
  user: any;
}

export function CreateReel({ user }: CreateReelProps) {
  const navigate = useNavigate();
  
  // Reels-specific state
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState(15);
  const [reelsMode, setReelsMode] = useState<"realistic" | "image">("image");
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>("english");
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [adScript, setAdScript] = useState<AdScript | null>(null);
  
  // Voice settings
  const [voiceType, setVoiceType] = useState<"male" | "female" | "energetic">("female");
  const [voiceSpeed, setVoiceSpeed] = useState(1);
  
  // Music settings
  const [bgMusic, setBgMusic] = useState<"none" | "upbeat" | "calm" | "trending">("upbeat");

  const buildReelScenes = (script: AdScript) =>
    (script.scenes || []).map((scene, index) => ({
      id: `scene_${index}`,
      imageUrl: '',
      image_prompt:
        scene.image_prompt ||
        `Vertical 9:16 composition, mobile format, portrait orientation, centered subject, professional lighting, advertisement style, ${scene.narration || topic}`,
      textOverlay: scene.overlay || '',
      narration: scene.narration || '',
      duration: scene.duration || 4
    }));
  
  const handleGenerateScript = async () => {
    if (!topic.trim()) return;
    
    setErrorMessage(null);
    setStatusMessage(null);
    setLoading(true);
    setLoadingText("Generating your Reel script with AI...");
    
    try {
      const script = await generateReelsScript(topic, duration, selectedLanguage);
      setAdScript(script);
    } catch (error) {
      console.error(error);
      setErrorMessage("Failed to generate script. Please try again.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };
  
  const handleCreateReel = async () => {
    if (!adScript || !topic.trim()) return;
    
    setErrorMessage(null);
    setStatusMessage("Opening your reel in the editor...");
    setLoading(true);
    setLoadingText("Saving your Reel...");
    
    try {
      // Generate unique ID for this reel
      const adId = uuidv4();
      const scenes = buildReelScenes(adScript);
      const initialVoiceSettings = {
        voiceType,
        speed: voiceSpeed
      };
      const initialMusicSettings = {
        preset: bgMusic === 'trending' ? 'corporate' : bgMusic === 'none' ? 'corporate' : bgMusic,
        volume: bgMusic === 'none' ? 0 : 0.1
      };
      
      // Save to database
      const saveResponse = await apiFetch("/api/ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: adId,
          userId: user.id,
          websiteUrl: "",
          businessName: topic,
          script: JSON.stringify({
            ...adScript,
            language: selectedLanguage,
            scenes,
            voiceSettings: initialVoiceSettings,
            musicSettings: initialMusicSettings
          }),
          videoUrl: "",
          status: "pending",
          type: "reels",
          duration: duration,
          generationMode: reelsMode,
          contentType: "reels"
        })
      });

      if (!saveResponse.ok) {
        throw new Error("Failed to save reel");
      }

      if (scenes.some(scene => scene.narration?.trim())) {
        void apiFetch('/api/voice-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adId,
            scenes,
            voiceType,
            speed: voiceSpeed,
            language: selectedLanguage
          })
        }).catch((previewError) => {
          console.warn('[CreateReel] Failed to seed voice preview:', previewError);
        });
      }
      
      // Navigate to editor
      navigate(`/editor/${adId}`);
    } catch (error) {
      console.error(error);
      setErrorMessage("Failed to create reel. Please try again.");
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };
  
  // If script is generated, show preview
  if (adScript) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,_#fff7ed_0%,_#fff1f2_45%,_#faf5ff_100%)] px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <button 
            onClick={() => setAdScript(null)}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-6"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Reels Creator
          </button>
          
          <div className="overflow-hidden rounded-[2rem] border border-orange-100/80 bg-white shadow-[0_20px_60px_rgba(249,115,22,0.10)]">
            {/* Reels Preview Header */}
            <div className="bg-gradient-to-r from-orange-500 via-pink-500 to-fuchsia-500 p-7 text-white">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                  <Video className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">Your Reel Script</h2>
                  <p className="text-white/80">{duration}s • {adScript.scenes?.length || 0} scenes</p>
                </div>
              </div>
            </div>

            {(errorMessage || statusMessage) && (
              <div className={`mx-6 mt-6 rounded-2xl border px-4 py-3 text-sm ${
                errorMessage
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-orange-200 bg-orange-50 text-orange-700"
              }`}>
                {errorMessage || statusMessage}
              </div>
            )}
            
            {/* Scenes Preview */}
            <div className="p-6 space-y-4 max-h-[400px] overflow-y-auto">
              {adScript.scenes?.map((scene, i) => (
                <div key={i} className="flex gap-4 p-4 bg-gradient-to-r from-orange-50 to-pink-50 rounded-2xl">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-orange-600 uppercase">{scene.scene_type || (i === 0 ? "HOOK" : i === adScript.scenes!.length - 1 ? "CTA" : "CONTENT")}</span>
                      <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">{scene.duration}s</span>
                    </div>
                    <p className="text-sm font-medium text-slate-800 mb-1">{scene.narration}</p>
                    {scene.overlay && (
                      <p className="text-xs text-slate-500">📝 Overlay: {scene.overlay}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Voice & Music Settings */}
            <div className="p-6 border-t border-slate-100 space-y-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-500" />
                Voice & Music Settings
              </h3>
              
              {/* Voice Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Voice Type</label>
                <div className="flex gap-2">
                  {(["male", "female", "energetic"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setVoiceType(v)}
                      className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all ${
                        voiceType === v 
                          ? "bg-orange-500 text-white" 
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {v === "male" ? "👨 Male" : v === "female" ? "👩 Female" : "⚡ Energetic"}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Voice Speed */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Voice Speed</label>
                <div className="flex gap-2">
                  {[
                    { value: 0.8, label: "0.8x" },
                    { value: 1, label: "1x" },
                    { value: 1.2, label: "1.2x" }
                  ].map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setVoiceSpeed(s.value)}
                      className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-all ${
                        voiceSpeed === s.value 
                          ? "bg-orange-500 text-white" 
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Background Music */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Background Music</label>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { value: "none", label: "🔇 None" },
                    { value: "upbeat", label: "🎵 Upbeat" },
                    { value: "calm", label: "🌊 Calm" },
                    { value: "trending", label: "🔥 Trending" }
                  ] as const).map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setBgMusic(m.value)}
                      className={`py-2 px-3 rounded-xl text-xs font-medium transition-all ${
                        bgMusic === m.value 
                          ? "bg-pink-500 text-white" 
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Create Button */}
            <div className="p-6 border-t border-slate-100">
              <button 
                onClick={handleCreateReel}
                disabled={loading}
                className="w-full bg-gradient-to-r from-orange-500 to-pink-500 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-orange-500/25 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {loadingText || "Creating Reel..."}
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    Create My Reel
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // Initial Reels creation UI
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#fff7ed_0%,_#fff1f2_45%,_#faf5ff_100%)] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <button 
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-800 mb-6"
        >
          <ArrowLeft className="w-5 h-5" />
          Back to Dashboard
        </button>
        
        {/* Title */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-r from-orange-500 via-pink-500 to-fuchsia-500 shadow-lg shadow-orange-500/20">
            <Video className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-slate-800 mb-2">Create Instagram Reel</h1>
          <p className="mx-auto max-w-2xl text-slate-500">Make engaging reels with a cleaner guided flow for topic, language, mode, and editor handoff.</p>
        </div>
        
        {/* Reels Creation Card */}
        <div className="overflow-hidden rounded-[2rem] border border-orange-100/80 bg-white shadow-[0_20px_60px_rgba(249,115,22,0.10)]">
          <div className="p-8 space-y-6">
            {(errorMessage || statusMessage) && (
              <div className={`rounded-2xl border px-4 py-3 text-sm ${
                errorMessage
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-orange-200 bg-orange-50 text-orange-700"
              }`}>
                {errorMessage || statusMessage}
              </div>
            )}

            {/* Topic Input */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">
                📝 What is your reel about?
              </label>
              <input 
                type="text"
                placeholder="e.g., Top 5 productivity tips, Day in my life, Morning routine..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-5 py-4 rounded-2xl border-2 border-orange-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 focus:outline-none transition-all text-lg"
              />
            </div>
            
            {/* Duration Selector */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3">
                <Clock className="w-4 h-4 inline mr-1" />
                Reel Duration
              </label>
              <div className="flex gap-3">
                {[15, 30, 60].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDuration(d)}
                    className={`flex-1 py-3 px-4 rounded-2xl font-bold transition-all ${
                      duration === d
                        ? "bg-orange-500 text-white shadow-lg"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3">
                <Palette className="w-4 h-4 inline mr-1" />
                Select Language
              </label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage)}
                className="w-full px-5 py-4 rounded-2xl border-2 border-orange-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-100 focus:outline-none transition-all text-lg bg-white"
              >
                {SUPPORTED_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.label}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Mode Selector */}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-3">
                <Zap className="w-4 h-4 inline mr-1" />
                Generation Mode
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setReelsMode("realistic")}
                  className={`p-5 rounded-2xl border-2 transition-all text-left ${
                    reelsMode === "realistic" 
                      ? "border-orange-500 bg-orange-50 shadow-md" 
                      : "border-slate-200 hover:border-orange-300"
                  }`}
                >
                  <div className="text-3xl mb-2">🎬</div>
                  <div className="font-bold text-slate-800">Realistic</div>
                  <div className="text-xs text-slate-500 mt-1">AI Video (Veo 3)</div>
                  <div className="text-xs text-orange-600 mt-2">✨ Cinematic clips</div>
                </button>
                <button
                  type="button"
                  onClick={() => setReelsMode("image")}
                  className={`p-5 rounded-2xl border-2 transition-all text-left ${
                    reelsMode === "image" 
                      ? "border-pink-500 bg-pink-50 shadow-md" 
                      : "border-slate-200 hover:border-pink-300"
                  }`}
                >
                  <div className="text-3xl mb-2">🖼️</div>
                  <div className="font-bold text-slate-800">Image Mode</div>
                  <div className="text-xs text-slate-500 mt-1">Slideshow + Effects</div>
                  <div className="text-xs text-pink-600 mt-2">✨ Ken Burns effects</div>
                </button>
              </div>
            </div>
            
            {/* Generate Button */}
            <button 
              onClick={handleGenerateScript}
              disabled={loading || !topic.trim()}
              className="w-full bg-gradient-to-r from-orange-500 to-pink-500 text-white py-4 rounded-2xl font-bold text-lg hover:shadow-lg hover:shadow-orange-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-all"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {loadingText || "Generating Script..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate Script with AI
                </>
              )}
            </button>
          </div>
        </div>
        
        {/* Tips */}
        <div className="mt-6 p-4 bg-white/50 rounded-2xl">
          <h4 className="font-bold text-slate-700 mb-2">💡 Tips for viral reels:</h4>
          <ul className="text-sm text-slate-600 space-y-1">
            <li>• Start with a hook in the first 2 seconds</li>
            <li>• Keep points short and punchy</li>
            <li>• End with a clear call-to-action</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
