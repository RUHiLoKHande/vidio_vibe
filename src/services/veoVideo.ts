/**
 * Google Veo 3.1 API Video Generation Service
 * 
 * This service generates real video clips using the Google Veo 3.1 API.
 * It creates actual MP4 video files from text prompts, NOT images or slideshows.
 * 
 * API Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:generateVideo
 * 
 * IMPORTANT: Veo 3.1 only supports fixed durations: 4s, 6s, 8s
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Veo 3.1 Preview API configuration
const VEO_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:generateVideo';

interface VeoVideoGenerationRequest {
  prompt: string;
  duration_seconds: number;
  aspect_ratio: string;
}

interface VeoVideoGenerationResponse {
  name?: string; // Operation name for polling
  done?: boolean;
  error?: {
    code: number;
    message: string;
    status: string;
  };
  response?: {
    video?: {
      uri: string;
    };
  };
  // Also check for alternative response format
  videoUri?: string;
  videoUrl?: string;
  uri?: string;
}

interface VeoVideo {
  uri: string;
  mimeType: string;
}

/**
 * Check if the response contains a valid video URL
 */
function extractVideoUrl(responseData: VeoVideoGenerationResponse): string | null {
  // Check various possible response formats
  const possibleUrls = [
    // Standard format
    responseData.response?.video?.uri,
    // Alternative formats
    responseData.videoUri,
    responseData.videoUrl,
    responseData.uri,
  ];
  
  for (const url of possibleUrls) {
    if (url && typeof url === 'string' && url.length > 0) {
      return url;
    }
  }
  
  return null;
}

/**
 * Convert duration to nearest valid Veo 3.1 duration
 * Veo 3.1 only supports: 4s, 6s, 8s
 */
function convertToValidDuration(requestedDuration: number): number {
  const validDurations = [4, 6, 8];
  
  // Find the nearest valid duration
  let nearest = validDurations[0];
  let minDiff = Math.abs(requestedDuration - nearest);
  
  for (const valid of validDurations) {
    const diff = Math.abs(requestedDuration - valid);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = valid;
    }
  }
  
  console.log(`[Veo 3.1] Converting requested duration ${requestedDuration}s to nearest valid: ${nearest}s`);
  return nearest;
}

/**
 * Generate a video clip using Google Veo 3.1 API (Preview)
 * @param prompt The text prompt describing the video
 * @param duration Duration in seconds (will be converted to 4, 6, or 8)
 * @returns Promise resolving to video buffer (MP4)
 * @throws Error if video generation fails
 */
export async function generateVeoVideo(
  prompt: string, 
  duration: number = 4
): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey || apiKey === '') {
    console.error('[Veo 3.1] ERROR: GEMINI_API_KEY not configured in .env.local');
    throw new Error('GEMINI_API_KEY not configured. Please add your Gemini API key to .env.local');
  }

  // Convert to valid Veo duration
  const validDuration = convertToValidDuration(duration);

  console.log('[Veo 3.1] ============================================');
  console.log('[Veo 3.1] Generating video with Google Veo 3.1 Preview');
  console.log('[Veo 3.1] ============================================');
  console.log('[Veo 3.1] Prompt:', prompt.substring(0, 100) + '...');
  console.log('[Veo 3.1] Requested Duration:', duration, 'seconds');
  console.log('[Veo 3.1] Valid Duration:', validDuration, 'seconds');
  console.log('[Veo 3.1] Aspect Ratio: 16:9');
  console.log('[Veo 3.1] API Endpoint:', VEO_API_BASE_URL);
  console.log('[Veo 3.1] ============================================');

  try {
    // Step 1: Start video generation
    console.log('[Veo 3.1] Starting video generation job...');
    
    const requestBody: VeoVideoGenerationRequest = {
      prompt: prompt,
      duration_seconds: validDuration,
      aspect_ratio: "16:9"
    };

    const response = await axios.post<VeoVideoGenerationResponse>(
      `${VEO_API_BASE_URL}?key=${apiKey}`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60 seconds timeout for request
      }
    );

    console.log('[Veo 3.1] ============================================');
    console.log('[Veo 3.1] FULL API RESPONSE:');
    console.log('[Veo 3.1] Status:', response.status);
    console.log('[Veo 3.1] Headers:', JSON.stringify(response.headers, null, 2));
    console.log('[Veo 3.1] Body:', JSON.stringify(response.data, null, 2));
    console.log('[Veo 3.1] ============================================');

    // Check for API errors
    if (response.data.error) {
      console.error('[Veo 3.1] API ERROR DETECTED:');
      console.error('[Veo 3.1] Error code:', response.data.error.code);
      console.error('[Veo 3.1] Error message:', response.data.error.message);
      console.error('[Veo 3.1] Error status:', response.data.error.status);
      throw new Error(`Veo API error: ${response.data.error.message} (code: ${response.data.error.code})`);
    }

    // Try to extract video URL from response
    const videoUrl = extractVideoUrl(response.data);
    
    if (!videoUrl) {
      console.error('[Veo 3.1] ERROR: No video URL found in response!');
      console.error('[Veo 3.1] Response structure:', JSON.stringify(response.data, null, 2));
      console.error('[Veo 3.1] This may indicate:');
      console.error('[Veo 3.1]   - Model access not granted');
      console.error('[Veo 3.1]   - Experimental API changes');
      console.error('[Veo 3.1]   - Invalid prompt or parameters');
      throw new Error('Veo API did not return a video URL. Model access may not be granted or API may have changed. Please try Replicate fallback.');
    }

    // Handle long-running operation (polling)
    if (response.data.name) {
      console.log('[Veo 3.1] Long-running operation detected, polling for completion...');
      console.log('[Veo 3.1] Operation name:', response.data.name);
      const videoUri = await pollForVideoCompletion(response.data.name, apiKey);
      console.log('[Veo 3.1] Video ready, downloading from:', videoUri);
      const videoBuffer = await downloadVideo(videoUri);
      
      console.log('[Veo 3.1] ============================================');
      console.log('[Veo 3.1] SUCCESS: Video downloaded');
      console.log('[Veo 3.1] Video size:', videoBuffer.length, 'bytes');
      console.log('[Veo 3.1] ============================================');
      
      return videoBuffer;
    }
    
    // Check for inline video response with the extracted URL
    console.log('[Veo 3.1] Inline video URL found:', videoUrl);
    const videoBuffer = await downloadVideo(videoUrl);
    
    console.log('[Veo 3.1] ============================================');
    console.log('[Veo 3.1] SUCCESS: Video downloaded');
    console.log('[Veo 3.1] Video size:', videoBuffer.length, 'bytes');
    console.log('[Veo 3.1] ============================================');
    
    return videoBuffer;

  } catch (error: any) {
    console.error('[Veo 3.1] ============================================');
    console.error('[Veo 3.1] VIDEO GENERATION FAILED');
    console.error('[Veo 3.1] ============================================');
    
    if (error.response) {
      console.error('[Veo 3.1] API Error Response:');
      console.error('[Veo 3.1] Status:', error.response.status);
      console.error('[Veo 3.1] Status Text:', error.response.statusText);
      console.error('[Veo 3.1] Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('[Veo 3.1] Body:', JSON.stringify(error.response.data, null, 2));
      throw new Error(`Veo API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('[Veo 3.1] No response received from API');
      throw new Error('Veo API request failed: No response received');
    } else {
      console.error('[Veo 3.1] Error:', error.message);
      throw new Error(`Veo API error: ${error.message}`);
    }
  }
}

/**
 * Poll the Veo API for video generation completion
 */
async function pollForVideoCompletion(operationName: string, apiKey: string): Promise<string> {
  const maxAttempts = 120; // Poll for up to 10 minutes (5s * 120)
  const pollInterval = 5000; // 5 seconds between polls

  console.log('[Veo 3.1] Polling for video completion...');
  console.log('[Veo 3.1] Operation name:', operationName);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Operations are polled via the operations endpoint
      const operationUrl = `https://generativelanguage.googleapis.com/v1/${operationName}?key=${apiKey}`;
      
      const response = await axios.get<VeoVideoGenerationResponse>(
        operationUrl,
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      console.log(`[Veo 3.1] Poll attempt ${attempt}/${maxAttempts}:`, JSON.stringify(response.data, null, 2));

      const status = response.data.done ? 'completed' : 'processing';
      console.log(`[Veo 3.1] Status: ${status}`);

      if (response.data.done) {
        if (response.data.error) {
          console.error('[Veo 3.1] Poll error:', response.data.error.message);
          throw new Error(`Video generation failed: ${response.data.error.message}`);
        }

        const videoUrl = extractVideoUrl(response.data);
        if (videoUrl) {
          return videoUrl;
        }
        
        console.error('[Veo 3.1] Poll completed but no video URL found');
        console.error('[Veo 3.1] Response:', JSON.stringify(response.data, null, 2));
        throw new Error('Video generation completed but no video URL in response');
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error: any) {
      console.error(`[Veo 3.1] Poll error:`, error.message);
      // Continue polling on network errors
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('Video generation timed out after 10 minutes');
}

/**
 * Download video from URI
 * The URI can be a Google Cloud Storage URL or direct URL
 */
async function downloadVideo(uri: string): Promise<Buffer> {
  console.log('[Veo 3.1] Downloading video from:', uri);
  
  // Handle Google Cloud Storage URIs
  let downloadUrl = uri;
  if (uri.startsWith('gs://')) {
    // For GCS URLs, we need to use the storage API or convert to public URL
    // In production, you'd use signed URLs or Google's recommended approach
    console.log('[Veo 3.1] Note: GCS URI detected. Attempting direct access...');
  }

  try {
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 300000, // 5 minutes timeout for large video download
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      // Follow redirects
      maxRedirects: 5,
    });

    const buffer = Buffer.from(response.data);
    
    // Validate buffer size - minimum reasonable video size
    if (buffer.length < 10000) {
      console.error('[Veo 3.1] WARNING: Downloaded video buffer is very small:', buffer.length, 'bytes');
      throw new Error(`Video buffer too small (${buffer.length} bytes) - likely a failure or placeholder`);
    }
    
    console.log('[Veo 3.1] Download complete, buffer size:', buffer.length, 'bytes');
    return buffer;
  } catch (error: any) {
    console.error('[Veo 3.1] Failed to download video:', error.message);
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

/**
 * Generate multiple video clips for ad scenes using Veo 3.1 API
 * @param scenes Array of scenes with video_prompt and duration
 * @returns Array of video buffers
 * @throws Error if any video generation fails
 */
export async function generateVeoVideosForScenes(
  scenes: Array<{ video_prompt: string; duration: number }>
): Promise<Buffer[]> {
  console.log('[Veo 3.1] ============================================');
  console.log('[Veo 3.1] Starting Veo 3.1 Preview video generation pipeline');
  console.log('[Veo 3.1] ============================================');
  console.log('[Veo 3.1] Total scenes:', scenes.length);
  console.log('[Veo 3.1] API: Google Veo 3.1 Preview (models/veo-3.1-generate-preview)');
  console.log('[Veo 3.1] ============================================');

  const videos: Buffer[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    
    console.log(`[Veo 3.1] ------------------------------------------`);
    console.log(`[Veo 3.1] Generating scene ${i + 1}/${scenes.length}`);
    console.log(`[Veo 3.1] Requested Duration: ${scene.duration}s`);
    console.log(`[Veo 3.1] Prompt: "${scene.video_prompt.substring(0, 80)}..."`);
    console.log(`[Veo 3.1] ------------------------------------------`);

    try {
      const videoBuffer = await generateVeoVideo(scene.video_prompt, scene.duration);
      
      // Validate buffer before accepting
      if (!videoBuffer || videoBuffer.length < 10000) {
        throw new Error(`Generated video buffer too small: ${videoBuffer?.length || 0} bytes`);
      }
      
      videos.push(videoBuffer);
      console.log(`[Veo 3.1] Scene ${i + 1} SUCCESS: ${videoBuffer.length} bytes`);
    } catch (error: any) {
      console.error(`[Veo 3.1] Scene ${i + 1} FAILED:`, error.message);
      throw new Error(`Failed to generate video for scene ${i + 1}: ${error.message}`);
    }
  }

  console.log('[Veo 3.1] ============================================');
  console.log(`[Veo 3.1] ALL ${videos.length} SCENES GENERATED SUCCESSFULLY`);
  console.log('[Veo 3.1] ============================================');

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
  console.log(`[Veo 3.1] Video saved to: ${outputPath}`);
  console.log(`[Veo 3.1] Video file size: ${buffer.length} bytes`);
  
  return outputPath;
}
