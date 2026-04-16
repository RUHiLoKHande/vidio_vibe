import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from 'fs';
import Database from "better-sqlite3";
import cors from "cors";
import multer from "multer";
import { VideoGenerator } from "./src/services/videoGenerator";
import { generateImageAds, regenerateSingleImage, ImageAdInput, ImageAdResult } from "./src/services/imageAdGenerator";
import { generateAdImage, getLastImageProviderMetadata } from "./src/services/gemini";
import { getS3ConfigStatus, isS3Configured, uploadBufferToS3, guessPublicS3Url, createSignedS3Url } from "./src/services/s3Storage";
import * as dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import axios from "axios";
import crypto from "crypto";

// Load .env.local if present
dotenv.config({ path: '.env.local' });
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = parseInt(process.env.PORT || "3005", 10);
  const db = new Database("vibe_studio.db");
  const FALLBACK_IMAGE_URL = '/uploads/_fallback/black_1280x720.jpg';
  const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
  const isProduction = process.env.NODE_ENV === "production";
  const demoLoginEmail = (process.env.DEMO_LOGIN_EMAIL || "demo@example.com").toLowerCase();
  const allowInsecureLocalAuth = process.env.ALLOW_INSECURE_LOCAL_AUTH === "true" || !isProduction;
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestCounters = new Map<string, { count: number; resetAt: number }>();

  app.set("trust proxy", 1);

  const stripAssetUrl = (value?: string) => (value || '').split('?')[0].split('#')[0];
  const makeRequestKey = (req: express.Request) => `${req.ip || 'unknown'}:${req.path}`;
  const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  const audioMimeTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg"]);

  const resolveUploadAssetPath = (assetUrl?: string) => {
    const normalized = stripAssetUrl(assetUrl);
    if (!normalized) return '';
    if (normalized.startsWith('/uploads/')) {
      return path.join(process.cwd(), 'public', normalized.replace(/^\//, ''));
    }
    return normalized;
  };

  const mirrorLocalFileToS3 = async (params: {
    localPath: string;
    key: string;
    contentType: string;
  }) => {
    if (!isS3Configured() || !params.localPath || !fs.existsSync(params.localPath)) {
      return null;
    }

    const body = fs.readFileSync(params.localPath);
    const uploaded = await uploadBufferToS3({
      key: params.key,
      body,
      contentType: params.contentType
    });

    let signedUrl = "";
    try {
      signedUrl = await createSignedS3Url(params.key);
    } catch (err: any) {
      console.warn(`[S3] Failed to create signed URL for ${params.key}:`, err?.message || err);
    }

    return {
      ...uploaded,
      publicUrl: guessPublicS3Url(params.key),
      signedUrl
    };
  };

  const buildScopedS3Key = (userId: string, adId: string, assetGroup: 'images' | 'audio' | 'video', filename: string) =>
    `users/${userId}/ads/${adId}/${assetGroup}/${filename}`;

  const inferContentType = (ad: any): "ads" | "reels" | "youtube" | "story" => {
    if (ad?.type === 'reels' || ad?.contentType === 'reels') return 'reels';
    if (ad?.type === 'youtube' || ad?.contentType === 'youtube') return 'youtube';
    if (ad?.type === 'story' || ad?.contentType === 'story') return 'story';
    return 'ads';
  };

  const normalizeEditorScene = async (scene: any, adId: string, index: number) => {
    const candidateImageUrls = [
      scene?.imageUrl,
      scene?.image,
      scene?.image_url,
      `/uploads/${adId}/${index + 1}.jpg`,
      `/uploads/${adId}/scene_${index}.jpg`,
      `/uploads/${adId}/scene_${index + 1}.jpg`,
    ].filter(Boolean);

    let finalImageUrl = '';
    let imageExists = false;
    const imageS3Key = scene?.imageS3Key || scene?.s3Key || scene?.s3?.key || '';

    if (imageS3Key && isS3Configured()) {
      try {
        finalImageUrl = await createSignedS3Url(imageS3Key);
        imageExists = true;
      } catch (err: any) {
        console.warn(`[SERVER] Failed to create signed scene image URL for ${adId}/${imageS3Key}:`, err?.message || err);
      }
    }

    for (const candidate of (imageExists ? [] : candidateImageUrls)) {
      const normalizedUrl = stripAssetUrl(candidate);
      const localPath = resolveUploadAssetPath(normalizedUrl);
      const exists = localPath ? fs.existsSync(localPath) : false;
      console.log(`[SERVER] Image validation: ${candidate} -> ${localPath || 'n/a'} = ${exists ? 'EXISTS' : 'MISSING'}`);
      if (exists) {
        finalImageUrl = normalizedUrl;
        imageExists = true;
        break;
      }
    }

    return {
      id: scene?.id || `scene_${index}`,
      imageUrl: imageExists ? finalImageUrl : FALLBACK_IMAGE_URL,
      imageLocalUrl: stripAssetUrl(scene?.imageUrl || scene?.image || ''),
      imageS3Key,
      image_prompt: scene?.image_prompt || scene?.imagePrompt || '',
      textOverlay: scene?.textOverlay || scene?.overlay || '',
      narration: scene?.narration || '',
      duration: Number(scene?.duration) > 0 ? Number(scene.duration) : 3,
      title: scene?.title || '',
      visual_description: scene?.visual_description || '',
      character_actions: scene?.character_actions || '',
      storyBeat: scene?.storyBeat || '',
      emotion: scene?.emotion || '',
      characters: Array.isArray(scene?.characters) ? scene.characters : [],
      transition: scene?.transition || '',
      sound_effects: Array.isArray(scene?.sound_effects) ? scene.sound_effects : [],
      image_variations: Array.isArray(scene?.image_variations) ? scene.image_variations : [],
      voice_hint: scene?.voice_hint || '',
      _imageExists: imageExists
    };
  };

  const buildAlignedImagePrompt = (scene: any, index: number, totalScenes: number, websiteUrl?: string) => {
    const narration = (scene?.narration || '').trim();
    const overlay = (scene?.textOverlay || scene?.overlay || '').trim();
    const basePrompt = (scene?.image_prompt || scene?.imagePrompt || '').trim();
    const sceneRole = (scene?.storyBeat || (index === 0 ? 'hook' : index === totalScenes - 1 ? 'cta' : 'core message')).trim();
    const websiteHint = websiteUrl ? `Website/brand destination: ${websiteUrl}.` : '';

    return [
      scene?.title ? `Scene title: ${scene.title}.` : '',
      basePrompt || `Professional advertisement scene ${index + 1}.`,
      `Scene role: ${sceneRole}.`,
      narration ? `Narration to match exactly: ${narration}.` : '',
      overlay ? `Overlay text to support visually: ${overlay}.` : '',
      scene?.visual_description ? `Visual continuity note: ${scene.visual_description}.` : '',
      scene?.character_actions ? `Character action: ${scene.character_actions}.` : '',
      Array.isArray(scene?.characters) && scene.characters.length > 0 ? `Keep these characters visually consistent: ${scene.characters.join(', ')}.` : '',
      scene?.emotion ? `Target emotion: ${scene.emotion}.` : '',
      'Maintain brand consistency, product focus, ad-style composition, cinematic lighting, realistic commercial photography, clean background, no unrelated objects.',
      index === totalScenes - 1
        ? `Final CTA scene with strong product focus, clear conversion intent, visible call to action, and space for website text. ${websiteHint}`
        : 'Single clear visual idea that directly supports the narration and keeps continuity with the surrounding scenes.'
    ].filter(Boolean).join(' ');
  };

  const serializeEditorScene = (scene: any, index: number) => ({
    id: scene?.id || `scene_${index}`,
    title: scene?.title || '',
    imageUrl: stripAssetUrl(scene?.imageLocalUrl || scene?.imageUrl || scene?.image || ''),
    imageS3Key: scene?.imageS3Key || scene?.s3Key || scene?.s3?.key || '',
    textOverlay: scene?.textOverlay || scene?.overlay || '',
    narration: scene?.narration || '',
    duration: Number(scene?.duration) > 0 ? Number(scene.duration) : 3,
    image_prompt: scene?.image_prompt || scene?.imagePrompt || '',
    visual_description: scene?.visual_description || '',
    character_actions: scene?.character_actions || '',
    storyBeat: scene?.storyBeat || '',
    emotion: scene?.emotion || '',
    characters: Array.isArray(scene?.characters) ? scene.characters : [],
    transition: scene?.transition || '',
    sound_effects: Array.isArray(scene?.sound_effects) ? scene.sound_effects : [],
    image_variations: Array.isArray(scene?.image_variations) ? scene.image_variations : [],
    voice_hint: scene?.voice_hint || ''
  });

  const createSessionToken = () => crypto.randomBytes(32).toString('hex');

  const createJobId = () => uuidv4();
  const createUsageEventId = () => uuidv4();

  const issueSession = (userId: string) => {
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
      .run(token, userId, expiresAt);

    return { token, expiresAt };
  };

  const getSessionUser = (token?: string) => {
    if (!token) return null;

    const session = db.prepare(`
      SELECT sessions.token, sessions.user_id, sessions.expires_at, users.email, users.name
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token = ?
    `).get(token) as any;

    if (!session) return null;

    if (new Date(session.expires_at).getTime() < Date.now()) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      return null;
    }

    return {
      token: session.token,
      userId: session.user_id,
      email: session.email,
      name: session.name
    };
  };

  const applySecurityHeaders = (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };

  const basicRateLimit = (limit: number, windowMs: number) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const key = makeRequestKey(req);
      const now = Date.now();
      const current = requestCounters.get(key);

      if (!current || current.resetAt <= now) {
        requestCounters.set(key, { count: 1, resetAt: now + windowMs });
        next();
        return;
      }

      current.count += 1;
      requestCounters.set(key, current);

      if (current.count > limit) {
        res.status(429).json({ error: "Too many requests. Please slow down and try again." });
        return;
      }

      next();
    };

  const getBearerToken = (req: express.Request) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return '';
    return header.slice('Bearer '.length).trim();
  };

  const requireAuth = (req: express.Request, res: express.Response) => {
    const token = getBearerToken(req);
    const sessionUser = getSessionUser(token);

    if (!sessionUser) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }

    return sessionUser;
  };

  const requireAdOwnership = (req: express.Request, res: express.Response, adId: string) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return null;

    const ad = db.prepare("SELECT * FROM ads WHERE id = ?").get(adId) as any;
    if (!ad) {
      res.status(404).json({ error: "Ad not found" });
      return null;
    }

    if (ad.user_id !== sessionUser.userId) {
      res.status(403).json({ error: "Forbidden" });
      return null;
    }

    return { sessionUser, ad };
  };

  const MAX_VIDEO_PROJECTS_PER_USER = 2;

  const isVideoProjectPayload = (type?: string, contentType?: string) => {
    if (contentType === 'image-ads' || type === 'image') {
      return false;
    }

    return true;
  };

  const getCreatedVideoProjectCount = (userId: string) => {
    const row = db.prepare(`
      SELECT COUNT(*) as total
      FROM ads
      WHERE user_id = ? AND COALESCE(type, 'video') != 'image'
    `).get(userId) as { total?: number } | undefined;

    return Number(row?.total || 0);
  };

  const createJob = (params: {
    adId?: string;
    userId: string;
    type: 'render' | 'voice' | 'images' | 'generate-video';
    status?: 'queued' | 'processing' | 'completed' | 'failed';
    progress?: number;
    label?: string;
    payload?: Record<string, any>;
  }) => {
    const jobId = createJobId();
    db.prepare(`
      INSERT INTO jobs (id, ad_id, user_id, type, status, progress, label, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      jobId,
      params.adId || null,
      params.userId,
      params.type,
      params.status || 'queued',
      params.progress ?? 0,
      params.label || '',
      params.payload ? JSON.stringify(params.payload) : null
    );

    return jobId;
  };

  const updateJob = (
    jobId: string,
    patch: {
      status?: 'queued' | 'processing' | 'completed' | 'failed';
      progress?: number;
      label?: string;
      error?: string | null;
      result?: Record<string, any> | null;
    }
  ) => {
    const existing = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as any;
    if (!existing) return;

    db.prepare(`
      UPDATE jobs
      SET status = ?, progress = ?, label = ?, error = ?, result = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      patch.status || existing.status,
      patch.progress ?? existing.progress,
      patch.label ?? existing.label,
      patch.error === undefined ? existing.error : patch.error,
      patch.result === undefined
        ? existing.result
        : patch.result
          ? JSON.stringify(patch.result)
          : null,
      jobId
    );
  };

  const recordUsage = (params: {
    userId: string;
    adId?: string | null;
    eventType:
      | 'project_created'
      | 'draft_saved'
      | 'voice_preview_generated'
      | 'voice_confirmed'
      | 'images_generated'
      | 'scene_image_uploaded'
      | 'music_uploaded'
      | 'render_completed'
      | 'video_generation_requested';
    units?: number;
    metadata?: Record<string, any>;
  }) => {
    const eventId = createUsageEventId();
    const eventDate = new Date().toISOString().slice(0, 10);
    const units = Number.isFinite(params.units) ? Number(params.units) : 1;

    db.prepare(`
      INSERT INTO usage_events (id, user_id, ad_id, event_type, units, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      eventId,
      params.userId,
      params.adId || null,
      params.eventType,
      units,
      params.metadata ? JSON.stringify(params.metadata) : null
    );

    db.prepare(`
      INSERT INTO usage_daily (user_id, event_date, event_type, events_count, units_total, updated_at)
      VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, event_date, event_type)
      DO UPDATE SET
        events_count = usage_daily.events_count + 1,
        units_total = usage_daily.units_total + excluded.units_total,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      params.userId,
      eventDate,
      params.eventType,
      units
    );
  };

  const getAdHandler = async (req: express.Request, res: express.Response) => {
    const adId = req.params.id;
    console.log(`[SERVER] Fetching ad with ID: ${adId}`);
    
    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      const ad = owned.ad;
      if (!ad) {
        console.log(`[SERVER] Ad not found: ${adId}`);
        res.status(404).json({ error: "Ad not found" });
        return;
      }
      
      console.log(`[SERVER] Ad found:`, ad.id, ad.type, ad.status);
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', adId);
      let scenes: any[] = [];
      let parsedScript = null;
      
      try {
        parsedScript = JSON.parse(ad.script);
        if (parsedScript?.scenes && Array.isArray(parsedScript.scenes)) {
          scenes = await Promise.all(
            parsedScript.scenes.map((scene: any, index: number) => normalizeEditorScene(scene, adId, index))
          );
          scenes.forEach(scene => {
            console.log(`[SERVER] Scene ${scene.id}: imageUrl=${scene.imageUrl}, exists=${scene._imageExists}`);
          });
        }
      } catch (e) {
        console.log(`[SERVER] Could not parse script, trying to load from uploads folder`);
      }
      
      if (scenes.length === 0 && fs.existsSync(uploadDir)) {
        const files = fs.readdirSync(uploadDir);
        const imageFiles = files
          .filter(f => /\.(jpg|jpeg|png)$/i.test(f))
          .filter(f => !f.startsWith('raw_') && !f.startsWith('gen_raw_') && !f.startsWith('scene_proc_'))
          .sort();
        
        console.log(`[SERVER] Found image files in ${uploadDir}:`, imageFiles);
        
        scenes = imageFiles.slice(0, 12).map((filename, index) => ({
          id: `scene_${index}`,
          imageUrl: `/uploads/${adId}/${filename}`,
          image_prompt: '',
          textOverlay: '',
          narration: '',
          duration: 3,
          _imageExists: true
        }));
      }
      
      let resolvedVideoUrl = ad.video_url;
      let resolvedVoiceoverPath = ad.voiceover_path;

      if (ad.video_s3_key && isS3Configured()) {
        try {
          resolvedVideoUrl = await createSignedS3Url(ad.video_s3_key);
        } catch (err: any) {
          console.warn(`[SERVER] Failed to create signed video URL for ${adId}:`, err?.message || err);
        }
      }

      if (ad.voiceover_s3_key && isS3Configured()) {
        try {
          resolvedVoiceoverPath = await createSignedS3Url(ad.voiceover_s3_key);
        } catch (err: any) {
          console.warn(`[SERVER] Failed to create signed voiceover URL for ${adId}:`, err?.message || err);
        }
      }

      res.json({
        ...ad,
        video_url: resolvedVideoUrl,
        voiceover_path: resolvedVoiceoverPath,
        scenes,
        parsedScript,
        capabilities: {
          selectableVoices: Boolean(process.env.ELEVENLABS_API_KEY)
        }
      });
    } catch (err) {
      console.error(`Failed to get ad ${adId}:`, err);
      res.status(500).json({ error: "Failed to get ad" });
    }
  };

  // Initialize DB
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      ad_id TEXT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER DEFAULT 0,
      label TEXT,
      payload TEXT,
      result TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(ad_id) REFERENCES ads(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS brand_kits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      business_name TEXT,
      website_url TEXT,
      description TEXT,
      target_audience TEXT,
      services TEXT,
      brand_colors TEXT,
      preferred_language TEXT,
      preferred_voice TEXT,
      preferred_tone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ad_id TEXT,
      event_type TEXT NOT NULL,
      units INTEGER DEFAULT 1,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(ad_id) REFERENCES ads(id)
    );
    CREATE TABLE IF NOT EXISTS usage_daily (
      user_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      events_count INTEGER DEFAULT 0,
      units_total INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, event_date, event_type),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS ads (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      website_url TEXT,
      business_name TEXT,
      script TEXT,
      video_url TEXT,
      voiceover_path TEXT,
      status TEXT,
      type TEXT DEFAULT 'video',
      duration INTEGER DEFAULT 15,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
  
  try { db.exec("ALTER TABLE ads ADD COLUMN video_url TEXT;"); } catch (e) { /* ignore if exists */ }
  try { db.exec("ALTER TABLE ads ADD COLUMN voiceover_path TEXT;"); } catch (e) { /* ignore if exists */ }
  try { db.exec("ALTER TABLE ads ADD COLUMN video_s3_key TEXT;"); } catch (e) { /* ignore if exists */ }
  try { db.exec("ALTER TABLE ads ADD COLUMN voiceover_s3_key TEXT;"); } catch (e) { /* ignore if exists */ }
  try { db.exec("ALTER TABLE ads ADD COLUMN duration INTEGER DEFAULT 15;"); } catch (e) { /* ignore if exists */ }
  try { db.exec("ALTER TABLE ads ADD COLUMN generation_mode TEXT DEFAULT 'basic'"); } catch (e) { /* ignore if exists */ }

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || !isProduction || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    }
  }));
  app.use(applySecurityHeaders);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));


// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const adId = req.params.id;
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', adId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const sceneIndex = req.query.sceneIndex as string;
    const ext = path.extname(file.originalname);
    if (sceneIndex !== undefined) {
      cb(null, `scene_${sceneIndex}${ext}`);
    } else {
      cb(null, `custom_music${ext}`);
    }
  }
});
  const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!imageMimeTypes.has(file.mimetype)) {
        cb(new Error("Only JPG, PNG, and WEBP images are allowed."));
        return;
      }
      cb(null, true);
    }
  });
  const bannerProductUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'banner-products');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        cb(null, `${uuidv4()}${path.extname(file.originalname) || '.png'}`);
      }
    }),
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!imageMimeTypes.has(file.mimetype)) {
        cb(new Error("Only JPG, PNG, and WEBP images are allowed."));
        return;
      }
      cb(null, true);
    }
  });
  const musicUpload = multer({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!audioMimeTypes.has(file.mimetype)) {
        cb(new Error("Only MP3, WAV, AAC, M4A, and OGG audio files are allowed."));
        return;
      }
      cb(null, true);
    }
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      environment: isProduction ? "production" : "development",
      insecureLocalAuth: allowInsecureLocalAuth,
      storage: {
        localUploads: true,
        s3: getS3ConfigStatus()
      }
    });
  });

  app.get("/api/storage/status", (req, res) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;

    res.json({
      storage: {
        localUploads: true,
        s3: getS3ConfigStatus()
      }
    });
  });

  // Mock Auth (since Firebase failed, we'll use a simple local auth for demo)
  app.post("/api/auth/login", basicRateLimit(20, 60_000), (req, res) => {
    const { email, name } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedName = typeof name === "string" && name.trim() ? name.trim() : normalizedEmail.split("@")[0] || "User";

    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      res.status(400).json({ error: "Valid email is required." });
      return;
    }

    if (!allowInsecureLocalAuth && normalizedEmail !== demoLoginEmail) {
      res.status(403).json({
        error: "Local email login is disabled in production. Use the demo login or configure real authentication first."
      });
      return;
    }

    const id = Buffer.from(normalizedEmail).toString('base64');
    db.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run(id, normalizedEmail, normalizedName);
    db.prepare("UPDATE users SET name = ?, email = ? WHERE id = ?").run(normalizedName, normalizedEmail, id);
    const session = issueSession(id);
    res.json({ id, email: normalizedEmail, name: normalizedName, sessionToken: session.token, sessionExpiresAt: session.expiresAt });
  });

  app.get("/api/users/:userId/ads", (req, res) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;

    if (req.params.userId !== sessionUser.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const ads = db.prepare("SELECT * FROM ads WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId) as any[];
    const adsWithJobs = ads.map((ad) => {
      const latestJob = db.prepare("SELECT * FROM jobs WHERE ad_id = ? ORDER BY created_at DESC LIMIT 1").get(ad.id) as any;
      return {
        ...ad,
        latestJob: latestJob
          ? {
              ...latestJob,
              payload: latestJob.payload ? JSON.parse(latestJob.payload) : null,
              result: latestJob.result ? JSON.parse(latestJob.result) : null
            }
          : null
      };
    });
    res.json(adsWithJobs);
  });

  app.get("/api/jobs/:id", (req, res) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;

    const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id) as any;
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (job.user_id !== sessionUser.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.json({
      ...job,
      payload: job.payload ? JSON.parse(job.payload) : null,
      result: job.result ? JSON.parse(job.result) : null
    });
  });

  app.get("/api/ads/:id/jobs", (req, res) => {
    const owned = requireAdOwnership(req, res, req.params.id);
    if (!owned) return;

    const jobs = db.prepare("SELECT * FROM jobs WHERE ad_id = ? ORDER BY created_at DESC").all(req.params.id) as any[];
    res.json(jobs.map((job) => ({
      ...job,
      payload: job.payload ? JSON.parse(job.payload) : null,
      result: job.result ? JSON.parse(job.result) : null
    })));
  });

  app.get("/api/usage/summary", (req, res) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;
    const usedVideoProjects = getCreatedVideoProjectCount(sessionUser.userId);

    const totals = db.prepare(`
      SELECT event_type, SUM(events_count) as events_count, SUM(units_total) as units_total
      FROM usage_daily
      WHERE user_id = ?
      GROUP BY event_type
    `).all(sessionUser.userId) as any[];

    const last30Days = db.prepare(`
      SELECT event_type, SUM(events_count) as events_count, SUM(units_total) as units_total
      FROM usage_daily
      WHERE user_id = ? AND event_date >= date('now', '-29 day')
      GROUP BY event_type
    `).all(sessionUser.userId) as any[];

    const today = db.prepare(`
      SELECT event_type, events_count, units_total
      FROM usage_daily
      WHERE user_id = ? AND event_date = date('now')
    `).all(sessionUser.userId) as any[];

    const recentEvents = db.prepare(`
      SELECT id, ad_id, event_type, units, metadata, created_at
      FROM usage_events
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 20
    `).all(sessionUser.userId) as any[];

    res.json({
      userId: sessionUser.userId,
      limits: {
        maxVideoProjects: MAX_VIDEO_PROJECTS_PER_USER,
        usedVideoProjects,
        remainingVideoProjects: Math.max(0, MAX_VIDEO_PROJECTS_PER_USER - usedVideoProjects)
      },
      totals,
      last30Days,
      today,
      recentEvents: recentEvents.map((event) => ({
        ...event,
        metadata: event.metadata ? JSON.parse(event.metadata) : null
      }))
    });
  });

  app.get("/api/brand-kits", (req, res) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;

    const kits = db.prepare("SELECT * FROM brand_kits WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC").all(sessionUser.userId) as any[];
    res.json(kits.map((kit) => ({
      ...kit,
      services: kit.services ? JSON.parse(kit.services) : [],
      brandColors: kit.brand_colors ? JSON.parse(kit.brand_colors) : []
    })));
  });

  app.post("/api/brand-kits", (req, res) => {
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;

    const {
      id,
      name,
      businessName,
      websiteUrl,
      description,
      targetAudience,
      services,
      brandColors,
      preferredLanguage,
      preferredVoice,
      preferredTone
    } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: "Brand kit name is required" });
      return;
    }

    const brandKitId = id || uuidv4();
    const existing = db.prepare("SELECT id FROM brand_kits WHERE id = ? AND user_id = ?").get(brandKitId, sessionUser.userId) as any;

    const payload = [
      sessionUser.userId,
      name,
      businessName || '',
      websiteUrl || '',
      description || '',
      targetAudience || '',
      JSON.stringify(Array.isArray(services) ? services : []),
      JSON.stringify(Array.isArray(brandColors) ? brandColors : []),
      preferredLanguage || 'english',
      preferredVoice || 'male',
      preferredTone || ''
    ];

    if (existing) {
      db.prepare(`
        UPDATE brand_kits
        SET name = ?, business_name = ?, website_url = ?, description = ?, target_audience = ?,
            services = ?, brand_colors = ?, preferred_language = ?, preferred_voice = ?, preferred_tone = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(
        name,
        businessName || '',
        websiteUrl || '',
        description || '',
        targetAudience || '',
        JSON.stringify(Array.isArray(services) ? services : []),
        JSON.stringify(Array.isArray(brandColors) ? brandColors : []),
        preferredLanguage || 'english',
        preferredVoice || 'male',
        preferredTone || '',
        brandKitId,
        sessionUser.userId
      );
    } else {
      db.prepare(`
        INSERT INTO brand_kits (
          id, user_id, name, business_name, website_url, description, target_audience,
          services, brand_colors, preferred_language, preferred_voice, preferred_tone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        brandKitId,
        ...payload
      );
    }

    const saved = db.prepare("SELECT * FROM brand_kits WHERE id = ? AND user_id = ?").get(brandKitId, sessionUser.userId) as any;
    res.json({
      success: true,
      brandKit: {
        ...saved,
        services: saved?.services ? JSON.parse(saved.services) : [],
        brandColors: saved?.brand_colors ? JSON.parse(saved.brand_colors) : []
      }
    });
  });

  app.delete("/api/ads/:id", (req, res) => {
    const adId = req.params.id;
    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      db.prepare("DELETE FROM ads WHERE id = ?").run(adId);
      res.json({ success: true });
    } catch (err) {
      console.error(`Failed to delete ad ${adId}:`, err);
      res.status(500).json({ error: "Failed to delete ad" });
    }
  });

  // Get ad data for editor
  app.get("/api/ad/:id", getAdHandler);
  app.get("/api/projects/:id", getAdHandler);

  // Upload scene image
  app.post("/api/ads/:id/scene-image", upload.single('image'), (req, res) => {
    const adId = req.params.id;
    const sceneIndex = req.query.sceneIndex as string;

    const owned = requireAdOwnership(req, res, adId);
    if (!owned) return;
    
    if (!req.file) {
      res.status(400).json({ error: "No image file provided" });
      return;
    }
    
    const imageUrl = `/uploads/${adId}/${req.file.filename}`;
    const localPath = req.file.path;

    void (async () => {
      const s3 = await mirrorLocalFileToS3({
        localPath,
        key: buildScopedS3Key(owned.sessionUser.userId, adId, 'images', req.file!.filename),
        contentType: req.file!.mimetype || 'image/jpeg'
      });

      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'scene_image_uploaded',
        metadata: {
          filename: req.file!.filename,
          sceneIndex: sceneIndex !== undefined ? Number(sceneIndex) : null,
          s3Key: s3?.key || null
        }
      });

      res.json({ success: true, imageUrl, s3 });
    })().catch((err) => {
      console.error(`[SERVER] Failed to mirror scene image to S3 for ${adId}:`, err);
      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'scene_image_uploaded',
        metadata: {
          filename: req.file!.filename,
          sceneIndex: sceneIndex !== undefined ? Number(sceneIndex) : null,
          s3Error: err.message || 'S3 mirror failed'
        }
      });
      res.json({ success: true, imageUrl, s3: null, s3Warning: 'Upload stored locally, but S3 mirror failed.' });
    });
  });

  // Upload custom music
  app.post("/api/ads/:id/music", musicUpload.single('music'), (req, res) => {
    const adId = req.params.id;

    const owned = requireAdOwnership(req, res, adId);
    if (!owned) return;
    
    if (!req.file) {
      res.status(400).json({ error: "No music file provided" });
      return;
    }
    
    const musicUrl = `/uploads/${adId}/${req.file.filename}`;
    const localPath = req.file.path;

    void (async () => {
      const s3 = await mirrorLocalFileToS3({
        localPath,
        key: buildScopedS3Key(owned.sessionUser.userId, adId, 'audio', req.file!.filename),
        contentType: req.file!.mimetype || 'audio/mpeg'
      });

      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'music_uploaded',
        metadata: {
          filename: req.file!.filename,
          s3Key: s3?.key || null
        }
      });
      res.json({ success: true, musicUrl, s3 });
    })().catch((err) => {
      console.error(`[SERVER] Failed to mirror music to S3 for ${adId}:`, err);
      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'music_uploaded',
        metadata: {
          filename: req.file!.filename,
          s3Error: err.message || 'S3 mirror failed'
        }
      });
      res.json({ success: true, musicUrl, s3: null, s3Warning: 'Music stored locally, but S3 mirror failed.' });
    });
  });

  app.post("/api/ads", (req, res) => {
    const { id, userId, websiteUrl, businessName, script, videoUrl, status, type, duration, generationMode, contentType } = req.body;
    const sessionUser = requireAuth(req, res);
    if (!sessionUser) return;
    
    // websiteUrl is required only for "ads" content type
    const isAdsContent = contentType === "ads" || type === "video";
    if (!businessName || !script || !userId || !id || (isAdsContent && !websiteUrl)) {
      res.status(400).json({ error: "Invalid input", details: { businessName, script, userId, id, websiteUrl, isAdsContent } });
      return;
    }

    if (userId !== sessionUser.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      if (isVideoProjectPayload(type, contentType)) {
        const usedVideoProjects = getCreatedVideoProjectCount(userId);
        if (usedVideoProjects >= MAX_VIDEO_PROJECTS_PER_USER) {
          res.status(403).json({
            error: `You have reached the beta limit of ${MAX_VIDEO_PROJECTS_PER_USER} videos per user.`,
            code: 'video_limit_reached',
            limits: {
              maxVideoProjects: MAX_VIDEO_PROJECTS_PER_USER,
              usedVideoProjects,
              remainingVideoProjects: 0
            }
          });
          return;
        }
      }

      // Ensure user exists to prevent FOREIGN KEY constraint failures
      db.prepare("INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)").run(userId, `${userId}@demo.com`, 'Demo User');

      db.prepare("INSERT INTO ads (id, user_id, website_url, business_name, script, video_url, status, type, duration, generation_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, userId, websiteUrl, businessName, script, videoUrl, status, type || 'video', duration || 15, generationMode || 'basic');
      recordUsage({
        userId,
        adId: id,
        eventType: 'project_created',
        metadata: {
          contentType: contentType || type || 'video',
          generationMode: generationMode || 'basic',
          duration: duration || 15
        }
      });
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to save ad" });
    }
  });

  app.patch("/api/ads/:id", (req, res) => {
    const adId = req.params.id;
    const { scenes, voiceSettings, musicSettings, language, websiteUrl } = req.body;

    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      const existingAd = owned.ad;

      const existingScript = existingAd?.script ? JSON.parse(existingAd.script) : {};
      const nextScript = {
        ...existingScript,
        language: language || existingScript.language || 'english',
        voiceSettings: voiceSettings || existingScript.voiceSettings || undefined,
        musicSettings: musicSettings || existingScript.musicSettings || undefined,
        scenes: Array.isArray(scenes)
          ? scenes.map((scene: any, index: number) => serializeEditorScene(scene, index))
          : existingScript.scenes || []
      };

      db.prepare("UPDATE ads SET script = ?, website_url = ? WHERE id = ?").run(
        JSON.stringify(nextScript),
        websiteUrl || existingAd.website_url || '',
        adId
      );

      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'draft_saved',
        units: Array.isArray(nextScript.scenes) ? nextScript.scenes.length : 1,
        metadata: {
          sceneCount: Array.isArray(nextScript.scenes) ? nextScript.scenes.length : 0,
          language: nextScript.language || 'english'
        }
      });

      res.json({ success: true, savedAt: Date.now() });
    } catch (err: any) {
      console.error(`[SERVER] Failed to save draft for ${adId}:`, err);
      res.status(500).json({ error: "Failed to save draft: " + err.message });
    }
  });

  app.post("/api/ads/:id/render", async (req, res) => {
    const adId = req.params.id;
    const { scenes, voiceSettings, musicSettings, websiteUrl, language } = req.body;
    let jobId = '';

    console.log(`[SERVER] === RENDER REQUEST ===`);
    console.log(`[SERVER] Ad ID: ${adId}`);
    console.log(`[SERVER] Scenes count: ${scenes?.length || 0}`);
    console.log(`[SERVER] Voice settings:`, voiceSettings);
    console.log(`[SERVER] Music settings:`, musicSettings);
    console.log(`[SERVER] Website URL:`, websiteUrl);

    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      jobId = createJob({
        adId,
        userId: owned.sessionUser.userId,
        type: 'render',
        status: 'processing',
        progress: 10,
        label: 'Preparing render request',
        payload: { sceneCount: Array.isArray(scenes) ? scenes.length : 0, language }
      });

      if (!Array.isArray(scenes) || scenes.length === 0) {
        updateJob(jobId, { status: 'failed', progress: 100, error: 'Missing scenes for render' });
        res.status(400).json({ error: "Missing scenes for render" });
        return;
      }

      db.prepare("UPDATE ads SET status = 'processing' WHERE id = ?").run(adId);
      const adRecord = owned.ad;
      
      // Get website URL from database if not provided in request
      let finalWebsiteUrl = websiteUrl;
      if (!finalWebsiteUrl) {
        finalWebsiteUrl = adRecord?.website_url;
      }
      
      const generator = new VideoGenerator(
        adId,
        adRecord?.script || "",
        adRecord?.duration || 15,
        inferContentType(adRecord)
      );
      updateJob(jobId, { progress: 35, label: 'Rendering final video assets' });
      const localVideoPath = await generator.renderEditedVideo(
        scenes,
        voiceSettings,
        musicSettings,
        finalWebsiteUrl,
        language,
        adRecord?.generation_mode || 'basic'
      );

      // Convert local path to URL path
      const videoUrl = localVideoPath.replace(/\\/g, '/').replace(/^.*\/public/, '');
      console.log(`[SERVER] Render completed, video URL: ${videoUrl}`);
      const localRenderedVideoPath = resolveUploadAssetPath(videoUrl);
      let s3Video: any = null;
      let s3Voiceover: any = null;

      try {
        if (localRenderedVideoPath) {
          s3Video = await mirrorLocalFileToS3({
            localPath: localRenderedVideoPath,
            key: buildScopedS3Key(owned.sessionUser.userId, adId, 'video', path.basename(localRenderedVideoPath)),
            contentType: 'video/mp4'
          });
        }
      } catch (s3Err: any) {
        console.warn(`[SERVER] Final render saved locally but S3 video mirror failed for ${adId}:`, s3Err.message);
      }

      try {
        const localVoiceoverPath = path.join(process.cwd(), 'public', 'uploads', adId, 'voiceover.mp3');
        if (fs.existsSync(localVoiceoverPath)) {
          s3Voiceover = await mirrorLocalFileToS3({
            localPath: localVoiceoverPath,
            key: buildScopedS3Key(owned.sessionUser.userId, adId, 'audio', 'voiceover.mp3'),
            contentType: 'audio/mpeg'
          });
        }
      } catch (s3Err: any) {
        console.warn(`[SERVER] Final render voiceover saved locally but S3 audio mirror failed for ${adId}:`, s3Err.message);
      }
      
      db.prepare("UPDATE ads SET video_url = ?, video_s3_key = ?, voiceover_s3_key = ?, status = 'completed' WHERE id = ?").run(
        videoUrl,
        s3Video?.key || null,
        s3Voiceover?.key || null,
        adId
      );
      try {
        const existingAd = db.prepare("SELECT script FROM ads WHERE id = ?").get(adId) as any;
        const existingScript = existingAd?.script ? JSON.parse(existingAd.script) : {};
        db.prepare("UPDATE ads SET script = ? WHERE id = ?").run(
          JSON.stringify({
            ...existingScript,
            language: language || existingScript.language || 'english',
            voiceSettings: voiceSettings || existingScript.voiceSettings || undefined,
            musicSettings: musicSettings || existingScript.musicSettings || undefined,
            scenes: scenes.map((scene: any, index: number) => serializeEditorScene(scene, index))
          }),
          adId
        );
      } catch (scriptUpdateErr) {
        console.warn(`[SERVER] Failed to persist updated scene script for ${adId}:`, scriptUpdateErr);
      }

      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'render_completed',
        units: Array.isArray(scenes) ? scenes.length : 1,
        metadata: {
          sceneCount: Array.isArray(scenes) ? scenes.length : 0,
          language: language || 'english',
          hasMusic: Boolean(musicSettings?.musicPath || musicSettings?.preset),
          videoUrl,
          s3VideoKey: s3Video?.key || null,
          s3VoiceoverKey: s3Voiceover?.key || null
        }
      });

      updateJob(jobId, {
        status: 'completed',
        progress: 100,
        label: 'Render completed',
        result: { videoUrl, s3Video, s3Voiceover }
      });

      res.json({ success: true, message: "Rendered successfully", videoUrl, s3Video, s3Voiceover, jobId });
    } catch (err: any) {
      console.error(`[SERVER] Failed editing video for ${adId}:`, err);
      db.prepare("UPDATE ads SET status = 'failed' WHERE id = ?").run(adId);
      if (jobId) {
        updateJob(jobId, { status: 'failed', progress: 100, error: err.message || 'Failed to render' });
      }
      res.status(500).json({ error: `Failed to render: ${err.message}` });
    }
  });

  app.post("/api/ads/:id/generate-video", async (req, res) => {
    const adId = req.params.id;
    const { generationMode, contentType } = req.body; // Can override mode and content type in request
    const owned = requireAdOwnership(req, res, adId);
    if (!owned) return;

    const ad = owned.ad;
    const resolvedContentType = contentType || inferContentType(ad);

    try {
      // Use generation mode from request or database
      const mode = generationMode || ad.generation_mode || 'basic';
      const jobId = createJob({
        adId,
        userId: owned.sessionUser.userId,
        type: 'generate-video',
        status: 'queued',
        progress: 0,
        label: 'Video generation queued',
        payload: { mode, contentType: resolvedContentType }
      });
      
      // MANDATORY DEBUG LOGGING
      console.log("\n" + "=".repeat(60));
      console.log("[SERVER] VIDEO GENERATION REQUEST");
      console.log("=".repeat(60));
      console.log(`[SERVER] Ad ID: ${adId}`);
      console.log(`[SERVER] Requested Mode: ${generationMode || 'not specified'}`);
      console.log(`[SERVER] Database Mode: ${ad.generation_mode || 'basic'}`);
      console.log(`[SERVER] Final Mode: ${mode}`);
      console.log(`[SERVER] ============================================`);

      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'video_generation_requested',
        metadata: {
          mode,
          contentType: resolvedContentType
        }
      });
      
      res.status(202).json({ message: "Video generation started", status: "queued", mode: mode, jobId });

      setTimeout(async () => {
        try {
          updateJob(jobId, { status: 'processing', progress: 15, label: 'Preparing video generator' });
          db.prepare("UPDATE ads SET status = 'processing' WHERE id = ?").run(adId);

          const generator = new VideoGenerator(ad.id, ad.script, ad.duration || 15, resolvedContentType);
          
          console.log("[SERVER] Calling video generator...");
          updateJob(jobId, { status: 'processing', progress: 45, label: 'Generating video assets' });
          const videoUrl = await generator.process(ad.website_url, mode);
          const localGeneratedVideoPath = resolveUploadAssetPath(videoUrl);
          let s3Video: any = null;
          let s3Voiceover: any = null;

          try {
            if (localGeneratedVideoPath) {
              s3Video = await mirrorLocalFileToS3({
                localPath: localGeneratedVideoPath,
                key: buildScopedS3Key(owned.sessionUser.userId, adId, 'video', path.basename(localGeneratedVideoPath)),
                contentType: 'video/mp4'
              });
            }
          } catch (s3Err: any) {
            console.warn(`[SERVER] Generated video saved locally but S3 mirror failed for ${adId}:`, s3Err.message);
          }

          try {
            const localVoiceoverPath = path.join(process.cwd(), 'public', 'uploads', adId, 'voiceover.mp3');
            if (fs.existsSync(localVoiceoverPath)) {
              s3Voiceover = await mirrorLocalFileToS3({
                localPath: localVoiceoverPath,
                key: buildScopedS3Key(owned.sessionUser.userId, adId, 'audio', 'voiceover.mp3'),
                contentType: 'audio/mpeg'
              });
            }
          } catch (s3Err: any) {
            console.warn(`[SERVER] Generated voiceover saved locally but S3 mirror failed for ${adId}:`, s3Err.message);
          }

          db.prepare("UPDATE ads SET video_url = ?, voiceover_path = ?, video_s3_key = ?, voiceover_s3_key = ?, status = 'completed' WHERE id = ?")
            .run(videoUrl, `/uploads/${adId}/voiceover.mp3`, s3Video?.key || null, s3Voiceover?.key || null, adId);

          updateJob(jobId, {
            status: 'completed',
            progress: 100,
            label: 'Video generation completed',
            result: { videoUrl, s3Video, s3Voiceover }
          });

          console.log("[SERVER] Video generation completed successfully!");
          console.log("=".repeat(60));
        } catch (err: any) {
          console.error("=".repeat(60));
          console.error("[SERVER] VIDEO GENERATION FAILED");
          console.error("=".repeat(60));
          console.error("[SERVER] Error:", err.message || err);
          console.error("[SERVER] Error Stack:", err.stack);
          console.error("=".repeat(60));
          
          db.prepare("UPDATE ads SET status = 'failed' WHERE id = ?").run(adId);
          updateJob(jobId, { status: 'failed', progress: 100, error: err.message || 'Failed generating video' });
          
          console.error(`[SERVER] Failed generating video for ${adId}:`, err.message);
        }
      }, 0);

    } catch (err: any) {
      console.error(`[SERVER] Failed queueing video generation for ${adId}:`, err.message);
      res.status(500).json({ error: `Failed to start video generation: ${err.message}` });
    }
  });

  // ============================================================
  // NEW: Complete Image Ads Generation Pipeline
  // Generates 4 high-quality advertisement images per request
  // ============================================================

  // Generate 4 Image Ads with Copy
  app.post("/api/image-ads/generate-multiple", async (req, res) => {
    const { idea, style, tone, aspectRatio, productImageUrl } = req.body;

    if (!idea || !style || !tone || !aspectRatio) {
      res.status(400).json({ 
        error: "Missing required fields: idea, style, tone, aspectRatio" 
      });
      return;
    }

    // Validate inputs
    const validStyles = ['modern', 'minimal', 'bold', 'corporate'];
    const validTones = ['professional', 'energetic', 'luxury'];
    const validRatios = ['1:1', '4:5', '9:16'];

    if (!validStyles.includes(style) || !validTones.includes(tone) || !validRatios.includes(aspectRatio)) {
      res.status(400).json({ 
        error: "Invalid parameters. style: modern|minimal|bold|corporate, tone: professional|energetic|luxury, aspectRatio: 1:1|4:5|9:16" 
      });
      return;
    }

    console.log('[SERVER] ============================================');
    console.log('[SERVER] Generating 4 Image Ads Pipeline');
    console.log('[SERVER] Input:', { idea, style, tone, aspectRatio });
    console.log('[SERVER] ============================================');

    try {
      const input: ImageAdInput = { idea, style, tone, aspectRatio, productImageUrl };
      const result = await generateImageAds(input);

      // Return structured response
      res.json({
        success: true,
        images: result.images.map(img => ({
          url: img.imageUrl,
          variation: img.variation,
          type: img.type
        })),
        banners: result.banners.map(img => ({
          url: img.imageUrl,
          variation: img.variation,
          type: img.type,
          banner: img.banner
        })),
        copy: {
          headline: result.copy.headline,
          subtext: result.copy.subtext,
          cta: result.copy.cta
        },
        prompts: result.prompts.map(p => ({
          variation: p.variation,
          type: p.type,
          prompt: p.prompt
        })),
        workDir: result.workDir
      });

      console.log('[SERVER] ============================================');
      console.log('[SERVER] Successfully generated 4 image ads!');
      console.log('[SERVER] ============================================');

    } catch (error: any) {
      console.error('[SERVER] Image ads generation failed:', error.message);
      res.status(500).json({ 
        error: "Failed to generate image ads: " + error.message 
      });
    }
  });

  // Regenerate single image
  app.post("/api/image-ads/regenerate", async (req, res) => {
    const { idea, style, tone, aspectRatio, variation, productImageUrl } = req.body;

    if (!idea || !variation) {
      res.status(400).json({ 
        error: "Missing required fields: idea, variation" 
      });
      return;
    }

    try {
      const input: ImageAdInput = { 
        idea, 
        style: style || 'modern', 
        tone: tone || 'professional', 
        aspectRatio: aspectRatio || '1:1',
        productImageUrl
      };
      
      const result = await regenerateSingleImage(input, variation);

      res.json({
        success: true,
        image: {
          url: result.imageUrl,
          variation: result.variation,
          type: result.type,
          banner: result.banner
        }
      });

    } catch (error: any) {
      console.error('[SERVER] Image regeneration failed:', error.message);
      res.status(500).json({ 
        error: "Failed to regenerate image: " + error.message 
      });
    }
  });

  app.post("/api/image-ads/upload-product", bannerProductUpload.single('product'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No product image uploaded" });
      return;
    }

    res.json({
      success: true,
      productImageUrl: `/uploads/banner-products/${req.file.filename}`
    });
  });

  // ============================================================
  // NEW: Save generated image to local filesystem
  // Handles both URL downloads and base64 data URLs
  // ============================================================
  app.post("/api/save-image", async (req, res) => {
    const { adId, index, imageUrl, imageData } = req.body;

    if (!adId || !index) {
      res.status(400).json({ error: "Missing required fields: adId, index" });
      return;
    }

    try {
      const sessionUser = requireAuth(req, res);
      if (!sessionUser) return;

      const existingAd = db.prepare("SELECT user_id FROM ads WHERE id = ?").get(adId) as any;
      if (existingAd && existingAd.user_id !== sessionUser.userId) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const uploadDir = path.join(process.cwd(), 'public', 'uploads', adId);
      
      // Ensure directory exists
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const filePath = path.join(uploadDir, `${index}.jpg`);

      // Check if imageData is provided (explicit base64)
      if (imageData) {
        const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        console.log(`[SERVER] Saved base64 imageData to: ${filePath}`);
      }
      // Check if imageUrl is actually a data URL (base64 encoded)
      else if (imageUrl && imageUrl.startsWith('data:')) {
        // This is a base64 data URL, not a regular URL
        const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        console.log(`[SERVER] Saved base64 data URL to: ${filePath}`);
      }
      // Otherwise, try to download from URL
      else if (imageUrl) {
        const response = await axios({
          url: imageUrl,
          responseType: 'arraybuffer',
          timeout: 60000,
        });
        
        fs.writeFileSync(filePath, Buffer.from(response.data));
        console.log(`[SERVER] Downloaded and saved image from: ${imageUrl} to ${filePath}`);
      } else {
        res.status(400).json({ error: "Missing imageUrl or imageData" });
        return;
      }

      // Verify the file was saved
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`[SERVER] Image saved successfully: ${filePath} (${stats.size} bytes)`);
      }

      const finalImageUrl = `/uploads/${adId}/${index}.jpg`;
      try {
        const s3 = await mirrorLocalFileToS3({
          localPath: filePath,
          key: buildScopedS3Key(sessionUser.userId, adId, 'images', `${index}.jpg`),
          contentType: 'image/jpeg'
        });
        res.json({ success: true, imageUrl: finalImageUrl, s3 });
      } catch (s3Err: any) {
        console.error("[SERVER] Image saved locally but S3 mirror failed:", s3Err.message);
        res.json({ success: true, imageUrl: finalImageUrl, s3: null, s3Warning: "Saved locally, but S3 mirror failed." });
      }
      
    } catch (err: any) {
      console.error("[SERVER] Failed to save image:", err.message);
      res.status(500).json({ error: "Failed to save image: " + err.message });
    }
  });

  // ============================================================
  // EXISTING: Generate Image Ad with text overlay
  // ============================================================
  app.post("/api/image-ads/generate", async (req, res) => {
    const { imageUrl, headline, cta, adId } = req.body;
    
    if (!imageUrl || !headline || !cta) {
      res.status(400).json({ error: "Missing required fields: imageUrl, headline, cta" });
      return;
    }
    
    try {
      const workDir = path.join(process.cwd(), 'public', 'uploads', adId || uuidv4());
      fs.mkdirSync(workDir, { recursive: true });
      
      // Download the generated image
      const imageResponse = await axios({
        url: imageUrl,
        responseType: 'arraybuffer',
        timeout: 60000,
      });
      
      const inputPath = path.join(workDir, 'raw_ad.jpg');
      fs.writeFileSync(inputPath, Buffer.from(imageResponse.data));
      
      // For now, just save the image - overlay will be done client-side
      // In production, you'd use sharp or canvas to add text overlay server-side
      const outputPath = path.join(workDir, 'final_ad_image.png');
      fs.writeFileSync(outputPath, Buffer.from(imageResponse.data));
      
      res.json({
        success: true,
        imageUrl: `/uploads/${path.basename(workDir)}/final_ad_image.png`,
        headline,
        cta
      });
      
    } catch (err: any) {
      console.error("Image ad generation failed:", err.message);
      res.status(500).json({ error: "Failed to generate image ad" });
    }
  });

  // ============================================================
  // NEW: Voice Preview API
  // Generates audio preview from scenes WITHOUT creating video
  // Used for previewing voice before final video generation
  // Generates per-scene audio files and combined preview
  // ============================================================
  app.post("/api/voice-preview", async (req, res) => {
    const { adId, scenes, voiceType, speed, language } = req.body;
    let jobId = '';
    
    if (!adId || !scenes || !Array.isArray(scenes) || scenes.length === 0) {
      res.status(400).json({ error: "Missing required fields: adId, scenes (array)" });
      return;
    }
    
    console.log(`[SERVER] === VOICE PREVIEW REQUEST ===`);
    console.log(`[SERVER] Ad ID: ${adId}`);
    console.log(`[SERVER] Scenes: ${scenes.length}`);
    console.log(`[SERVER] Voice Type: ${voiceType || 'male'}`);
    console.log(`[SERVER] Speed: ${speed || 1}`);
    
    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      jobId = createJob({
        adId,
        userId: owned.sessionUser.userId,
        type: 'voice',
        status: 'processing',
        progress: 10,
        label: 'Preparing voice preview',
        payload: { sceneCount: scenes.length, voiceType, speed, language }
      });

      const workDir = path.join(process.cwd(), 'public', 'uploads', adId);
      const adRecord = owned.ad;
      
      // Ensure directory exists
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }
      
      // Generate voice preview using VideoGenerator's per-scene audio
      const generator = new VideoGenerator(
        adId,
        adRecord?.script || "",
        adRecord?.duration || 15,
        inferContentType(adRecord)
      );
      generator.setLanguage(language);
      
      // Keep previews short so ElevenLabs remains usable even on lower credit balances.
      const previewLines = scenes
        .map((scene: any) => typeof scene?.narration === 'string' ? scene.narration.trim() : '')
        .filter(Boolean)
        .slice(0, 2);

      const previewNarration = previewLines
        .join('. ')
        .slice(0, 260)
        .trim();

      if (!previewNarration) {
        throw new Error('Voice preview requires at least one scene with narration.');
      }

      generator.setScript(previewNarration);

      updateJob(jobId, { progress: 55, label: 'Creating short voice preview sample' });
      const combinedAudioPath = await generator.generateTTS(voiceType || 'male', speed || 1, language);
      const combinedAudioUrl = combinedAudioPath.replace(/\\/g, '/').replace(/^.*\/public/, '');
      const audioUrls = combinedAudioUrl ? [combinedAudioUrl] : [];
      const localCombinedAudioPath = resolveUploadAssetPath(combinedAudioUrl);

      if (!combinedAudioUrl) {
        throw new Error('Voice preview could not generate any playable audio.');
      }

      let s3Audio: any = null;
      try {
        if (localCombinedAudioPath) {
          s3Audio = await mirrorLocalFileToS3({
            localPath: localCombinedAudioPath,
            key: buildScopedS3Key(owned.sessionUser.userId, adId, 'audio', path.basename(localCombinedAudioPath)),
            contentType: 'audio/mpeg'
          });
        }
      } catch (s3Err: any) {
        console.warn(`[SERVER] Voice preview saved locally but S3 mirror failed for ${adId}:`, s3Err.message);
      }

      try {
        db.prepare("UPDATE ads SET voiceover_path = ?, voiceover_s3_key = ? WHERE id = ?").run(
          combinedAudioUrl,
          s3Audio?.key || null,
          adId
        );
      } catch (voicePersistErr) {
        console.warn(`[SERVER] Failed to persist voice preview path for ${adId}:`, voicePersistErr);
      }
      
      console.log(`[SERVER] Voice preview generated from ${previewLines.length} preview line(s)`);
      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'voice_preview_generated',
        units: previewLines.length || 1,
        metadata: {
          sceneCount: scenes.length,
          previewLines: previewLines.length,
          voiceType: voiceType || 'male',
          speed: speed || 1,
          language: language || 'english',
          provider: generator.getLastAudioProvider(),
          s3Key: s3Audio?.key || null
        }
      });
      updateJob(jobId, {
        status: 'completed',
        progress: 100,
        label: 'Voice preview ready',
        result: {
          combinedAudioUrl,
          audioUrls,
          provider: generator.getLastAudioProvider(),
          providerMeta: generator.getLastAudioProviderMetadata(),
          s3Audio
        }
      });
      
      res.json({ 
        success: true, 
        audioUrls: audioUrls,
        combinedAudioUrl,
        provider: generator.getLastAudioProvider(),
        providerMeta: generator.getLastAudioProviderMetadata(),
        s3Audio,
        sceneCount: scenes.length,
        jobId
      });
      
    } catch (err: any) {
      console.error("[SERVER] Voice preview failed:", err.message);
      if (jobId) {
        updateJob(jobId, { status: 'failed', progress: 100, error: err.message || 'Failed to generate voice preview' });
      }
      res.status(500).json({ error: "Failed to generate voice preview: " + err.message });
    }
  });

  // Save voice selection (called after user confirms voice choice)
  // ============================================================
  app.post("/api/voice-confirm", async (req, res) => {
    const { adId, voiceType, speed, language } = req.body;
    
    if (!adId) {
      res.status(400).json({ error: "Missing required field: adId" });
      return;
    }
    
    console.log(`[SERVER] Voice confirmed for ad: ${adId}, voiceType: ${voiceType}, speed: ${speed}`);
    
    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      // Update the ad record with voice settings
      const stmt = db.prepare("UPDATE ads SET script = JSON_SET(COALESCE(script, '{}'), '$.voiceSettings', ?) WHERE id = ?");
      stmt.run(JSON.stringify({ voiceType, speed, language, confirmedAt: Date.now() }), adId);
      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'voice_confirmed',
        metadata: { voiceType, speed, language }
      });
      
      res.json({ success: true });
    } catch (err: any) {
      console.error("[SERVER] Voice confirm failed:", err.message);
      res.status(500).json({ error: "Failed to confirm voice: " + err.message });
    }
  });

  // ============================================================
  // NEW: Generate Images API
  // Generates images AFTER script is finalized in editor
  // ============================================================
  app.post("/api/ads/:id/generate-images", async (req, res) => {
    const adId = req.params.id;
    const { scenes } = req.body;
    let jobId = '';
    
    if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
      res.status(400).json({ error: "Missing scenes array" });
      return;
    }
    
    console.log(`[SERVER] === GENERATE IMAGES REQUEST ===`);
    console.log(`[SERVER] Ad ID: ${adId}`);
    console.log(`[SERVER] Scenes: ${scenes.length}`);
    
    try {
      const owned = requireAdOwnership(req, res, adId);
      if (!owned) return;

      jobId = createJob({
        adId,
        userId: owned.sessionUser.userId,
        type: 'images',
        status: 'processing',
        progress: 10,
        label: 'Preparing image generation',
        payload: { sceneCount: scenes.length }
      });

      const existingAd = owned.ad;
      const websiteUrl = existingAd?.website_url || '';
      const workDir = path.join(process.cwd(), 'public', 'uploads', adId);
      
      // Ensure directory exists
      if (!fs.existsSync(workDir)) {
        fs.mkdirSync(workDir, { recursive: true });
      }
      
      updateJob(jobId, { progress: 45, label: 'Generating scene images' });
      const generatedImages = await Promise.all(
        scenes.map(async (scene: any, index: number) => {
          const imagePrompt = buildAlignedImagePrompt(scene, index, scenes.length, websiteUrl);
          console.log(`[SERVER] Generating image ${index + 1}: ${imagePrompt.substring(0, 50)}...`);

          try {
            const b64Image = await generateAdImage(imagePrompt);
            if (!b64Image) {
              return {
                index: index + 1,
                imageUrl: FALLBACK_IMAGE_URL
              };
            }

            const base64Data = b64Image.replace(/^data:image\/\w+;base64,/, "");
            const imgPath = path.join(workDir, `${index + 1}.jpg`);
            const buf = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(imgPath, buf);
            console.log(`[SERVER] Image ${index + 1} saved: ${imgPath}`);

            return {
              index: index + 1,
              imageUrl: `/uploads/${adId}/${index + 1}.jpg`
            };
          } catch (imgErr: any) {
            console.error(`[SERVER] Failed to generate image ${index + 1}:`, imgErr.message);
            return {
              index: index + 1,
              imageUrl: FALLBACK_IMAGE_URL
            };
          }
        })
      );

      try {
        const existingScript = existingAd?.script ? JSON.parse(existingAd.script) : {};
        const updatedScenes = scenes.map((scene: any, index: number) => {
          const generated = generatedImages.find(img => img.index === index + 1);
          return {
            ...scene,
            id: scene?.id || `scene_${index}`,
            imageUrl: generated?.imageUrl || stripAssetUrl(scene?.imageUrl || scene?.image || ''),
            image_prompt: buildAlignedImagePrompt(scene, index, scenes.length, websiteUrl),
            textOverlay: scene?.textOverlay || scene?.overlay || '',
            narration: scene?.narration || '',
            duration: Number(scene?.duration) > 0 ? Number(scene.duration) : 3
          };
        });

        db.prepare("UPDATE ads SET script = ? WHERE id = ?").run(
          JSON.stringify({
            ...existingScript,
            scenes: updatedScenes
          }),
          adId
        );
      } catch (scriptUpdateErr) {
        console.warn(`[SERVER] Failed to persist generated images for ${adId}:`, scriptUpdateErr);
      }

      recordUsage({
        userId: owned.sessionUser.userId,
        adId,
        eventType: 'images_generated',
        units: generatedImages.length,
        metadata: {
          sceneCount: scenes.length,
          fallbackCount: generatedImages.filter((image) => image.imageUrl === FALLBACK_IMAGE_URL).length
        }
      });

      updateJob(jobId, {
        status: 'completed',
        progress: 100,
        label: 'Scene images ready',
        result: {
          count: generatedImages.length,
          providerMeta: getLastImageProviderMetadata()
        }
      });
      
      res.json({ 
        success: true, 
        images: generatedImages,
        count: generatedImages.length,
        providerMeta: getLastImageProviderMetadata(),
        jobId
      });
      
    } catch (err: any) {
      console.error("[SERVER] Image generation failed:", err.message);
      if (jobId) {
        updateJob(jobId, { status: 'failed', progress: 100, error: err.message || 'Failed to generate images' });
      }
      res.status(500).json({ error: "Failed to generate images: " + err.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[SERVER] Unhandled request error:", error);

    if (error?.message?.includes("CORS")) {
      res.status(403).json({ error: "This origin is not allowed to access the API." });
      return;
    }

    if (error?.message?.includes("Only JPG") || error?.message?.includes("Only MP3")) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (error?.code === "LIMIT_FILE_SIZE") {
      res.status(400).json({ error: "Uploaded file is too large." });
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
