/**
 * Luma Dream Machine API Video Generation Service
 * 
 * This service generates real video clips using the Luma Dream Machine API.
 * It creates actual MP4 video files from text prompts, NOT images or slideshows.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Luma API configuration
const LUMA_API_BASE_URL = 'https://api.lumalabs.ai/dream-machine';
const LUMA_API_VERSION = 'v1';

interface LumaVideoGenerationRequest {
  prompt: string;
  duration?: number; // 5 seconds for free tier, up to 10 for paid
  loop?: boolean;
}

interface LumaVideoGenerationResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videos?: Array<{
    url: string;
  }>;
  error?: string;
}

/**
 * Generate a video clip using Luma Dream Machine API
 * @param prompt The text prompt describing the video
 * @param duration Duration in seconds (default: 5)
 * @returns Promise resolving to video buffer (MP4)
 * @throws Error if video generation fails
 */
export async function generateLumaVideo(
  prompt: string, 
  duration: number = 5
): Promise<Buffer> {
  const apiKey = process.env.LUMA_API_KEY;
  
  if (!apiKey || apiKey === 'your-luma-api-key-here') {
    console.error('[Luma Video] ERROR: LUMA_API_KEY not configured in .env.local');
    throw new Error('LUMA_API_KEY not configured. Please add your Luma API key to .env.local');
  }

  console.log('[Luma Video] ============================================');
  console.log('[Luma Video] Generating video with Luma Dream Machine');
  console.log('[Luma Video] ============================================');
  console.log('[Luma Video] Prompt:', prompt.substring(0, 100) + '...');
  console.log('[Luma Video] Duration:', duration, 'seconds');
  console.log('[Luma Video] API Endpoint:', LUMA_API_BASE_URL);

  try {
    // Step 1: Start video generation
    console.log('[Luma Video] Starting video generation job...');
    
    const response = await axios.post<LumaVideoGenerationResponse>(
      `${LUMA_API_BASE_URL}/${LUMA_API_VERSION}/generations`,
      {
        prompt: prompt,
        duration: Math.min(duration, 5), // Free tier max is 5 seconds
        loop: false,
      } as LumaVideoGenerationRequest,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const jobId = response.data.id;
    console.log('[Luma Video] Job created with ID:', jobId);
    console.log('[Luma Video] Job status:', response.data.status);

    // Step 2: Poll for completion
    const videoUrl = await pollForVideoCompletion(jobId, apiKey);

    // Step 3: Download the video
    console.log('[Luma Video] Video ready, downloading...');
    const videoBuffer = await downloadVideo(videoUrl);

    console.log('[Luma Video] ============================================');
    console.log('[Luma Video] SUCCESS: Video downloaded');
    console.log('[Luma Video] Video size:', videoBuffer.length, 'bytes');
    console.log('[Luma Video] ============================================');

    return videoBuffer;
  } catch (error: any) {
    console.error('[Luma Video] ============================================');
    console.error('[Luma Video] VIDEO GENERATION FAILED');
    console.error('[Luma Video] ============================================');
    
    if (error.response) {
      console.error('[Luma Video] API Error Response:', error.response.data);
      console.error('[Luma Video] Status:', error.response.status);
      throw new Error(`Luma API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('[Luma Video] No response received from API');
      throw new Error('Luma API request failed: No response received');
    } else {
      console.error('[Luma Video] Error:', error.message);
      throw new Error(`Luma API error: ${error.message}`);
    }
  }
}

/**
 * Poll the Luma API for video generation completion
 */
async function pollForVideoCompletion(jobId: string, apiKey: string): Promise<string> {
  const maxAttempts = 60; // Poll for up to 5 minutes (5s * 60)
  const pollInterval = 5000; // 5 seconds between polls

  console.log('[Luma Video] Polling for video completion...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.get<LumaVideoGenerationResponse>(
        `${LUMA_API_BASE_URL}/${LUMA_API_VERSION}/generations/${jobId}`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 10000,
        }
      );

      const status = response.data.status;
      console.log(`[Luma Video] Poll attempt ${attempt}/${maxAttempts}: ${status}`);

      if (status === 'completed') {
        if (response.data.videos && response.data.videos.length > 0) {
          return response.data.videos[0].url;
        }
        throw new Error('Video generation completed but no video URL in response');
      }

      if (status === 'failed') {
        throw new Error(`Video generation failed: ${response.data.error || 'Unknown error'}`);
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error: any) {
      console.error(`[Luma Video] Poll error:`, error.message);
      // Continue polling on network errors
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('Video generation timed out after 5 minutes');
}

/**
 * Download video from URL
 */
async function downloadVideo(url: string): Promise<Buffer> {
  console.log('[Luma Video] Downloading from:', url);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer',
    timeout: 120000, // 2 minutes timeout for download
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  return Buffer.from(response.data);
}

/**
 * Generate multiple video clips for ad scenes using Luma API
 * @param scenes Array of scenes with video_prompt and duration
 * @returns Array of video buffers
 * @throws Error if any video generation fails
 */
export async function generateLumaVideosForScenes(
  scenes: Array<{ video_prompt: string; duration: number }>
): Promise<Buffer[]> {
  console.log('[Luma Video] ============================================');
  console.log('[Luma Video] Starting Luma video generation pipeline');
  console.log('[Luma Video] ============================================');
  console.log('[Luma Video] Total scenes:', scenes.length);
  console.log('[Luma Video] API: Luma Dream Machine');
  console.log('[Luma Video] ============================================');

  const videos: Buffer[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    // Luma supports up to 5 seconds on free tier
    const clipDuration = Math.min(scene.duration, 5);

    console.log(`[Luma Video] ------------------------------------------`);
    console.log(`[Luma Video] Generating scene ${i + 1}/${scenes.length}`);
    console.log(`[Luma Video] Duration: ${clipDuration}s`);
    console.log(`[Luma Video] Prompt: "${scene.video_prompt.substring(0, 80)}..."`);
    console.log(`[Luma Video] ------------------------------------------`);

    try {
      const videoBuffer = await generateLumaVideo(scene.video_prompt, clipDuration);
      videos.push(videoBuffer);
      console.log(`[Luma Video] Scene ${i + 1} SUCCESS: ${videoBuffer.length} bytes`);
    } catch (error: any) {
      console.error(`[Luma Video] Scene ${i + 1} FAILED:`, error.message);
      throw new Error(`Failed to generate video for scene ${i + 1}: ${error.message}`);
    }
  }

  console.log('[Luma Video] ============================================');
  console.log(`[Luma Video] ALL ${videos.length} SCENES GENERATED SUCCESSFULLY`);
  console.log('[Luma Video] ============================================');

  return videos;
}

/**
 * Save video buffer to file
 */
export function saveVideoBuffer(buffer: Buffer, outputPath: string): string {
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, buffer);
  console.log(`[Luma Video] Video saved to: ${outputPath}`);
  
  return outputPath;
}
