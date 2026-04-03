/**
 * Replicate API Video Generation Service
 * 
 * This service provides a fallback for video generation using Replicate's
 * video generation models (e.g., Luma Dream Machine, Runway, etc.)
 * 
 * Used as fallback when Veo 3.1 fails or is unavailable.
 * 
 * API: https://api.replicate.com/v1/predictions
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Replicate API configuration
const REPLICATE_API_BASE_URL = 'https://api.replicate.com/v1';

interface ReplicatePredictionRequest {
  version: string;
  input: {
    prompt: string;
    duration?: number;
    aspect_ratio?: string;
  };
}

interface ReplicatePredictionResponse {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string | string[] | null;
  error?: string;
  logs?: string;
}

/**
 * Convert duration to valid Replicate model duration
 * Most models support 5 seconds on free tier
 */
function convertToValidDuration(requestedDuration: number): number {
  // Most Replicate video models support up to 5 seconds
  const maxDuration = 5;
  const duration = Math.min(requestedDuration, maxDuration);
  
  console.log(`[Replicate] Converting requested duration ${requestedDuration}s to: ${duration}s`);
  return duration;
}

/**
 * Generate a video clip using Replicate API
 * @param prompt The text prompt describing the video
 * @param duration Duration in seconds (default: 5)
 * @returns Promise resolving to video buffer (MP4)
 * @throws Error if video generation fails
 */
export async function generateReplicateVideo(
  prompt: string, 
  duration: number = 5
): Promise<Buffer> {
  const apiKey = process.env.REPLICATE_API_KEY;
  
  if (!apiKey || apiKey === '') {
    console.error('[Replicate] ERROR: REPLICATE_API_KEY not configured in .env.local');
    throw new Error('REPLICATE_API_KEY not configured. Please add your Replicate API key to .env.local');
  }

  // Convert to valid duration
  const validDuration = convertToValidDuration(duration);

  // Use Luma Dream Machine via Replicate
  // Version ID for Luma Dream Machine
  const modelVersion = '9d4d93f8-69e6-4d57-a34b-2b3a8d5cd3a0'; // Luma Dream Machine v1

  console.log('[Replicate] ============================================');
  console.log('[Replicate] Generating video with Replicate API (Luma Dream Machine)');
  console.log('[Replicate] ============================================');
  console.log('[Replicate] Prompt:', prompt.substring(0, 100) + '...');
  console.log('[Replicate] Duration:', validDuration, 'seconds');
  console.log('[Replicate] Model Version:', modelVersion);
  console.log('[Replicate] API Endpoint:', `${REPLICATE_API_BASE_URL}/predictions`);
  console.log('[Replicate] ============================================');

  try {
    // Step 1: Start prediction
    console.log('[Replicate] Starting prediction...');
    
    const requestBody: ReplicatePredictionRequest = {
      version: modelVersion,
      input: {
        prompt: prompt,
        duration: validDuration,
      }
    };

    const response = await axios.post<ReplicatePredictionResponse>(
      `${REPLICATE_API_BASE_URL}/predictions`,
      requestBody,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60000, // 60 seconds timeout for request
      }
    );

    const predictionId = response.data.id;
    console.log('[Replicate] ============================================');
    console.log('[Replicate] FULL API RESPONSE:');
    console.log('[Replicate] Status:', response.status);
    console.log('[Replicate] Prediction ID:', predictionId);
    console.log('[Replicate] Initial Status:', response.data.status);
    console.log('[Replicate] Response Body:', JSON.stringify(response.data, null, 2));
    console.log('[Replicate] ============================================');

    // Check for immediate errors
    if (response.data.status === 'failed') {
      console.error('[Replicate] PREDICTION FAILED:');
      console.error('[Replicate] Error:', response.data.error);
      console.error('[Replicate] Logs:', response.data.logs);
      throw new Error(`Replicate prediction failed: ${response.data.error || 'Unknown error'}`);
    }

    // If succeeded immediately (rare), return the video
    if (response.data.status === 'succeeded') {
      console.log('[Replicate] Prediction succeeded immediately!');
      return await downloadReplicateVideo(response.data.output);
    }

    // Step 2: Poll for completion
    const videoUrl = await pollForPredictionCompletion(predictionId, apiKey);
    console.log('[Replicate] Video ready, downloading from:', videoUrl);
    const videoBuffer = await downloadReplicateVideo(videoUrl);
    
    console.log('[Replicate] ============================================');
    console.log('[Replicate] SUCCESS: Video downloaded');
    console.log('[Replicate] Video size:', videoBuffer.length, 'bytes');
    console.log('[Replicate] ============================================');
    
    return videoBuffer;

  } catch (error: any) {
    console.error('[Replicate] ============================================');
    console.error('[Replicate] VIDEO GENERATION FAILED');
    console.error('[Replicate] ============================================');
    
    if (error.response) {
      console.error('[Replicate] API Error Response:');
      console.error('[Replicate] Status:', error.response.status);
      console.error('[Replicate] Status Text:', error.response.statusText);
      console.error('[Replicate] Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('[Replicate] Body:', JSON.stringify(error.response.data, null, 2));
      throw new Error(`Replicate API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('[Replicate] No response received from API');
      throw new Error('Replicate API request failed: No response received');
    } else {
      console.error('[Replicate] Error:', error.message);
      throw new Error(`Replicate API error: ${error.message}`);
    }
  }
}

/**
 * Poll Replicate API for prediction completion
 */
async function pollForPredictionCompletion(predictionId: string, apiKey: string): Promise<string> {
  const maxAttempts = 120; // Poll for up to 10 minutes (5s * 120)
  const pollInterval = 5000; // 5 seconds between polls

  console.log('[Replicate] Polling for prediction completion...');
  console.log('[Replicate] Prediction ID:', predictionId);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const predictionUrl = `${REPLICATE_API_BASE_URL}/predictions/${predictionId}`;
      
      const response = await axios.get<ReplicatePredictionResponse>(
        predictionUrl,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      const status = response.data.status;
      console.log(`[Replicate] Poll attempt ${attempt}/${maxAttempts}: ${status}`);
      console.log(`[Replicate] Response:`, JSON.stringify(response.data, null, 2));

      if (status === 'succeeded') {
        console.log('[Replicate] Prediction succeeded!');
        
        // Output can be string or array of strings
        if (response.data.output) {
          if (Array.isArray(response.data.output)) {
            return response.data.output[0];
          }
          return response.data.output;
        }
        
        throw new Error('Prediction succeeded but no output URL found');
      }

      if (status === 'failed') {
        console.error('[Replicate] Prediction failed:', response.data.error);
        console.error('[Replicate] Logs:', response.data.logs);
        throw new Error(`Prediction failed: ${response.data.error || 'Unknown error'}`);
      }

      if (status === 'canceled') {
        throw new Error('Prediction was canceled');
      }

      // Still processing, wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    } catch (error: any) {
      console.error(`[Replicate] Poll error:`, error.message);
      // Continue polling on network errors
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('Video generation timed out after 10 minutes');
}

/**
 * Download video from Replicate output URL
 */
async function downloadReplicateVideo(output: string | string[] | null): Promise<Buffer> {
  // Handle array of outputs
  const downloadUrl = Array.isArray(output) ? output[0] : output;
  
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    throw new Error('Invalid video output URL');
  }
  
  console.log('[Replicate] Downloading video from:', downloadUrl);
  
  try {
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'arraybuffer',
      timeout: 300000, // 5 minutes timeout for large video download
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      maxRedirects: 5,
    });

    const buffer = Buffer.from(response.data);
    
    // Validate buffer size
    if (buffer.length < 10000) {
      console.error('[Replicate] WARNING: Downloaded video buffer is very small:', buffer.length, 'bytes');
      throw new Error(`Video buffer too small (${buffer.length} bytes) - likely a failure`);
    }
    
    console.log('[Replicate] Download complete, buffer size:', buffer.length, 'bytes');
    return buffer;
  } catch (error: any) {
    console.error('[Replicate] Failed to download video:', error.message);
    throw new Error(`Failed to download video: ${error.message}`);
  }
}

/**
 * Generate multiple video clips for ad scenes using Replicate API
 * @param scenes Array of scenes with video_prompt and duration
 * @returns Array of video buffers
 * @throws Error if any video generation fails
 */
export async function generateReplicateVideosForScenes(
  scenes: Array<{ video_prompt: string; duration: number }>
): Promise<Buffer[]> {
  console.log('[Replicate] ============================================');
  console.log('[Replicate] Starting Replicate video generation pipeline');
  console.log('[Replicate] ============================================');
  console.log('[Replicate] Total scenes:', scenes.length);
  console.log('[Replicate] API: Replicate (Luma Dream Machine)');
  console.log('[Replicate] ============================================');

  const videos: Buffer[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    
    console.log(`[Replicate] ------------------------------------------`);
    console.log(`[Replicate] Generating scene ${i + 1}/${scenes.length}`);
    console.log(`[Replicate] Duration: ${scene.duration}s`);
    console.log(`[Replicate] Prompt: "${scene.video_prompt.substring(0, 80)}..."`);
    console.log(`[Replicate] ------------------------------------------`);

    try {
      const videoBuffer = await generateReplicateVideo(scene.video_prompt, scene.duration);
      
      // Validate buffer
      if (!videoBuffer || videoBuffer.length < 10000) {
        throw new Error(`Generated video buffer too small: ${videoBuffer?.length || 0} bytes`);
      }
      
      videos.push(videoBuffer);
      console.log(`[Replicate] Scene ${i + 1} SUCCESS: ${videoBuffer.length} bytes`);
    } catch (error: any) {
      console.error(`[Replicate] Scene ${i + 1} FAILED:`, error.message);
      throw new Error(`Failed to generate video for scene ${i + 1}: ${error.message}`);
    }
  }

  console.log('[Replicate] ============================================');
  console.log(`[Replicate] ALL ${videos.length} SCENES GENERATED SUCCESSFULLY`);
  console.log('[Replicate] ============================================');

  return videos;
}

/**
 * Save video buffer to file
 */
export function saveVideoBuffer(buffer: Buffer, outputPath: string): string {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, buffer);
  console.log(`[Replicate] Video saved to: ${outputPath}`);
  console.log(`[Replicate] Video file size: ${buffer.length} bytes`);
  
  return outputPath;
}
