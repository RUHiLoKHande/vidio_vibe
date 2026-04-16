import { exec, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import axios from 'axios';
import ffmpegStatic from 'ffmpeg-static';
import * as cheerio from 'cheerio';
import { generateAdImage, generateVeoVideo, generateVeoVideosForScenes, analyzeWebsite, createBrandStyle, buildBrandConsistentPrompt, BrandStyle, DEFAULT_BRAND_STYLE, getLanguageTtsCode, type SupportedLanguage } from './gemini.js';
import { generateLumaVideosForScenes, saveVideoBuffer } from './lumaVideo.js';
import { generateVeoVideosForScenes as generateVeoVideos } from './veoVideo.js';
import { generateReplicateVideosForScenes } from './replicateVideo.js';
import * as googleTTS from 'google-tts-api';
import { runWithProviderFallback, type ProviderExecutionMetadata } from './providerRuntime.js';

const execAsync = promisify(exec);
const EXTERNAL_HTTP_CONFIG = {
  proxy: false as const,
  headers: { "User-Agent": "Mozilla/5.0" }
};
const BROKEN_PROXY_MARKERS = ['127.0.0.1:9', 'localhost:9'];

function disableBrokenProxyEnv() {
  const proxyKeys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy'
  ];

  for (const key of proxyKeys) {
    const value = process.env[key];
    if (value && BROKEN_PROXY_MARKERS.some(marker => value.includes(marker))) {
      console.warn(`[NETWORK] Clearing broken proxy env ${key}=${value}`);
      delete process.env[key];
    }
  }
}

disableBrokenProxyEnv();

type VoiceProfile = {
  id: string;
  label: string;
  settings: { stability: number; similarity_boost: number; style?: number; use_speaker_boost?: boolean };
};

const ELEVENLABS_VOICE_MAP: Record<string, VoiceProfile> = {
  male: {
    id: "pNInz6obpgDQGcFmaJgB",
    label: "Adam - Firm Male",
    settings: { stability: 0.58, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true }
  },
  female: {
    id: "EXAVITQu4vr4xnSDxMaL",
    label: "Sarah - Confident Female",
    settings: { stability: 0.48, similarity_boost: 0.76, style: 0.24, use_speaker_boost: true }
  },
  energetic: {
    id: "TX3LPaxmHKxFdv7VOQHJ",
    label: "Liam - Energetic Creator",
    settings: { stability: 0.34, similarity_boost: 0.74, style: 0.72, use_speaker_boost: true }
  },
  warm: {
    id: "cgSgspJ2msm6clMCkdW9",
    label: "Jessica - Warm Conversational",
    settings: { stability: 0.42, similarity_boost: 0.7, style: 0.36, use_speaker_boost: true }
  },
  deep: {
    id: "nPczCjzI2devNBz1zQrb",
    label: "Brian - Deep Resonant",
    settings: { stability: 0.64, similarity_boost: 0.8, style: 0.14, use_speaker_boost: true }
  },
  calm: {
    id: "SAz9YHcvj6GT2YYXdXww",
    label: "River - Calm Neutral",
    settings: { stability: 0.72, similarity_boost: 0.72, style: 0.08, use_speaker_boost: true }
  },
  storyteller: {
    id: "JBFqnCBsd6RMkjVDRZzb",
    label: "George - Storyteller",
    settings: { stability: 0.52, similarity_boost: 0.76, style: 0.42, use_speaker_boost: true }
  },
  broadcaster: {
    id: "onwK4e9ZLuTAKqWW03F9",
    label: "Daniel - Broadcaster",
    settings: { stability: 0.74, similarity_boost: 0.82, style: 0.06, use_speaker_boost: true }
  },
  educator: {
    id: "Xb7hH8MSUJpSbSDYk0k2",
    label: "Alice - Educator",
    settings: { stability: 0.6, similarity_boost: 0.78, style: 0.16, use_speaker_boost: true }
  },
  classy: {
    id: "CwhRBWXzGAHq8TQ4Fs17",
    label: "Roger - Classy Casual",
    settings: { stability: 0.62, similarity_boost: 0.74, style: 0.2, use_speaker_boost: true }
  }
};

const LANGUAGE_VOICE_MAP: Record<SupportedLanguage, Record<string, VoiceProfile>> = {
  english: ELEVENLABS_VOICE_MAP,
  hindi: Object.fromEntries(Object.entries(ELEVENLABS_VOICE_MAP).map(([key, value]) => [key, { ...value, label: `${value.label} (Hindi)` }])),
  marathi: Object.fromEntries(Object.entries(ELEVENLABS_VOICE_MAP).map(([key, value]) => [key, { ...value, label: `${value.label} (Marathi)` }]))
};

function normalizeLanguage(language?: string): SupportedLanguage {
  if (language === 'hindi' || language === 'marathi') return language;
  return 'english';
}

function resolveVoiceProfile(language: SupportedLanguage = 'english', voiceType?: string) {
  const voiceMap = LANGUAGE_VOICE_MAP[language] || LANGUAGE_VOICE_MAP.english;
  return voiceMap[voiceType || 'male'] || LANGUAGE_VOICE_MAP.english[voiceType || 'male'] || LANGUAGE_VOICE_MAP.english.male;
}

function getFallbackVoiceCharacterFilters(voiceType?: string): string[] {
  switch (voiceType || 'male') {
    case 'female':
      return ['asetrate=44100*1.08', 'aresample=44100', 'atempo=0.96'];
    case 'energetic':
      return ['atempo=1.12', 'volume=1.4'];
    case 'warm':
      return ['equalizer=f=180:t=q:w=1.2:g=2', 'volume=1.15'];
    case 'deep':
      return ['asetrate=44100*0.88', 'aresample=44100', 'atempo=1.06', 'volume=1.2'];
    case 'calm':
      return ['atempo=0.94', 'volume=0.9'];
    case 'storyteller':
      return ['equalizer=f=220:t=q:w=1.3:g=2', 'volume=1.08'];
    case 'broadcaster':
      return ['equalizer=f=260:t=q:w=1.1:g=2', 'volume=1.1'];
    case 'educator':
      return ['atempo=0.98', 'equalizer=f=280:t=q:w=1.0:g=1.4'];
    case 'classy':
      return ['asetrate=44100*0.97', 'aresample=44100', 'atempo=1.02', 'volume=1.05'];
    case 'male':
    default:
      return ['asetrate=44100*0.94', 'aresample=44100', 'atempo=1.03'];
  }
}

function resolveFontFile(language: SupportedLanguage = 'english'): string {
  const candidates = language === 'english'
    ? ['C:\\Windows\\Fonts\\Arial.ttf', 'C:\\Windows\\Fonts\\segoeui.ttf', 'C:\\Windows\\Fonts\\Nirmala.ttf']
    : ['C:\\Windows\\Fonts\\Nirmala.ttf', 'C:\\Windows\\Fonts\\NirmalaS.ttf', 'C:\\Windows\\Fonts\\Mangal.ttf', 'C:\\Windows\\Fonts\\Aparaj.ttf', 'C:\\Windows\\Fonts\\Arial.ttf'];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function escapeDrawtextValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function getSubtitleStyleConfig(style: string | undefined, contentType: ContentType, width: number, height: number) {
  const normalized = style || 'cinematic';
  if (normalized === 'clean') {
    return {
      fontSize: contentType === 'reels' ? 36 : 40,
      y: contentType === 'reels' ? Math.round(height * 0.1) : Math.round(height * 0.16),
      boxColor: 'black@0.22',
      boxBorder: 6
    };
  }

  if (normalized === 'bold') {
    return {
      fontSize: contentType === 'reels' ? 48 : 56,
      y: contentType === 'reels' ? Math.round(height * 0.08) : Math.round(height * 0.2),
      boxColor: 'black@0.68',
      boxBorder: 14
    };
  }

  return {
    fontSize: contentType === 'reels' ? 42 : 48,
    y: contentType === 'reels' ? Math.round(height * 0.08) : Math.round(height * 0.22),
    boxColor: 'black@0.5',
    boxBorder: 10
  };
}

// ============================================================================
// FALLBACK IMAGE PATH - Used when image is missing
// ============================================================================
const FALLBACK_IMAGE_DIR = path.join(process.cwd(), 'public', 'uploads', '_fallback');

/**
 * Generate a fallback black image (1280x720) if it doesn't exist
 * This prevents FFmpeg crashes when images are missing
 */
function ensureFallbackImageExists(): string {
  const fallbackPath = path.join(FALLBACK_IMAGE_DIR, 'black_1280x720.jpg');
  
  if (!fs.existsSync(FALLBACK_IMAGE_DIR)) {
    fs.mkdirSync(FALLBACK_IMAGE_DIR, { recursive: true });
  }
  
  if (!fs.existsSync(fallbackPath)) {
    console.log('[FALLBACK IMAGE] Generating black 1280x720 fallback image...');
    // Use FFmpeg to create a black image
    if (ffmpegStatic) {
      const cmd = `"${ffmpegStatic}" -y -f lavfi -i color=c=black:s=1280x720:d=1 -frames:v 1 "${fallbackPath}"`;
      execSync(cmd);
      console.log('[FALLBACK IMAGE] Fallback image created:', fallbackPath);
    } else {
      // Create a minimal valid JPEG if FFmpeg is not available
      // This is a 1x1 black pixel JPEG
      const minimalJpeg = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
        0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
        0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
        0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
        0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
        0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
        0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
        0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
        0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
        0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
        0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
        0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
        0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
        0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
        0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
        0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
        0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
        0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
        0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
        0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
        0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
        0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
        0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
        0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20, 0xA8, 0xA2, 0x80, 0x0A,
        0xFF, 0xD9
      ]);
      fs.writeFileSync(fallbackPath, minimalJpeg);
      console.log('[FALLBACK IMAGE] Minimal fallback image created');
    }
  }
  
  return fallbackPath;
}

function getRenderDimensions(config: ContentConfig): { width: number; height: number } {
  return { width: config.width, height: config.height };
}

/**
 * Validate and resolve image path with fallback
 * Returns a valid local file path that is guaranteed to exist
 */
function resolveImagePath(
  imageUrl: string | undefined,
  sceneIndex: number,
  adId: string,
  workDir: string
): { path: string; isFallback: boolean; originalUrl: string } {
  // Default fallback image path
  const fallbackPath = ensureFallbackImageExists();
  
  // Handle undefined or empty imageUrl
  if (!imageUrl || imageUrl.trim() === '') {
    console.log(`[IMAGE RESOLVE] Scene ${sceneIndex}: No imageUrl provided, using fallback`);
    return { path: fallbackPath, isFallback: true, originalUrl: '' };
  }
  
  const sanitizedUrl = imageUrl.split('?')[0].split('#')[0];
  let localPath = sanitizedUrl;
  let isExternalUrl = sanitizedUrl.startsWith('http://') || sanitizedUrl.startsWith('https://');
  
  // Convert URL path to local filesystem path
  if (!isExternalUrl && sanitizedUrl.startsWith('/uploads/')) {
    localPath = path.join(process.cwd(), 'public', sanitizedUrl.replace(/^\//, ''));
  }
  
  console.log(`[IMAGE RESOLVE] Scene ${sceneIndex}:`);
  console.log(`[IMAGE RESOLVE]   Original URL: ${imageUrl}`);
  console.log(`[IMAGE RESOLVE]   Resolved path: ${localPath}`);
  console.log(`[IMAGE RESOLVE]   Is external: ${isExternalUrl}`);
  
  // Check if the file exists
  if (fs.existsSync(localPath)) {
    console.log(`[IMAGE RESOLVE]   Status: EXISTS ✓`);
    return { path: localPath, isFallback: false, originalUrl: sanitizedUrl };
  }
  
  // File doesn't exist - log warning and use fallback
  console.log(`[IMAGE RESOLVE]   Status: MISSING ✗`);
  console.log(`[IMAGE RESOLVE]   Using fallback image`);
  
  return { path: fallbackPath, isFallback: true, originalUrl: sanitizedUrl };
}

// ============================================================================
// CONTENT TYPE CONFIGURATION
// ============================================================================
// Centralized configuration for different content types
// Using ONE shared pipeline with different configurations

export type ContentType = 'ads' | 'reels' | 'youtube' | 'story';
export type GenerationMode = 'basic' | 'realistic';

export interface ContentConfig {
  aspectRatio: string;
  width: number;
  height: number;
  duration: number;
  style: string;
  minScenes: number;
  maxScenes: number;
  avgSceneDuration: number;
  description: string;
}

export const CONTENT_CONFIG: Record<ContentType, ContentConfig> = {
  ads: {
    aspectRatio: "16:9",
    width: 1280,
    height: 720,
    duration: 30,
    style: "marketing, product-focused, strong CTA, professional commercial",
    minScenes: 4,
    maxScenes: 6,
    avgSceneDuration: 6,
    description: "Video advertisement for marketing campaigns"
  },
  reels: {
    aspectRatio: "9:16",
    width: 720,
    height: 1280,
    duration: 15,
    style: "fast-paced, trendy, social media style, vertical video, engaging, scroll-stopping, high energy",
    minScenes: 3,
    maxScenes: 5,
    avgSceneDuration: 4,
    description: "Instagram Reels / Shorts content - 9:16 vertical, 10-15 sec, fast-paced with hook + quick points + CTA"
  },
  youtube: {
    aspectRatio: "16:9",
    width: 1280,
    height: 720,
    duration: 60,
    style: "storytelling, detailed, engaging, YouTube content, longer format",
    minScenes: 6,
    maxScenes: 10,
    avgSceneDuration: 7,
    description: "YouTube video content"
  },
  story: {
    aspectRatio: "16:9",
    width: 1280,
    height: 720,
    duration: 45,
    style: "cinematic storytelling, realistic scenes, emotional pacing, consistent characters",
    minScenes: 5,
    maxScenes: 9,
    avgSceneDuration: 6,
    description: "Story video content"
  }
};

/**
 * Get content configuration based on type
 */
export function getContentConfig(contentType: ContentType): ContentConfig {
  const config = CONTENT_CONFIG[contentType] || CONTENT_CONFIG.ads;
  console.log(`[CONTENT CONFIG] Selected type: ${contentType}`);
  console.log(`[CONTENT CONFIG] Aspect ratio: ${config.aspectRatio} (${config.width}x${config.height})`);
  console.log(`[CONTENT CONFIG] Duration: ${config.duration}s`);
  console.log(`[CONTENT CONFIG] Style: ${config.style}`);
  console.log(`[CONTENT CONFIG] Scenes: ${config.minScenes}-${config.maxScenes}`);
  return config;
}

/**
 * Get aspect ratio dimensions
 */
export function getAspectRatioDimensions(contentType: ContentType): { width: number; height: number } {
  return getContentConfig(contentType);
}

export interface ParsedScript {
  hook?: string;
  body?: string;
  cta?: string;
  visualPrompts?: string[];
  duration?: number;
  language?: SupportedLanguage;
  subtitleStyle?: 'cinematic' | 'clean' | 'bold';
  storyProfile?: {
    subtitleStyle?: 'cinematic' | 'clean' | 'bold';
    mainCharacterName?: string;
    mainCharacterLook?: string;
    musicMood?: string;
    style?: string;
  };
  scenes?: Array<{
    scene: number;
    duration: number;
    narration: string;
    overlay: string;
    image_prompt: string;
    video_prompt: string;
    brandStyle?: BrandStyle; // Store brand style for consistent image generation
  }>;
}

/**
 * STEP 1: SCENE SEGMENTATION
 * 
 * Split a script into logical scenes for video generation.
 * Each scene contains: scene number, narration, video prompt, and duration.
 * Uses contentType config to adjust scene count and style.
 * 
 * @param script - The full ad script text
 * @param totalDuration - Total desired duration in seconds (default: 30)
 * @param contentType - Content type: 'ads', 'reels', or 'youtube'
 * @returns Array of scene objects
 */
export function splitScriptIntoScenes(script: string, totalDuration: number = 30, contentType: ContentType = 'ads'): ParsedScript['scenes'] {
  // Get content configuration
  const config = getContentConfig(contentType);
  
  console.log('[SCENE SEGMENTATION] ============================================');
  console.log('[SCENE SEGMENTATION] Content type:', contentType);
  console.log('[SCENE SEGMENTATION] Input script:', script.substring(0, 100) + '...');
  console.log('[SCENE SEGMENTATION] Total duration:', totalDuration, 'seconds');
  console.log('[SCENE SEGMENTATION] Target scenes:', config.minScenes, '-', config.maxScenes);
  
  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(script);
    if (parsed.scenes && Array.isArray(parsed.scenes)) {
      console.log('[SCENE SEGMENTATION] Script already contains scene structure');
      // Enhance existing scenes with content type style
      return parsed.scenes.map(scene => ({
        ...scene,
        video_prompt: scene.video_prompt + ", " + config.style,
        image_prompt: scene.image_prompt + ", " + config.style
      }));
    }
  } catch {
    // Not JSON, continue with text parsing
  }
  
  // Clean and normalize the script
  const cleanedScript = script
    .replace(/Scene \d+:?/gi, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Split into sentences
  const sentences = cleanedScript.match(/[^.!?]+[.!?]*/g) || [cleanedScript];
  
  // Calculate number of scenes based on content type config
  const targetScenes = Math.max(config.minScenes, Math.min(config.maxScenes, Math.ceil(totalDuration / config.avgSceneDuration)));
  const sentencesPerScene = Math.ceil(sentences.length / targetScenes);
  
  const scenes: ParsedScript['scenes'] = [];
  const avgDuration = totalDuration / targetScenes;
  
  console.log('[SCENE SEGMENTATION] Creating', targetScenes, 'scenes');
  console.log('[SCENE SEGMENTATION] Average duration per scene:', avgDuration.toFixed(1), 'seconds');
  console.log('[SCENE SEGMENTATION] Style:', config.style);
  
  for (let i = 0; i < targetScenes; i++) {
    const sceneSentences = sentences.slice(i * sentencesPerScene, (i + 1) * sentencesPerScene);
    const narration = sceneSentences.join(' ').trim();
    
    // Generate video prompt from narration with content type style
    const videoPrompt = generateVideoPromptFromNarration(narration, i, config.style);
    
    // Normalize duration
    const duration = normalizeDuration(avgDuration);
    
    scenes.push({
      scene: i + 1,
      duration: duration,
      narration: narration || `Scene ${i + 1}`,
      overlay: '',
      image_prompt: videoPrompt,
      video_prompt: videoPrompt
    });
    
    console.log(`[SCENE SEGMENTATION] Scene ${i + 1}: ${duration}s - "${narration.substring(0, 50)}..."`);
  }
  
  console.log('[SCENE SEGMENTATION] Total scenes:', scenes.length);
  console.log('[SCENE SEGMENTATION] Total duration:', scenes.reduce((sum, s) => sum + s.duration, 0), 'seconds');
  console.log('[SCENE SEGMENTATION] ============================================');
  
  return scenes;
}

/**
 * Helper function to generate video prompt from narration
 * @param narration - The narration text for this scene
 * @param sceneIndex - Index of the scene (0-based)
 * @param styleOverride - Additional style from content config
 */
function generateVideoPromptFromNarration(narration: string, sceneIndex: number, styleOverride: string = ''): string {
  const lowerNarration = narration.toLowerCase();
  
  // Detect context and generate appropriate video prompt
  let context = 'modern business environment';
  let action = 'cinematic shot';
  
  if (lowerNarration.includes('problem') || lowerNarration.includes('issue') || 
      lowerNarration.includes('slow') || lowerNarration.includes('difficult')) {
    context = 'frustrated user struggling with outdated technology';
    action = 'close-up, dramatic lighting';
  } else if (lowerNarration.includes('solution') || lowerNarration.includes('fast') || 
             lowerNarration.includes('easy') || lowerNarration.includes('simple')) {
    context = 'happy person using modern AI software';
    action = 'dynamic tracking shot, bright lighting';
  } else if (lowerNarration.includes('product') || lowerNarration.includes('feature')) {
    context = 'professional product demonstration';
    action = 'smooth camera movement';
  } else if (lowerNarration.includes('call to action') || lowerNarration.includes('visit') || 
             lowerNarration.includes('sign up') || lowerNarration.includes('try')) {
    context = 'compelling call-to-action with brand elements';
    action = 'friendly, inviting shot';
  } else if (lowerNarration.includes('introducing') || lowerNarration.includes('present')) {
    context = 'professional introduction scene';
    action = 'wide establishing shot';
  }
  
  // Add scene-specific modifiers
  const sceneModifiers = [
    'smooth camera movement',
    'dynamic zoom in',
    'cinematic lighting',
    'professional commercial quality',
    'high definition 4k'
  ];
  
  const modifier = sceneModifiers[sceneIndex % sceneModifiers.length];
  
  // Build final prompt with style override
  const basePrompt = `${context}, ${action}, ${modifier}, advertisement style`;
  const finalPrompt = styleOverride ? `${basePrompt}, ${styleOverride}` : basePrompt;
  
  return finalPrompt;
}

/**
 * STEP 2: DURATION NORMALIZATION
 * 
 * Video models only support fixed durations: 4s, 6s, or 8s
 * This function normalizes any duration to the nearest valid value.
 * 
 * @param duration - Requested duration in seconds
 * @returns Normalized duration (4, 6, or 8)
 */
export function normalizeDuration(duration: number): number {
  console.log('[DURATION NORMALIZATION] Input duration:', duration, 'seconds');
  
  let normalized: number;
  
  if (duration <= 4) {
    normalized = 4;
  } else if (duration <= 6) {
    normalized = 6;
  } else {
    normalized = 8;
  }
  
  console.log('[DURATION NORMALIZATION] Normalized duration:', normalized, 'seconds');
  return normalized;
}

/**
 * STEP 3: VIDEO GENERATION PER SCENE
 * 
 * Generate video clips for each scene using AI video APIs.
 * Tries Veo 3.1 first, falls back to Luma Dream Machine.
 * 
 * @param scenes - Array of scene objects with video_prompt and duration
 * @param adId - Advertisement ID for file naming
 * @returns Array of video file paths
 */
export async function generateVideoClipsForScenes(
  scenes: Array<{ video_prompt: string; duration: number }>,
  adId: string
): Promise<string[]> {
  const workDir = path.join(process.cwd(), 'public', 'uploads', adId);
  
  console.log('[VIDEO CLIPS GENERATION] ============================================');
  console.log('[VIDEO CLIPS GENERATION] Total scenes:', scenes.length);
  console.log('[VIDEO CLIPS GENERATION] Ad ID:', adId);
  console.log('[VIDEO CLIPS GENERATION] Work directory:', workDir);
  console.log('[VIDEO CLIPS GENERATION] ============================================');
  
  // Normalize all durations first
  const normalizedScenes = scenes.map((scene, index) => ({
    ...scene,
    duration: normalizeDuration(scene.duration),
    video_prompt: scene.video_prompt
  }));
  
  console.log('[VIDEO CLIPS GENERATION] Normalized scenes:');
  normalizedScenes.forEach((s, i) => {
    console.log(`[VIDEO CLIPS GENERATION]   Scene ${i + 1}: ${s.duration}s - "${s.video_prompt.substring(0, 50)}..."`);
  });
  console.log('[VIDEO CLIPS GENERATION] ============================================');
  
  const videoClips: string[] = [];
  let useLuma = false;
  let useReplicate = false;
  
  // Try Veo 3.1 first
  const veoAvailable = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== '';
  
  if (veoAvailable) {
    console.log('[VIDEO CLIPS GENERATION] ============================================');
    console.log('[VIDEO CLIPS GENERATION] Attempting Google Veo 3.1 Preview API...');
    console.log('[VIDEO CLIPS GENERATION] Model: models/veo-3.1-generate-preview');
    console.log('[VIDEO CLIPS GENERATION] ============================================');
    try {
      const videoBuffers = await generateVeoVideos(normalizedScenes);
      
      // STRICT VALIDATION: Check if we got all videos
      if (!videoBuffers || videoBuffers.length === 0) {
        throw new Error('Veo API returned no video buffers');
      }
      
      // Save each video clip
      for (let i = 0; i < videoBuffers.length; i++) {
        const videoPath = path.join(workDir, `scene_${i + 1}.mp4`);
        fs.writeFileSync(videoPath, videoBuffers[i]);
        videoClips.push(videoPath);
        console.log(`[VIDEO CLIPS GENERATION] Veo Scene ${i + 1} saved: ${videoPath} (${videoBuffers[i].length} bytes)`);
      }
      
      console.log('[VIDEO CLIPS GENERATION] Veo 3.1 SUCCESS: All', videoClips.length, 'clips generated');
      return videoClips;
      
    } catch (veoError: any) {
      console.error('[VIDEO CLIPS GENERATION] ============================================');
      console.error('[VIDEO CLIPS GENERATION] Veo 3.1 FAILED:', veoError.message);
      console.error('[VIDEO CLIPS GENERATION] Falling back to Replicate API...');
      console.error('[VIDEO CLIPS GENERATION] ============================================');
      useReplicate = true;
    }
  } else {
    console.log('[VIDEO CLIPS GENERATION] Veo 3.1 not available (no API key)');
    useReplicate = true;
  }
  
  // Fallback to Replicate API
  if (useReplicate) {
    const replicateAvailable = process.env.REPLICATE_API_KEY && process.env.REPLICATE_API_KEY !== '';
    
    if (!replicateAvailable) {
      console.log('[VIDEO CLIPS GENERATION] Replicate not available, trying Luma Dream Machine...');
      useLuma = true;
    } else {
      console.log('[VIDEO CLIPS GENERATION] ============================================');
      console.log('[VIDEO CLIPS GENERATION] Using Replicate API (Luma Dream Machine)...');
      console.log('[VIDEO CLIPS GENERATION] ============================================');
      try {
        const videoBuffers = await generateReplicateVideosForScenes(normalizedScenes);
        
        // STRICT VALIDATION
        if (!videoBuffers || videoBuffers.length === 0) {
          throw new Error('Replicate API returned no video buffers');
        }
        
        // Save each video clip
        for (let i = 0; i < videoBuffers.length; i++) {
          const videoPath = path.join(workDir, `scene_${i + 1}.mp4`);
          fs.writeFileSync(videoPath, videoBuffers[i]);
          videoClips.push(videoPath);
          console.log(`[VIDEO CLIPS GENERATION] Replicate Scene ${i + 1} saved: ${videoPath} (${videoBuffers[i].length} bytes)`);
        }
        
        console.log('[VIDEO CLIPS GENERATION] Replicate SUCCESS: All', videoClips.length, 'clips generated');
        return videoClips;
        
      } catch (replicateError: any) {
        console.error('[VIDEO CLIPS GENERATION] ============================================');
        console.error('[VIDEO CLIPS GENERATION] Replicate FAILED:', replicateError.message);
        console.error('[VIDEO CLIPS GENERATION] Falling back to Luma Dream Machine...');
        console.error('[VIDEO CLIPS GENERATION] ============================================');
        useLuma = true;
      }
    }
  }
  
  // Final fallback to Luma Dream Machine
  if (useLuma) {
    const lumaAvailable = process.env.LUMA_API_KEY && process.env.LUMA_API_KEY !== '' && 
                         process.env.LUMA_API_KEY !== 'your-luma-api-key-here';
    
    if (!lumaAvailable) {
      throw new Error('REALISTIC MODE ERROR: No AI video API available. Please configure either GEMINI_API_KEY (Veo 3.1) or LUMA_API_KEY in .env.local');
    }
    
    console.log('[VIDEO CLIPS GENERATION] Using Luma Dream Machine API...');
    try {
      const videoBuffers = await generateLumaVideosForScenes(normalizedScenes);
      
      // STRICT VALIDATION: Check if we got all videos
      if (!videoBuffers || videoBuffers.length === 0) {
        throw new Error('Luma API returned no video buffers');
      }
      
      // Save each video clip
      for (let i = 0; i < videoBuffers.length; i++) {
        const videoPath = path.join(workDir, `scene_${i + 1}.mp4`);
        fs.writeFileSync(videoPath, videoBuffers[i]);
        videoClips.push(videoPath);
        console.log(`[VIDEO CLIPS GENERATION] Luma Scene ${i + 1} saved: ${videoPath} (${videoBuffers[i].length} bytes)`);
      }
      
      console.log('[VIDEO CLIPS GENERATION] Luma Dream Machine SUCCESS: All', videoClips.length, 'clips generated');
      return videoClips;
      
    } catch (lumaError: any) {
      console.error('[VIDEO CLIPS GENERATION] Luma FAILED:', lumaError.message);
      throw new Error(`REALISTIC MODE ERROR: AI video generation failed. Veo: ${veoAvailable ? 'failed' : 'not available'}, Luma: ${lumaError.message}`);
    }
  }
  
  // This should never be reached
  throw new Error('REALISTIC MODE ERROR: No video generation method succeeded');
}

/**
 * STEP 5: MERGE VIDEO CLIPS
 * 
 * Concatenate all scene video clips into a single video using FFmpeg.
 * Maintains resolution and uses H.264 codec.
 * 
 * @param clips - Array of video file paths
 * @param adId - Advertisement ID
 * @returns Path to merged video file
 */
export async function mergeVideoClips(clips: string[], adId: string): Promise<string> {
  const workDir = path.join(process.cwd(), 'public', 'uploads', adId);
  
  console.log('[MERGE VIDEO CLIPS] ============================================');
  console.log('[MERGE VIDEO CLIPS] Number of clips:', clips.length);
  console.log('[MERGE VIDEO CLIPS] ============================================');
  
  if (clips.length === 0) {
    throw new Error('MERGE ERROR: No video clips to merge');
  }
  
  if (clips.length === 1) {
    console.log('[MERGE VIDEO CLIPS] Only one clip, skipping merge');
    return clips[0];
  }
  
  // Create concat file for FFmpeg
  const concatFilePath = path.join(workDir, 'concat.txt');
  let concatContent = '';
  
  for (const clip of clips) {
    concatContent += `file '${clip}'\n`;
    console.log(`[MERGE VIDEO CLIPS] Adding: ${path.basename(clip)}`);
  }
  
  fs.writeFileSync(concatFilePath, concatContent);
  
  const outputPath = path.join(workDir, 'merged_video.mp4');
  
  if (ffmpegStatic) {
    // Use FFmpeg to concatenate videos
    // -c copy for fast copy if same codec, otherwise re-encode
    const ffmpegCmd = `"${ffmpegStatic}" -y -f concat -safe 0 -i "${concatFilePath}" -c copy -movflags +faststart "${outputPath}"`;
    
    console.log('[MERGE VIDEO CLIPS] Running FFmpeg merge...');
    await execAsync(ffmpegCmd, { timeout: 120000 });
    
    console.log('[MERGE VIDEO CLIPS] Merged video saved:', outputPath);
  } else {
    throw new Error('MERGE ERROR: FFmpeg not available');
  }
  
  console.log('[MERGE VIDEO CLIPS] ============================================');
  return outputPath;
}

/**
 * STEP 6 & 7: GENERATE FINAL VIDEO
 * 
 * Complete pipeline: merge clips + add audio + export final MP4
 * 
 * @param videoClips - Array of video file paths
 * @param adId - Advertisement ID
 * @param narrationScript - Combined narration for TTS
 * @param websiteUrl - Website URL for logo overlay
 * @returns Path to final video
 */
export async function generateFinalVideo(
  videoClips: string[],
  adId: string,
  narrationScript: string,
  websiteUrl?: string
): Promise<string> {
  const workDir = path.join(process.cwd(), 'public', 'uploads', adId);
  
  console.log('[FINAL VIDEO] ============================================');
  console.log('[FINAL VIDEO] Starting final video generation...');
  console.log('[FINAL VIDEO] ============================================');
  
  // Step 1: Merge video clips
  console.log('[FINAL VIDEO] Step 1: Merging video clips...');
  const mergedPath = await mergeVideoClips(videoClips, adId);
  
  // Step 2: Generate TTS audio
  console.log('[FINAL VIDEO] Step 2: Generating voiceover...');
  const audioPath = path.join(workDir, 'voiceover.mp3');
  
  // Use Google TTS for voiceover
  const googleTTS = await import('google-tts-api');
  const url = googleTTS.getAudioUrl(narrationScript, {
    lang: 'en',
    slow: false,
    host: 'https://translate.google.com',
  });
  
  const audioResponse = await axios({
    url,
    responseType: 'arraybuffer',
    timeout: 30000,
    ...EXTERNAL_HTTP_CONFIG,
  });
  
  fs.writeFileSync(audioPath, Buffer.from(audioResponse.data));
  console.log('[FINAL VIDEO] Voiceover saved:', audioPath);
  
  // Step 3: Add background music
  console.log('[FINAL VIDEO] Step 3: Adding background music...');
  const musicPath = await downloadBackgroundMusicSync(workDir);
  
  // Step 4: Scrape logo
  console.log('[FINAL VIDEO] Step 4: Processing logo...');
  const logoPath = websiteUrl ? await scrapeLogoSync(websiteUrl, workDir) : null;
  
  // Step 5: Combine everything with FFmpeg
  console.log('[FINAL VIDEO] Step 5: Rendering final video with FFmpeg...');
  const finalPath = path.join(workDir, 'final_ad.mp4');
  
  let ffmpegCmd = '';
  
  if (musicPath && logoPath) {
    ffmpegCmd = `"${ffmpegStatic}" -y -i "${mergedPath}" -i "${audioPath}" -i "${musicPath}" -i "${logoPath}" -filter_complex "[2:a]volume=0.1[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout];[3:v]scale=150:-1[logo];[0:v][logo]overlay=30:30[vout]" -map \"[vout]\" -map \"[aout]\" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${finalPath}"`;
  } else if (musicPath) {
    ffmpegCmd = `"${ffmpegStatic}" -y -i "${mergedPath}" -i "${audioPath}" -i "${musicPath}" -filter_complex "[2:a]volume=0.1[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map \"[aout]\" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${finalPath}"`;
  } else if (logoPath) {
    ffmpegCmd = `"${ffmpegStatic}" -y -i "${mergedPath}" -i "${audioPath}" -i "${logoPath}" -filter_complex "[3:v]scale=150:-1[logo];[0:v][logo]overlay=30:30[vout]" -map \"[vout]\" -map 1:a -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${finalPath}"`;
  } else {
    ffmpegCmd = `"${ffmpegStatic}" -y -i "${mergedPath}" -i "${audioPath}" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${finalPath}"`;
  }
  
  await execAsync(ffmpegCmd, { timeout: 180000 });
  
  console.log('[FINAL VIDEO] ============================================');
  console.log('[FINAL VIDEO] FINAL VIDEO GENERATED SUCCESSFULLY');
  console.log('[FINAL VIDEO] Output:', finalPath);
  console.log('[FINAL VIDEO] ============================================');
  
  return `/uploads/${adId}/final_ad.mp4`;
}

/**
 * Helper: Download background music synchronously
 */
async function downloadBackgroundMusicSync(workDir: string): Promise<string | null> {
  const musicPath = path.join(workDir, 'bg_music.mp3');
  
  if (fs.existsSync(musicPath)) {
    return musicPath;
  }
  
  try {
    const url = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
    const response = await axios({
      url,
      responseType: 'arraybuffer',
      timeout: 15000,
      ...EXTERNAL_HTTP_CONFIG,
    });
    fs.writeFileSync(musicPath, Buffer.from(response.data));
    return musicPath;
  } catch (e) {
    console.warn('[BACKGROUND MUSIC] Download failed, using silent track');
    return null;
  }
}

/**
 * Helper: Scrape logo synchronously
 */
async function scrapeLogoSync(websiteUrl: string, workDir: string): Promise<string | null> {
  if (!websiteUrl) return null;
  
  try {
    let url = websiteUrl;
    if (!url.startsWith('http')) url = 'https://' + url;
    
    const { data } = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(data);
    const baseUrl = new URL(url).origin;
    
    let logoUrl = $('meta[property="og:image"]').attr('content') ||
                  $('img[class*="logo"]').first().attr('src') ||
                  $('link[rel="icon"]').first().attr('href');
    
    if (!logoUrl) return null;
    
    if (logoUrl.startsWith('//')) logoUrl = 'https:' + logoUrl;
    else if (logoUrl.startsWith('/')) logoUrl = baseUrl + logoUrl;
    else if (!logoUrl.startsWith('http')) logoUrl = baseUrl + '/' + logoUrl;
    
    const logoPath = path.join(workDir, 'logo.png');
    const response = await axios({
      url: logoUrl,
      responseType: 'arraybuffer',
      timeout: 10000,
      ...EXTERNAL_HTTP_CONFIG,
    });
    fs.writeFileSync(logoPath, Buffer.from(response.data));
    return logoPath;
  } catch (e) {
    console.warn('[LOGO] Extraction failed');
    return null;
  }
}

export class VideoGenerator {
  private adId: string;
  private script: string;
  private parsedScript: ParsedScript | null = null;
  private duration: number;
  private workDir: string;
  private contentType: ContentType;
  private contentConfig: ContentConfig;
  private language: SupportedLanguage = 'english';
  private lastAudioProvider: 'elevenlabs' | 'google' | 'none' = 'none';
  private lastAudioProviderMetadata: ProviderExecutionMetadata | null = null;

  constructor(adId: string, script: string, duration: number = 15, contentType: ContentType = 'ads') {
    this.adId = adId;
    this.contentType = contentType;
    this.contentConfig = getContentConfig(contentType);
    
    // Override duration from config if not specified
    this.duration = duration || this.contentConfig.duration;
    this.workDir = path.join(process.cwd(), 'public', 'uploads', adId);
    
    console.log(`[${this.adId}] VideoGenerator initialized with:`);
    console.log(`[${this.adId}]   Content type: ${this.contentType}`);
    console.log(`[this.adId}]   Aspect ratio: ${this.contentConfig.aspectRatio} (${this.contentConfig.width}x${this.contentConfig.height})`);
    console.log(`[${this.adId}]   Duration: ${this.duration}s`);
    
    if (!fs.existsSync(this.workDir)) {
      fs.mkdirSync(this.workDir, { recursive: true });
    }
    
    // Try to parse script as JSON to extract scenes
    try {
      const parsed = JSON.parse(script);
      if (parsed.scenes && Array.isArray(parsed.scenes)) {
        this.parsedScript = parsed;
        this.duration = parsed.duration || this.duration;
        this.language = normalizeLanguage(parsed.language);
        // Combine all narrations for TTS
        this.script = parsed.scenes.map((s: any) => s.narration).join(' ');
      } else {
        this.script = script;
      }
    } catch {
      this.script = script;
    }
  }

  /**
   * Get the current content configuration
   */
  getContentConfig(): ContentConfig {
    return this.contentConfig;
  }

  /**
   * Get aspect ratio dimensions for video rendering
   */
  getAspectRatio(): { width: number; height: number } {
    return { width: this.contentConfig.width, height: this.contentConfig.height };
  }

  /**
   * Set the script for TTS generation
   */
  setScript(script: string): void {
    this.script = script;
  }

  setLanguage(language?: string): void {
    this.language = normalizeLanguage(language);
  }

  getLastAudioProvider(): 'elevenlabs' | 'google' | 'none' {
    return this.lastAudioProvider;
  }

  getLastAudioProviderMetadata(): ProviderExecutionMetadata | null {
    return this.lastAudioProviderMetadata;
  }

  private async getAudioDurationSeconds(audioPath: string): Promise<number | null> {
    if (!ffmpegStatic || !fs.existsSync(audioPath)) {
      return null;
    }

    try {
      const ffmpegDir = path.dirname(ffmpegStatic);
      const ffprobeBinary = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
      const ffprobePath = path.join(ffmpegDir, ffprobeBinary);

      if (!fs.existsSync(ffprobePath)) {
        return null;
      }

      const { stdout } = await execAsync(
        `"${ffprobePath}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
        { timeout: 30000 }
      );

      const duration = Number.parseFloat((stdout || '').trim());
      return Number.isFinite(duration) && duration > 0 ? duration : null;
    } catch (durationError) {
      console.warn(`[${this.adId}] Failed to read audio duration for ${audioPath}:`, durationError);
      return null;
    }
  }

  private async alignScenesToAudioTiming(scenes: any[]): Promise<any[]> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      return scenes;
    }

    const alignedScenes = [...scenes];
    let alignedTotal = 0;

    for (let i = 0; i < alignedScenes.length; i++) {
      const voiceFile = path.join(this.workDir, `voice_${i + 1}.mp3`);
      const currentDuration = Number(alignedScenes[i]?.duration) > 0 ? Number(alignedScenes[i].duration) : 3;
      const measuredDuration = await this.getAudioDurationSeconds(voiceFile);

      if (!measuredDuration) {
        alignedScenes[i] = { ...alignedScenes[i], duration: currentDuration };
        alignedTotal += currentDuration;
        continue;
      }

      const paddedDuration = Math.max(currentDuration, Number((measuredDuration + 0.35).toFixed(2)));
      alignedScenes[i] = { ...alignedScenes[i], duration: paddedDuration };
      alignedTotal += paddedDuration;

      console.log(`[${this.adId}] Scene ${i + 1} timing aligned from ${currentDuration}s to ${paddedDuration}s based on ${measuredDuration.toFixed(2)}s narration`);
    }

    console.log(`[${this.adId}] Narration-aware scene total: ${alignedTotal.toFixed(2)}s`);
    return alignedScenes;
  }

  private async ensureTimelineCoversAudio(scenes: any[], audioPath: string): Promise<any[]> {
    if (!Array.isArray(scenes) || scenes.length === 0) {
      return scenes;
    }

    const audioDuration = await this.getAudioDurationSeconds(audioPath);
    if (!audioDuration) {
      return scenes;
    }

    const currentTotal = scenes.reduce((sum, scene) => {
      const duration = Number(scene?.duration) > 0 ? Number(scene.duration) : 0;
      return sum + duration;
    }, 0);
    const minimumTarget = Number((audioDuration + 0.5).toFixed(2));

    if (currentTotal >= minimumTarget) {
      console.log(`[${this.adId}] Timeline already covers audio (${currentTotal.toFixed(2)}s >= ${minimumTarget.toFixed(2)}s)`);
      return scenes;
    }

    const extension = Number((minimumTarget - currentTotal).toFixed(2));
    const lastIndex = scenes.length - 1;
    const lastDuration = Number(scenes[lastIndex]?.duration) > 0 ? Number(scenes[lastIndex].duration) : 3;
    const extendedScenes = [...scenes];
    extendedScenes[lastIndex] = {
      ...extendedScenes[lastIndex],
      duration: Number((lastDuration + extension).toFixed(2))
    };

    console.log(
      `[${this.adId}] Extended final scene by ${extension.toFixed(2)}s so timeline matches combined narration (${minimumTarget.toFixed(2)}s)`
    );

    return extendedScenes;
  }

  private async safeReplaceFile(sourcePath: string, targetPath: string): Promise<void> {
    const backupPath = `${targetPath}.bak`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { force: true });
        }

        if (fs.existsSync(targetPath)) {
          try {
            fs.renameSync(targetPath, backupPath);
          } catch (renameError: any) {
            if (renameError?.code !== 'ENOENT') {
              throw renameError;
            }
          }
        }

        fs.renameSync(sourcePath, targetPath);

        if (fs.existsSync(backupPath)) {
          fs.rmSync(backupPath, { force: true });
        }

        return;
      } catch (error: any) {
        const isBusy = error?.code === 'EBUSY' || error?.code === 'EPERM';
        if (!isBusy || attempt === 2) {
          throw error;
        }

        console.warn(`[${this.adId}] Retry replacing ${path.basename(targetPath)} after ${error.code}`);
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  async downloadImage(url: string, filepath: string): Promise<void> {
    const response = await axios({
      url,
      responseType: "arraybuffer",
      ...EXTERNAL_HTTP_CONFIG,
    });

    await fs.promises.writeFile(filepath, response.data);
  }

  async scrapeImages(websiteUrl: string): Promise<string[]> {
    const urlsToTry: string[] = [];

    try {
      if (websiteUrl) {
        let url = websiteUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        console.log(`[${this.adId}] Fetching website: ${url}`);
        const { data } = await axios.get(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000
        });
        const $ = cheerio.load(data);
        const baseUrl = new URL(url).origin;

        $('img').each((i, el) => {
          let src = $(el).attr('src');
          if (src) {
            if (src.toLowerCase().includes("logo") || src.toLowerCase().includes("icon")) return;
            // resolve relative URLs
            if (src.startsWith('//')) {
              src = 'https:' + src;
            } else if (src.startsWith('/')) {
              src = baseUrl + src;
            } else if (!src.startsWith('http')) {
              src = baseUrl + '/' + src;
            }
            urlsToTry.push(src);
          }
        });
      }
    } catch (err) {
      console.warn(`[${this.adId}] Failed to scrape website URL ${websiteUrl}:`, err);
    }

    const validUrls = Array.from(new Set(urlsToTry)).filter(src => {
      const lower = src.toLowerCase();
      return lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.includes('images.unsplash.com');
    });

    const targetCount = Math.max(3, Math.ceil(this.duration / 5));
    const finalUrls: string[] = [];
    
    // Add scraped images
    for (let src of validUrls) {
      if (finalUrls.length >= targetCount) break;
      finalUrls.push(src);
    }

    // Fill remaining with fallbacks
    const fallbackImages = [
      "https://images.unsplash.com/photo-1542204165-65bf26472b9b?w=800&q=80",
      "https://images.unsplash.com/photo-1491933382434-500287f9b54b?w=800&q=80",
      "https://images.unsplash.com/photo-1512418490979-92798cec1380?w=800&q=80"
    ];

    while (finalUrls.length < targetCount) {
      finalUrls.push(fallbackImages[finalUrls.length]);
    }

    const downloadedImages: string[] = [];
    for (let i = 0; i < finalUrls.length; i++) {
      const imgPath = path.join(this.workDir, `${i + 1}.jpg`);
      const rawPath = path.join(this.workDir, `raw_${i + 1}.tmp`);
      
      const downloadAndConvert = async (url: string) => {
        // Delete existing to prevent using old corrupted files
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        
        await this.downloadImage(url, rawPath);
        if (ffmpegStatic) {
          // Convert to standard JPEG, scaling to 1280x720 and padding if necessary
          // -frames:v 1 ensures single frame output, -q:v 2 ensures high quality
          await execAsync(`"${ffmpegStatic}" -y -i "${rawPath}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2" -frames:v 1 -q:v 2 "${imgPath}"`);
        } else {
          fs.renameSync(rawPath, imgPath);
        }
      };

      try {
        await downloadAndConvert(finalUrls[i]);
        downloadedImages.push(imgPath);
      } catch (e) {
        console.warn(`[${this.adId}] Failed to process image ${finalUrls[i]}, using fallback`, e);
        try {
          await downloadAndConvert(fallbackImages[i]);
          downloadedImages.push(imgPath);
        } catch (err) {
          console.error(`Failed to process fallback image for ${i}`, err);
        }
      }
    }
    return downloadedImages;
  }

  private cleanScript(script: string): string {
    // Remove "Scene 1:", "Scene 2:", etc. from narration text
    let cleaned = script.replace(/Scene \d+:?/ig, '');
    return cleaned.replace(/\s+/g, ' ').trim();
  }

  private splitIntoChunks(script: string, maxLen: number = 200): string[] {
    const sentences = script.match(/[^.!?]+[.!?]*/g) || [script];
    const chunks: string[] = [];
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      
      if (trimmed.length <= maxLen) {
        chunks.push(trimmed);
      } else {
        // Split by words if sentence is too long
        const words = trimmed.split(' ');
        let currentChunk = '';
        for (const word of words) {
          if ((currentChunk + ' ' + word).trim().length <= maxLen) {
            currentChunk = (currentChunk + ' ' + word).trim();
          } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = word;
          }
        }
        if (currentChunk) chunks.push(currentChunk);
      }
    }
    return chunks;
  }

  private async downloadAudioChunk(text: string, index: number, language: SupportedLanguage, maxRetries = 3): Promise<Buffer> {
    const url = googleTTS.getAudioUrl(text, {
      lang: getLanguageTtsCode(language),
      slow: false,
      host: 'https://translate.google.com',
    });

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const response = await axios({
          url,
          responseType: 'arraybuffer',
          timeout: 10000,
          ...EXTERNAL_HTTP_CONFIG,
        });
        
        const buffer = Buffer.from(response.data);
        if (buffer.length < 100) {
           throw new Error("Buffer too small, likely invalid audio");
        }
        return buffer;
      } catch (error) {
        attempt++;
        console.warn(`[${this.adId}] Chunk ${index} download failed (attempt ${attempt}/${maxRetries})`);
        if (attempt >= maxRetries) {
          throw new Error(`Failed to download chunk ${index} after ${maxRetries} attempts`);
        }
        // Exponential backoff
        await new Promise(res => setTimeout(res, 1000 * Math.pow(2, attempt)));
      }
    }
    throw new Error(`Failed to download chunk ${index}`);
  }

  private async generateFallbackSilentTrack(audioPath: string): Promise<void> {
    if (!ffmpegStatic) {
      throw new Error("FFmpeg binary not found");
    }
    const ffmpegCmd = `"${ffmpegStatic}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${this.duration} -q:a 9 -acodec libmp3lame "${audioPath}"`;
    await execAsync(ffmpegCmd, { timeout: 60000 });
  }

  private async synthesizeWithElevenLabs(
    text: string,
    voiceProfile: VoiceProfile,
    speed: number
  ): Promise<{ buffer: Buffer; metadata: ProviderExecutionMetadata }> {
    const { value, metadata } = await runWithProviderFallback<Buffer>([
      {
        name: 'elevenlabs',
        retries: 2,
        timeoutMs: 45000,
        retryLabel: 'ElevenLabs TTS',
        run: async () => {
          if (!process.env.ELEVENLABS_API_KEY) {
            throw new Error('Missing ElevenLabs API key');
          }

          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceProfile.id}`,
            {
              text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                ...voiceProfile.settings,
                speed
              }
            },
            {
              headers: {
                "xi-api-key": process.env.ELEVENLABS_API_KEY,
                "Content-Type": "application/json"
              },
              responseType: "arraybuffer",
              proxy: false
            }
          );

          return Buffer.from(response.data);
        }
      }
    ]);

    return { buffer: value, metadata };
  }

  private async synthesizeWithGoogle(
    text: string,
    language: SupportedLanguage
  ): Promise<{ buffer: Buffer; metadata: ProviderExecutionMetadata }> {
    const { value, metadata } = await runWithProviderFallback<Buffer>([
      {
        name: 'google-tts',
        retries: 2,
        timeoutMs: 30000,
        retryLabel: 'Google TTS',
        run: async () => {
          googleTTS.getAudioUrl(text, { lang: getLanguageTtsCode(language) });
          return this.downloadAudioChunk(text, 0, language);
        }
      }
    ]);

    return { buffer: value, metadata };
  }

  // NEW: Generate per-scene audio files
  async generatePerSceneAudio(scenes: any[], voiceType?: string, speed: number = 1, language?: SupportedLanguage): Promise<string[]> {
    const audioPaths: string[] = [];
    const resolvedLanguage = normalizeLanguage(language || this.language);
    console.log(`[${this.adId}] Generating per-scene audio for ${scenes.length} scenes`);
    
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene.narration || !scene.narration.trim()) {
        console.log(`[${this.adId}] Scene ${i} has no narration, skipping audio`);
        audioPaths.push('');
        continue;
      }
      
      const audioPath = path.join(this.workDir, `voice_${i + 1}.mp3`);
      const tempAudioPath = path.join(this.workDir, `voice_${i + 1}_temp.mp3`);
      const cleanedScript = this.cleanScript(scene.narration);
      
      console.log(`[${this.adId}] Generating audio for scene ${i + 1}: ${cleanedScript.substring(0, 50)}...`);
      
      const voiceProfile = resolveVoiceProfile(resolvedLanguage, voiceType);
      
      // Try ElevenLabs first
      if (process.env.ELEVENLABS_API_KEY) {
        try {
          const { buffer, metadata } = await this.synthesizeWithElevenLabs(cleanedScript, voiceProfile, speed);
          fs.writeFileSync(tempAudioPath, buffer);
          
          // Apply speed adjustment
          if (speed !== 1 && ffmpegStatic) {
            await execAsync(`"${ffmpegStatic}" -y -i "${tempAudioPath}" -filter:a "atempo=${speed}" -vn "${audioPath}"`, { timeout: 60000 });
          } else {
            fs.copyFileSync(tempAudioPath, audioPath);
          }
          
          if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
          audioPaths.push(audioPath);
          this.lastAudioProvider = 'elevenlabs';
          this.lastAudioProviderMetadata = metadata;
          console.log(`[${this.adId}] Scene ${i + 1} audio generated: ${audioPath}`);
          continue;
        } catch (err) {
          console.warn(`[${this.adId}] ElevenLabs failed for scene ${i + 1}, falling back to Google TTS`, err);
        }
      }
      
      // Fallback: Google TTS
      try {
        const { buffer, metadata } = await this.synthesizeWithGoogle(cleanedScript, resolvedLanguage);
        fs.writeFileSync(tempAudioPath, buffer);
        
        // Apply speed adjustment
        if (speed !== 1 && ffmpegStatic) {
          await execAsync(`"${ffmpegStatic}" -y -i "${tempAudioPath}" -filter:a "atempo=${speed}" -vn "${audioPath}"`, { timeout: 60000 });
        } else {
          fs.copyFileSync(tempAudioPath, audioPath);
        }
        
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        audioPaths.push(audioPath);
        this.lastAudioProvider = 'google';
        this.lastAudioProviderMetadata = {
          ...metadata,
          primaryProvider: process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : metadata.primaryProvider,
          fallbackUsed: process.env.ELEVENLABS_API_KEY ? true : metadata.fallbackUsed
        };
        console.log(`[${this.adId}] Scene ${i + 1} audio generated (Google TTS): ${audioPath}`);
      } catch (err) {
        console.error(`[${this.adId}] Failed to generate audio for scene ${i + 1}`, err);
        audioPaths.push('');
      }
    }
    
    return audioPaths;
  }

  async generateTTS(voiceType?: string, speed: number = 1, language?: SupportedLanguage): Promise<string> {
    const audioPath = path.join(this.workDir, 'voiceover.mp3');
    const tempAudioPath = path.join(this.workDir, 'voiceover_temp.mp3');
    const tempProcessedAudioPath = path.join(this.workDir, 'voiceover_processed_temp.mp3');
    const cleanedScript = this.cleanScript(this.script);
    const resolvedLanguage = normalizeLanguage(language || this.language);
    console.log(`[${this.adId}] Generating TTS for script length: ${cleanedScript.length}`);
    console.log(`[VOICE] Voice Type: ${voiceType || 'default'}, Speed: ${speed}x, Language: ${resolvedLanguage}`);
    
    const voiceProfile = resolveVoiceProfile(resolvedLanguage, voiceType);
    
    // Attempt ElevenLabs if key exists
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const { buffer, metadata } = await this.synthesizeWithElevenLabs(cleanedScript, voiceProfile, speed);
        fs.writeFileSync(tempAudioPath, buffer);
        
        // Apply speed adjustment using FFmpeg if speed != 1
        if (speed !== 1 && ffmpegStatic) {
          console.log(`[VOICE] Applying speed adjustment ${speed}x via FFmpeg...`);
          await execAsync(`"${ffmpegStatic}" -y -i "${tempAudioPath}" -filter:a "atempo=${speed}" -vn "${tempProcessedAudioPath}"`, { timeout: 60000 });
          await this.safeReplaceFile(tempProcessedAudioPath, audioPath);
        } else {
          await this.safeReplaceFile(tempAudioPath, audioPath);
        }
        
        // Clean up temp file
        if (fs.existsSync(tempAudioPath)) fs.rmSync(tempAudioPath, { force: true });
        if (fs.existsSync(tempProcessedAudioPath)) fs.rmSync(tempProcessedAudioPath, { force: true });
        this.lastAudioProvider = 'elevenlabs';
        this.lastAudioProviderMetadata = metadata;
        
        return audioPath;
      } catch (err) {
        console.warn(`[${this.adId}] ElevenLabs failed, falling back to Google TTS`, err);
      }
    }
    
    // Fallback: Google TTS
    console.warn(`[${this.adId}] Using Google TTS for voiceover generation.`);
    let fallbackAttempted = false;

    while (true) {
      try {
        const chunks = this.splitIntoChunks(cleanedScript);
        console.log(`[${this.adId}] Split script into ${chunks.length} chunks`);
        
        const audioBuffers: Buffer[] = new Array(chunks.length);
        const concurrencyLimit = 3;
        
        // Process chunks with controlled concurrency
        for (let i = 0; i < chunks.length; i += concurrencyLimit) {
          const chunkBatch = chunks.slice(i, i + concurrencyLimit);
          const batchPromises = chunkBatch.map(async (chunk, batchIndex) => {
            const index = i + batchIndex;
            const buffer = await this.downloadAudioChunk(chunk, index, resolvedLanguage);
            audioBuffers[index] = buffer;
          });
          
          await Promise.all(batchPromises);
        }
        
        const finalBuffer = Buffer.concat(audioBuffers);
        fs.writeFileSync(tempAudioPath, finalBuffer);
        
        // Apply speed adjustment using FFmpeg if speed != 1
        if (speed !== 1 && ffmpegStatic) {
          console.log(`[VOICE] Applying speed adjustment ${speed}x via FFmpeg...`);
          await execAsync(`"${ffmpegStatic}" -y -i "${tempAudioPath}" -filter:a "atempo=${speed}" -vn "${tempProcessedAudioPath}"`, { timeout: 60000 });
          await this.safeReplaceFile(tempProcessedAudioPath, audioPath);
        } else {
          await this.safeReplaceFile(tempAudioPath, audioPath);
        }
        
        // Clean up temp file
        if (fs.existsSync(tempAudioPath)) fs.rmSync(tempAudioPath, { force: true });
        if (fs.existsSync(tempProcessedAudioPath)) fs.rmSync(tempProcessedAudioPath, { force: true });
        this.lastAudioProvider = 'google';
        this.lastAudioProviderMetadata = {
          primaryProvider: process.env.ELEVENLABS_API_KEY ? 'elevenlabs' : 'google-tts',
          finalProvider: 'google-tts',
          fallbackUsed: Boolean(process.env.ELEVENLABS_API_KEY),
          attempts: fallbackAttempted ? 2 : 1,
          warnings: process.env.ELEVENLABS_API_KEY ? ['ElevenLabs failed, Google TTS used as fallback'] : []
        };
        
        console.log(`[${this.adId}] Successfully merged ${chunks.length} chunks`);
        return audioPath;
      } catch (e) {
        console.error(`[${this.adId}] Google TTS generation failed`, e);
        if (!fallbackAttempted) {
          console.warn(`[${this.adId}] Retrying Google TTS generation once more...`);
          fallbackAttempted = true;
          continue;
        }
        
        console.error(`[${this.adId}] Google TTS failed completely, generating silent fallback track`);
        try {
          await this.generateFallbackSilentTrack(audioPath);
          return audioPath;
        } catch (fallbackErr: any) {
          console.error(`[${this.adId}] Silent fallback generation failed`, fallbackErr);
          throw new Error('Voice generation unavailable. External TTS failed and audio fallback is blocked in this environment.');
        }
      }
    }
  }

  private async downloadBackgroundMusic(preset: string = 'corporate'): Promise<string | null> {
    const musicPath = path.join(this.workDir, 'bg_music.mp3');
    
    // Check if already downloaded
    if (fs.existsSync(musicPath)) {
      return musicPath;
    }
    
    try {
      // Try external URLs first
      let url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3";
      if (preset === 'cinematic') url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3";
      if (preset === 'chill') url = "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3";
      
      const response = await axios({
        url,
        responseType: 'arraybuffer',
        timeout: 15000,
        ...EXTERNAL_HTTP_CONFIG,
      });
      fs.writeFileSync(musicPath, Buffer.from(response.data));
      return musicPath;
    } catch (e) {
      console.warn(`[${this.adId}] Failed to download background music from external source, generating silent track`, e);
      // Generate a simple silent/low audio track as fallback
      return this.generateSilentMusicTrack(musicPath, preset);
    }
  }

  private async generateSilentMusicTrack(musicPath: string, preset: string): Promise<string | null> {
    // Generate a simple tone-based background track based on preset
    // This is a fallback when external music downloads fail
    if (!ffmpegStatic) {
      return null;
    }
    
    try {
      // Use anullsrc (silent audio source) instead of sine wave to avoid filter issues
      // Generate a 30-second silent track with low volume
      const ffmpegCmd = `"${ffmpegStatic}" -y -f lavfi -i anullsrc=r=44100:cl=stereo -t 30 -q:a 9 -acodec libmp3lame "${musicPath}"`;
      await execAsync(ffmpegCmd, { timeout: 30000 });
      console.log(`[${this.adId}] Generated silent background track`);
      return musicPath;
    } catch (e) {
      console.warn(`[${this.adId}] Failed to generate fallback music track`, e);
      return null;
    }
  }

  async scrapeLogo(websiteUrl: string): Promise<string | null> {
    if (!websiteUrl) return null;
    try {
      let url = websiteUrl;
      if (!url.startsWith('http')) url = 'https://' + url;
      
      const { data } = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(data);
      const baseUrl = new URL(url).origin;
      
      let logoUrl = null;
      // 1. Meta tags
      logoUrl = logoUrl || $('meta[property="og:image"]').attr('content');
      // 2. Selectors
      if (!logoUrl) {
        const logoImg = $('img[class*="logo"], img[id*="logo"], img[src*="logo"]').first();
        if (logoImg.length) logoUrl = logoImg.attr('src');
      }
      // 3. Header icons
      if (!logoUrl) {
        const linkIcon = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first();
        if (linkIcon.length) logoUrl = linkIcon.attr('href');
      }

      if (logoUrl) {
        if (logoUrl.startsWith('//')) logoUrl = 'https:' + logoUrl;
        else if (logoUrl.startsWith('/')) logoUrl = baseUrl + logoUrl;
        else if (!logoUrl.startsWith('http')) logoUrl = baseUrl + '/' + logoUrl;
        
        const logoPath = path.join(this.workDir, 'logo.png');
        await this.downloadImage(logoUrl, logoPath);
        return logoPath;
      }
    } catch (e) {
      console.warn(`[${this.adId}] Logo extraction failed`, e);
    }
    return null;
  }

  async renderVideo(images: string[], audioPath: string, websiteUrl?: string): Promise<string> {
    if (images.length === 0) {
      throw new Error("No images available for video generation");
    }

    if (!ffmpegStatic) {
      throw new Error("FFmpeg binary not found");
    }

    const outputPath = path.join(this.workDir, 'final_ad.mp4');
    const bgMusicPath = await this.downloadBackgroundMusic();
    const logoPath = websiteUrl ? await this.scrapeLogo(websiteUrl) : null;
    const { width, height } = getRenderDimensions(this.contentConfig);
    const frameScaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    
    // ============================================================
    // IMAGE VALIDATION - Ensure all images exist before FFmpeg
    // Fallback to generated images if missing
    // ============================================================
    const fallbackPath = ensureFallbackImageExists();
    
    console.log(`[RENDER VIDEO] Validating ${images.length} images...`);
    for (let i = 1; i <= images.length; i++) {
      const imgPath = path.join(this.workDir, `${i}.jpg`);
      if (!fs.existsSync(imgPath)) {
        console.warn(`[RENDER VIDEO] Image ${i}.jpg missing, checking for generated image...`);
        
        // Check for generated raw image
        const rawPath = path.join(this.workDir, `gen_raw_${i}.jpg`);
        if (fs.existsSync(rawPath)) {
          console.log(`[RENDER VIDEO] Using gen_raw_${i}.jpg`);
          if (ffmpegStatic) {
            await execAsync(`"${ffmpegStatic}" -y -i "${rawPath}" -vf "${frameScaleFilter}" -frames:v 1 -q:v 2 "${imgPath}"`);
          } else {
            fs.copyFileSync(rawPath, imgPath);
          }
        } else {
          // Use fallback image
          console.warn(`[RENDER VIDEO] Using FALLBACK image for scene ${i}`);
          if (ffmpegStatic) {
            await execAsync(`"${ffmpegStatic}" -y -i "${fallbackPath}" -vf "${frameScaleFilter}" -frames:v 1 -q:v 2 "${imgPath}"`);
          } else {
            fs.copyFileSync(fallbackPath, imgPath);
          }
        }
      } else {
        console.log(`[RENDER VIDEO] Image ${i}.jpg exists ✓`);
      }
    }
    
    // Sequence pattern for slideshow
    const sequencePattern = path.join(this.workDir, '%d.jpg');
    
    let ffmpegCmd = '';
    
    // Calculate exact framerate needed to stretch images to fit the requested duration perfectly
    const fps = images.length / this.duration;

    if (bgMusicPath && logoPath) {
      ffmpegCmd = `"${ffmpegStatic}" -y -framerate ${fps} -i "${sequencePattern}" -i "${audioPath}" -i "${bgMusicPath}" -i "${logoPath}" -filter_complex "[2:a]volume=0.1[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout];[3:v]scale=${Math.round(width * 0.14)}:-1[logo];[0:v][logo]overlay=${Math.round(width * 0.04)}:${Math.round(height * 0.04)}[vout]" -map "[vout]" -map "[aout]" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    } else if (bgMusicPath) {
      ffmpegCmd = `"${ffmpegStatic}" -y -framerate ${fps} -i "${sequencePattern}" -i "${audioPath}" -i "${bgMusicPath}" -filter_complex "[2:a]volume=0.1[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    } else if (logoPath) {
      ffmpegCmd = `"${ffmpegStatic}" -y -framerate ${fps} -i "${sequencePattern}" -i "${audioPath}" -i "${logoPath}" -filter_complex "[2:v]scale=${Math.round(width * 0.14)}:-1[logo];[0:v][logo]overlay=${Math.round(width * 0.04)}:${Math.round(height * 0.04)}[vout]" -map "[vout]" -map 1:a -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    } else {
      ffmpegCmd = `"${ffmpegStatic}" -y -framerate ${fps} -i "${sequencePattern}" -i "${audioPath}" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    }

    try {
      console.log(`[${this.adId}] Running FFmpeg Command for video rendering...`);
      await execAsync(ffmpegCmd, { timeout: 120000 });
    } catch (err) {
      console.error('Video generation failed:', err);
      throw new Error('FFmpeg processing failed');
    }

    return `/uploads/${this.adId}/final_ad.mp4`;
  }

  async renderEditedVideo(
    scenes: any[],
    voiceSettings: any,
    musicSettings: any,
    websiteUrl?: string,
    language?: SupportedLanguage,
    generationMode: GenerationMode = 'basic'
  ): Promise<string> {
    try {
      const isRealisticMode = generationMode === 'realistic';
      const resolvedLanguage = normalizeLanguage(language || voiceSettings?.language || this.parsedScript?.language || this.language);
      this.language = resolvedLanguage;
      console.log(`[${this.adId}] Rendering edited video with ENHANCED pipeline...`);
      console.log("Rendering scenes:", scenes);
      console.log("Voice settings:", voiceSettings);
      console.log("Music settings:", musicSettings);
      console.log("Website URL:", websiteUrl);
      console.log("Language:", resolvedLanguage);
      
      // Note: Voice settings require ELEVENLABS_API_KEY in .env for voice selection
      // Without API key, falls back to Google TTS (no voice selection)
      if (!process.env.ELEVENLABS_API_KEY) {
        console.log("[Voice] No ElevenLabs API key - using Google TTS (voice selection disabled)");
      } else {
        console.log("[Voice] Using ElevenLabs with voice:", voiceSettings?.voiceType);
      }

      const finalAudioPath = path.join(this.workDir, 'voiceover.mp3');
      let renderScenes = scenes.map(scene => ({ ...scene }));
      const { width, height } = getRenderDimensions(this.contentConfig);
      const fitFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
      const subtitleStyle = this.parsedScript?.storyProfile?.subtitleStyle || this.parsedScript?.subtitleStyle || 'cinematic';
      const subtitleStyleConfig = getSubtitleStyleConfig(subtitleStyle, this.contentType, width, height);
      const topOverlayY = subtitleStyleConfig.y;
      const websiteOverlayY = Math.round(height * 0.9);
      
      console.log(`[${this.adId}] Generating fresh voiceover from current edited scenes`);
      const fullNarration = scenes
        .map((scene) => typeof scene?.narration === 'string' ? scene.narration.trim() : '')
        .filter(Boolean)
        .join('. ');

      if (!fullNarration) {
        throw new Error('Cannot render video without narration in the current scenes.');
      }

      this.script = fullNarration;
      await this.generateTTS(voiceSettings?.voiceType, voiceSettings?.speed, resolvedLanguage);
      renderScenes = await this.ensureTimelineCoversAudio(renderScenes, finalAudioPath);

      if (isRealisticMode) {
        try {
          console.log(`[${this.adId}] REALISTIC EDITED RENDER: generating scene video clips from current edited prompts`);
          const scenePrompts = renderScenes.map((scene, index) => {
            const narration = typeof scene?.narration === 'string' ? scene.narration.trim() : '';
            const overlay = typeof scene?.textOverlay === 'string'
              ? scene.textOverlay.trim()
              : (typeof scene?.overlay === 'string' ? scene.overlay.trim() : '');
            const fallbackPrompt = generateVideoPromptFromNarration(
              narration || overlay || `Scene ${index + 1}`,
              index,
              this.contentConfig.style
            );

            return {
              video_prompt:
                scene?.video_prompt ||
                scene?.videoPrompt ||
                scene?.image_prompt ||
                scene?.imagePrompt ||
                fallbackPrompt,
              duration: Number(scene?.duration) > 0 ? Number(scene.duration) : 4
            };
          });

          const videoClips = await generateVideoClipsForScenes(scenePrompts, this.adId);
          const mergedVideoPath = await mergeVideoClips(videoClips, this.adId);
          return await this.addAudioAndOverlay(mergedVideoPath, finalAudioPath, websiteUrl || '', musicSettings);
        } catch (realisticRenderError) {
          console.warn(`[${this.adId}] REALISTIC EDITED RENDER failed, falling back to slideshow render:`, realisticRenderError);
        }
      }

      const outputPath = path.join(this.workDir, `edited_ad_${Date.now()}.mp4`);
      
      // Create a concat file for scenes
      const concatFilePath = path.join(this.workDir, 'concat.txt');
      let concatContent = '';
      
      // Process each scene with ENHANCED effects (Ken Burns, transitions)
      for (let i = 0; i < renderScenes.length; i++) {
        const scene = renderScenes[i];
        const isLastScene = i === renderScenes.length - 1;
        
        // ============================================================
        // IMAGE RESOLUTION WITH FALLBACK - Prevents FFmpeg crashes
        // ============================================================
        const imageUrl = scene.imageUrl || scene.image;
        
        // Handle external URLs - download first
        let sourceImgPath: string;
        let isExternalUrl = imageUrl?.startsWith('http://') || imageUrl?.startsWith('https://');
        
        if (isExternalUrl && imageUrl) {
          // Download external image first
          const ext = path.extname(imageUrl) || '.jpg';
          const tempPath = path.join(this.workDir, `temp_scene_${i}${ext}`);
          try {
            console.log(`[IMAGE] Scene ${i}: Downloading external image: ${imageUrl}`);
            await this.downloadImage(imageUrl, tempPath);
            
            // Verify downloaded file exists
            if (fs.existsSync(tempPath)) {
              sourceImgPath = tempPath;
              console.log(`[IMAGE] Scene ${i}: External image downloaded successfully`);
            } else {
              console.warn(`[IMAGE] Scene ${i}: Downloaded file not found, using fallback`);
              const resolved = resolveImagePath(undefined, i, this.adId, this.workDir);
              sourceImgPath = resolved.path;
            }
          } catch (err: any) {
            console.warn(`[IMAGE] Scene ${i}: Failed to download external image: ${err.message}`);
            // Use fallback image
            const resolved = resolveImagePath(undefined, i, this.adId, this.workDir);
            sourceImgPath = resolved.path;
          }
        } else {
          // Local file - validate existence and use fallback if needed
          const resolved = resolveImagePath(imageUrl, i, this.adId, this.workDir);
          sourceImgPath = resolved.path;
          
          if (resolved.isFallback) {
            console.warn(`[IMAGE] Scene ${i}: Using FALLBACK image (original: ${resolved.originalUrl || 'none'})`);
          }
        }
        
        // Verify source image exists before processing
        if (!fs.existsSync(sourceImgPath)) {
          console.error(`[IMAGE] CRITICAL: Source image still missing: ${sourceImgPath}`);
          // Use fallback as last resort
          sourceImgPath = ensureFallbackImageExists();
        }
        
        // ============================================================
        // ENHANCED: Process image with Ken Burns effect and text overlay
        // ============================================================
        const processedImgPath = path.join(this.workDir, `scene_proc_${i}.jpg`);
        // Always delete old processed image to ensure fresh rendering
        if (fs.existsSync(processedImgPath)) {
          fs.unlinkSync(processedImgPath);
        }

        if (ffmpegStatic) {
          const textOverlay = scene.textOverlay || '';
          const sceneDuration = scene.duration || 4;
          
          // Ken Burns effect: slow zoom/pan based on scene index
          // Even scenes: zoom in from center, Odd scenes: slight pan
          const kenBurnsEffect = i % 2 === 0 
            ? `zoompan=z='min(zoom+0.001,1.2)':d=${sceneDuration * 30}:s=${width}x${height}`  // Slow zoom in
            : `zoompan=z='1.0':x='if(gte(zoom,1.0),x+5,0)':y='if(gte(zoom,1.0),y,0)':d=${sceneDuration * 30}:s=${width}x${height}`;  // Slow pan
          
          let filterGraph = fitFilter;
          
          // Add Ken Burns effect to non-last scenes for smooth transitions
          if (!isLastScene) {
            filterGraph += `,${kenBurnsEffect}`;
          }
          
          if (textOverlay) {
            // Escape single quotes for ffmpeg
            const safeText = escapeDrawtextValue(textOverlay);
            const fontFile = resolveFontFile(resolvedLanguage);
            const fontSize = subtitleStyleConfig.fontSize;
            const fontClause = fontFile ? `:fontfile='${escapeDrawtextValue(fontFile)}'` : '';
            filterGraph += `,drawtext=text='${safeText}'${fontClause}:fontcolor=white:fontsize=${fontSize}:x=(w-text_w)/2:y=${topOverlayY}:box=1:boxcolor=${subtitleStyleConfig.boxColor}:boxborderw=${subtitleStyleConfig.boxBorder}`;
          }

          if (isLastScene && websiteUrl) {
            const safeWebsite = escapeDrawtextValue(websiteUrl.replace(/^https?:\/\//, ''));
            const fontFile = resolveFontFile(resolvedLanguage);
            const websiteFontSize = this.contentType === 'reels' ? 28 : 32;
            const fontClause = fontFile ? `:fontfile='${escapeDrawtextValue(fontFile)}'` : '';
            filterGraph += `,drawtext=text='${safeWebsite}'${fontClause}:fontcolor=white:fontsize=${websiteFontSize}:x=(w-text_w)/2:y=${websiteOverlayY}:box=1:boxcolor=black@0.55:boxborderw=8`;
          }
          
          // Use -frames:v 1 to output a single frame (required for JPEG output with image2 muxer)
          await execAsync(`"${ffmpegStatic}" -y -loop 1 -i "${sourceImgPath}" -vf "${filterGraph}" -frames:v 1 -q:v 2 "${processedImgPath}"`);
        } else {
          fs.copyFileSync(sourceImgPath, processedImgPath);
        }
        
        concatContent += `file '${processedImgPath}'\n`;
        concatContent += `duration ${scene.duration}\n`;
      }
      
      // Add last file again due to ffmpeg concat demuxer quirk
      if (renderScenes.length > 0) {
        concatContent += `file '${path.join(this.workDir, `scene_proc_${renderScenes.length - 1}.jpg`)}'\n`;
      }
      
      fs.writeFileSync(concatFilePath, concatContent);
      
      let bgMusicPath = null;
      if (musicSettings && musicSettings.volume > 0) {
        console.log("[MUSIC] Settings received:", {
          preset: musicSettings.preset,
          volume: musicSettings.volume,
          musicPath: musicSettings.musicPath
        });
        
        if (musicSettings.musicPath) {
          // Custom music - resolve the path correctly
          let customPath = musicSettings.musicPath;
          if (customPath.startsWith('/uploads/')) {
            customPath = path.join(process.cwd(), 'public', customPath.replace(/^\//, ''));
          }
          console.log("[MUSIC] Custom music path:", customPath);
          
          if (fs.existsSync(customPath)) {
            bgMusicPath = customPath;
          } else {
            console.warn("[MUSIC] Custom music file not found, falling back to preset");
            bgMusicPath = await this.downloadBackgroundMusic(musicSettings.preset);
          }
        } else {
          console.log("[MUSIC] Using preset:", musicSettings.preset);
          bgMusicPath = await this.downloadBackgroundMusic(musicSettings.preset);
        }
      }

      let ffmpegCmd = '';
      if (bgMusicPath) {
        ffmpegCmd = `"${ffmpegStatic}" -y -f concat -safe 0 -i "${concatFilePath}" -i "${finalAudioPath}" -i "${bgMusicPath}" -filter_complex "[2:a]volume=${musicSettings.volume}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map "[aout]" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
      } else {
        ffmpegCmd = `"${ffmpegStatic}" -y -f concat -safe 0 -i "${concatFilePath}" -i "${finalAudioPath}" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
      }
      
      console.log(`[${this.adId}] Running FFmpeg Command for edited video...`);
      await execAsync(ffmpegCmd, { timeout: 120000 });
      
      return `/uploads/${this.adId}/${path.basename(outputPath)}`;
    } catch (error) {
      console.error('Error in edited video generation:', error);
      throw error;
    }
  }

  async process(websiteUrl: string, generationMode: string = 'basic'): Promise<string> {
    const isRealisticMode = generationMode === 'realistic';
    
    // MANDATORY DEBUG LOGGING
    console.log(`[${this.adId}] =============================================`);
    console.log(`[${this.adId}] VIDEO GENERATION PIPELINE STARTED`);
    console.log(`[${this.adId}] =============================================`);
    console.log(`[${this.adId}] Content type: ${this.contentType} (${this.contentConfig.description})`);
    console.log(`[${this.adId}] Aspect ratio: ${this.contentConfig.aspectRatio} (${this.contentConfig.width}x${this.contentConfig.height})`);
    console.log(`[${this.adId}] Generation mode: ${generationMode}`);
    console.log(`[${this.adId}] Mode type: ${isRealisticMode ? 'REALISTIC (Scene-based Video Clips)' : 'BASIC (Image Slideshow)'}`);
    console.log(`[${this.adId}] Script: ${this.script.substring(0, 100)}...`);
    console.log(`[${this.adId}] Duration: ${this.duration} seconds`);
    console.log(`[${this.adId}] =============================================`);
    
    try {
      // For realistic mode, we ONLY generate video clips - NO image fallback allowed
      if (isRealisticMode) {
        console.log(`[${this.adId}] REALISTIC MODE: Scene-based video clip generation`);
        console.log(`[${this.adId}] =============================================`);
        
        // STEP 1: SCENE SEGMENTATION - Split script into scenes
        let scenes = this.parsedScript?.scenes;
        
        if (!scenes || scenes.length === 0) {
          console.log(`[${this.adId}] No parsed scenes found. Running splitScriptIntoScenes()...`);
          // Pass contentType to splitScriptIntoScenes
          scenes = splitScriptIntoScenes(this.script, this.duration, this.contentType);
          
          if (!scenes || scenes.length === 0) {
            throw new Error("REALISTIC MODE ERROR: Failed to generate scenes from script");
          }
        }
        
        // Log scene breakdown
        console.log(`[${this.adId}] =============================================`);
        console.log(`[${this.adId}] SCENE BREAKDOWN:`);
        console.log(`[${this.adId}] Total scenes: ${scenes.length}`);
        console.log(`[${this.adId}] Scene range: ${this.contentConfig.minScenes}-${this.contentConfig.maxScenes} scenes`);
        let totalDuration = 0;
        scenes.forEach((s, i) => {
          const normalized = normalizeDuration(s.duration);
          totalDuration += normalized;
          console.log(`[${this.adId}]   Scene ${i + 1}: ${normalized}s (original: ${s.duration}s) - "${s.narration.substring(0, 40)}..."`);
          console.log(`[${this.adId}]             Video prompt: "${s.video_prompt.substring(0, 50)}..."`);
        });
        console.log(`[${this.adId}] Total video duration: ${totalDuration} seconds`);
        console.log(`[${this.adId}] =============================================`);
        
        // STEP 2 & 3: Generate video clips for each scene
        console.log(`[${this.adId}] STEP 2 & 3: Generating video clips per scene...`);
        console.log(`[${this.adId}] =============================================`);
        
        // Build scene prompts for video generation with content type style
        const scenePrompts = scenes.map(s => ({
          video_prompt: s.video_prompt || s.image_prompt + ", " + this.contentConfig.style,
          duration: s.duration
        }));
        
        // Generate video clips using the new function (Veo + Luma fallback)
        let videoClips = await generateVideoClipsForScenes(scenePrompts, this.adId);
        
        // STRICT VALIDATION: Must have all video clips
        // If Veo fails, fallback to image mode
        if (!videoClips || videoClips.length === 0) {
          console.log(`[${this.adId}] REALISTIC MODE: Veo failed, falling back to image mode...`);
          console.log(`[${this.adId}] =============================================`);
          
          // Fallback to image-based generation
          const fallbackClips: string[] = await this.generateImageBasedVideo(websiteUrl);
          
          if (fallbackClips.length === 0) {
            throw new Error("REALISTIC MODE ERROR: No video clips were generated and image fallback also failed.");
          }
          
          // Use fallback clips
          videoClips = fallbackClips;
        }
        
        if (videoClips.length !== scenes.length) {
          console.log(`[${this.adId}] REALISTIC MODE: Only ${videoClips.length} clips generated (expected ${scenes.length}), using available clips`);
        }
        
        console.log(`[${this.adId}] =============================================`);
        console.log(`[${this.adId}] Generated ${videoClips.length} video clips successfully`);
        console.log(`[${this.adId}] =============================================`);
        
        // STEP 4: Merge video clips
        console.log(`[${this.adId}] STEP 4: Merging video clips...`);
        const mergedPath = await mergeVideoClips(videoClips, this.adId);
        console.log(`[${this.adId}] Video clips merged: ${mergedPath}`);
        
        // STEP 5: Generate narration audio
        console.log(`[${this.adId}] STEP 5: Generating voiceover...`);
        const narrationScript = scenes.map(s => s.narration).join('. ');
        
        // Generate TTS audio
        const audioPath = await this.generateTTS(undefined, 1, this.language);
        console.log(`[${this.adId}] Voiceover generated: ${audioPath}`);
        
        // STEP 6: Add audio and final touches
        console.log(`[${this.adId}] STEP 6: Adding audio and overlay to video...`);
        const finalVideoPath = await this.addAudioAndOverlay(mergedPath, audioPath, websiteUrl);
        
        console.log(`[${this.adId}] =============================================`);
        console.log(`[${this.adId}] REALISTIC VIDEO GENERATION COMPLETE`);
        console.log(`[${this.adId}] Final video: ${finalVideoPath}`);
        console.log(`[${this.adId}] =============================================`);
        
        return finalVideoPath;
      }
      
      // BASIC MODE: Use image-based slideshow generation
      console.log(`[${this.adId}] BASIC MODE: Generating image slideshow video`);
      console.log(`[${this.adId}] =============================================`);

      // Generate images for the video
      const videoClips: string[] = await this.generateImageBasedVideo(websiteUrl);
      
      // If we still have no video clips, fall back to scraping
      if (videoClips.length === 0) {
        console.log(`[${this.adId}] Falling back to website scraping...`);
        const scrapedImages = await this.scrapeImages(websiteUrl);
        videoClips.push(...scrapedImages);
      }

      // Append a final Call-to-Action frame with QR Code and URL for slideshow
      console.log(`[${this.adId}] Generating final Call-to-Action QR code frame...`);
      try {
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(websiteUrl || "https://example.com")}&color=ffffff&bgcolor=000000`;
        const qrPath = path.join(this.workDir, `raw_qr.png`);
        await this.downloadImage(qrUrl, qrPath);
        
        const finalFrameIdx = videoClips.length + 1;
        const finalFramePath = path.join(this.workDir, `${finalFrameIdx}.jpg`);
        const { width, height } = getRenderDimensions(this.contentConfig);
        
        if (ffmpegStatic) {
          // Create a black background, place the QR code in the center, and add website text below it
          const textOverlay = websiteUrl ? escapeDrawtextValue(websiteUrl.replace(/^https?:\/\//, '')) : 'Visit our website';
          const fontFile = resolveFontFile(this.language);
          const fontClause = fontFile ? `:fontfile='${escapeDrawtextValue(fontFile)}'` : '';
          const ffmpegQrCmd = `"${ffmpegStatic}" -y -f lavfi -i color=c=black:s=${width}x${height} -i "${qrPath}" -filter_complex "[0:v][1:v]overlay=(W-w)/2:(H-h)/2-50[bg];[bg]drawtext=text='${textOverlay}'${fontClause}:fontcolor=white:fontsize=${this.contentType === 'reels' ? 36 : 48}:x=(w-text_w)/2:y=(h-text_h)/2+${this.contentType === 'reels' ? 230 : 250}" -vframes 1 -q:v 2 "${finalFramePath}"`;
          await execAsync(ffmpegQrCmd);
          videoClips.push(finalFramePath);
        }
      } catch (err) {
        console.warn(`[${this.adId}] Failed to generate final CTA frame`, err);
      }

      console.log("Video clips:", videoClips);
      console.log(`[${this.adId}] Assets ready.`);
      const audioPath = await this.generateTTS(undefined, 1, this.language);
      console.log("Audio:", audioPath);
      console.log(`[${this.adId}] Voiceover generated.`);
      const videoUrl = await this.renderVideo(videoClips, audioPath, websiteUrl);
      console.log(`[${this.adId}] Video rendered successfully: ${videoUrl}`);
      return videoUrl;
    } catch (error) {
      console.error('Error in video generation pipeline:', error);
      throw error;
    }
  }
  
  /**
   * Generate video from images (fallback when Veo is not available)
   */
  private async generateImageBasedVideo(websiteUrl: string): Promise<string[]> {
    const images: string[] = [];
    let imageCount: number;
    let sceneImagePrompts: string[] = [];
    const { width, height } = getRenderDimensions(this.contentConfig);
    const frameScaleFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    
    // Get brand style from parsed script or create from website
    let brandStyle: BrandStyle = DEFAULT_BRAND_STYLE;
    let sceneNarrations: string[] = [];
    
    if (this.parsedScript?.scenes && this.parsedScript.scenes.length > 0) {
      imageCount = this.parsedScript.scenes.length;
      sceneImagePrompts = this.parsedScript.scenes.map(s => s.image_prompt);
      sceneNarrations = this.parsedScript.scenes.map(s => s.narration);
      
      // Use brandStyle from first scene if available
      if (this.parsedScript.scenes[0]?.brandStyle) {
        brandStyle = this.parsedScript.scenes[0].brandStyle;
      }
    } else {
      imageCount = Math.max(3, Math.ceil(this.duration / 5));
      
      // Analyze website to get brand information
      if (websiteUrl) {
        try {
          console.log(`[${this.adId}] Analyzing website for brand consistency: ${websiteUrl}`);
          const businessInfo = await analyzeWebsite(websiteUrl);
          brandStyle = createBrandStyle(businessInfo);
          console.log(`[${this.adId}] Brand style created:`, brandStyle);
        } catch (e) {
          console.warn(`[${this.adId}] Failed to analyze website, using default brand style`, e);
        }
      }
    }
    
    for (let i = 0; i < imageCount; i++) {
      try {
        const isFinalCTA = i === imageCount - 1;
        const sceneNarration = sceneNarrations[i] || this.script;
        
        // Build brand-consistent prompt
        const prompt = buildBrandConsistentPrompt(
          sceneNarration,
          i + 1,
          imageCount,
          brandStyle,
          isFinalCTA,
          websiteUrl
        );
        const finalPrompt = this.contentType === 'reels'
          ? `${prompt} Vertical 9:16 composition, mobile format, portrait orientation, centered subject, safe mobile framing, no important content on the sides.`
          : prompt;
        
        console.log(`[${this.adId}] Generating image ${i + 1}/${imageCount} with brand-consistent prompt`);
        console.log(`[${this.adId}] Scene type: ${isFinalCTA ? 'CTA (conversion)' : 'regular scene'}`);
        console.log(`[${this.adId}] Brand: ${brandStyle.name}, Industry: ${brandStyle.industry}`);
          
        const b64Image = await generateAdImage(finalPrompt);
        if (b64Image) {
          const base64Data = b64Image.replace(/^data:image\/\w+;base64,/, "");
          const rawPath = path.join(this.workDir, `gen_raw_${i + 1}.jpg`);
          const imgPath = path.join(this.workDir, `${i + 1}.jpg`);
          const buf = Buffer.from(base64Data, 'base64');
          fs.writeFileSync(rawPath, buf);
          
          if (ffmpegStatic) {
            await execAsync(`"${ffmpegStatic}" -y -i "${rawPath}" -vf "${frameScaleFilter}" -frames:v 1 -q:v 2 "${imgPath}"`);
          } else {
            fs.renameSync(rawPath, imgPath);
          }
          images.push(imgPath);
        }
      } catch (e) {
        console.error(`Failed to generate image ${i+1}`, e);
      }
    }
    
    return images;
  }
  
  /**
   * Concatenate video clips into a single video
   */
  private async concatenateVideoClips(clips: string[]): Promise<string> {
    const concatFilePath = path.join(this.workDir, 'veo_concat.txt');
    let concatContent = '';
    
    for (const clip of clips) {
      concatContent += `file '${clip}'\n`;
    }
    
    fs.writeFileSync(concatFilePath, concatContent);
    
    const outputPath = path.join(this.workDir, 'veo_concatenated.mp4');
    
    if (ffmpegStatic) {
      const ffmpegCmd = `"${ffmpegStatic}" -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${outputPath}"`;
      await execAsync(ffmpegCmd, { timeout: 60000 });
    }
    
    return outputPath;
  }
  
  /**
   * Add audio, text overlays, and final touches to video
   */
  private async addAudioAndOverlay(videoPath: string, audioPath: string, websiteUrl: string, musicSettings?: any): Promise<string> {
    const outputPath = path.join(this.workDir, 'final_ad.mp4');
    let bgMusicPath: string | null = null;
    const desiredMusicVolume = typeof musicSettings?.volume === 'number' ? musicSettings.volume : 0.1;
    if (desiredMusicVolume > 0) {
      if (musicSettings?.musicPath) {
        let customPath = musicSettings.musicPath;
        if (customPath.startsWith('/uploads/')) {
          customPath = path.join(process.cwd(), 'public', customPath.replace(/^\//, ''));
        }
        if (fs.existsSync(customPath)) {
          bgMusicPath = customPath;
        }
      }

      if (!bgMusicPath) {
        bgMusicPath = await this.downloadBackgroundMusic(musicSettings?.preset || 'corporate');
      }
    }
    const logoPath = websiteUrl ? await this.scrapeLogo(websiteUrl) : null;
    
    let ffmpegCmd = '';
    
    if (bgMusicPath && logoPath) {
      ffmpegCmd = `"${ffmpegStatic}" -y -i "${videoPath}" -i "${audioPath}" -i "${bgMusicPath}" -i "${logoPath}" -filter_complex "[2:a]volume=${desiredMusicVolume}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout];[3:v]scale=150:-1[logo];[0:v][logo]overlay=30:30[vout]" -map \"[vout]\" -map \"[aout]\" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    } else if (bgMusicPath) {
      ffmpegCmd = `"${ffmpegStatic}" -y -i "${videoPath}" -i "${audioPath}" -i "${bgMusicPath}" -filter_complex "[2:a]volume=${desiredMusicVolume}[bg];[1:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]" -map 0:v -map \"[aout]\" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    } else if (logoPath) {
      ffmpegCmd = `"${ffmpegStatic}" -y -i "${videoPath}" -i "${audioPath}" -i "${logoPath}" -filter_complex "[2:v]scale=150:-1[logo];[0:v][logo]overlay=30:30[vout]" -map \"[vout]\" -map 1:a -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    } else {
      ffmpegCmd = `"${ffmpegStatic}" -y -i "${videoPath}" -i "${audioPath}" -c:v libx264 -r 30 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}"`;
    }
    
    await execAsync(ffmpegCmd, { timeout: 120000 });
    
    return `/uploads/${this.adId}/final_ad.mp4`;
  }
}
