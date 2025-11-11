// ============================================================================
// SIMPLIFIED APP.JS - General Application Logic
// ============================================================================
// This file handles:
// - MediaPipe Face Landmarker initialization
// - Webcam management
// - Video frame processing
// - General UI controls
// - Data export
// Iris-specific logic is now in iris-tracking.js
// ============================================================================

import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
import { IrisTracker } from './iris-tracking.js';

const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

// ============================================================================
// APPLICATION STATE
// ============================================================================

class AppState {
  constructor() {
    this.faceLandmarker = null;
    this.irisTracker = new IrisTracker();
    this.drawingUtils = null;
    this.isRunning = false;
    this.webcamRunning = false;
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.lastVideoTime = -1;
    this.recordedData = [];
    this.fps = 0;
  }
}

const appState = new AppState();

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize MediaPipe Face Landmarker
 */
async function initialize() {
  try {
    console.log('🚀 Initializing MediaPipe Face Landmarker...');

    const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    appState.faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU"
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false
    });

    appState.drawingUtils = new DrawingUtils(canvasCtx);
    console.log('✅ MediaPipe initialized successfully!');

    return true;
  } catch (error) {
    console.error('❌ Error initializing MediaPipe:', error);
    alert('Failed to load MediaPipe. Please refresh the page.');
    return false;
  }
}

/**
 * Start webcam and tracking
 */
async function startTracking() {
  if (appState.isRunning) return;

  try {
    appState.isRunning = true;
    appState.webcamRunning = true;
    appState.recordedData = [];
    appState.frameCount = 0;
    appState.irisTracker.reset();

    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;

    videoElement.addEventListener('loadedmetadata', () => {
      videoElement.play();
      predictWebcam();
    }, { once: true });

    console.log('✅ Camera started');
    return true;
  } catch (error) {
    console.error('❌ Webcam error:', error);
    alert('Failed to access webcam. Please check permissions.');
    appState.isRunning = false;
    return false;
  }
}

/**
 * Stop webcam and tracking
 */
function stopTracking() {
  if (!appState.isRunning) return;

  appState.isRunning = false;
  appState.webcamRunning = false;

  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
  }

  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  console.log('⏹️ Camera stopped');
}

/**
 * Main prediction loop
 */
async function predictWebcam() {
  if (!appState.isRunning || !appState.webcamRunning) return;

  if (appState.lastVideoTime === videoElement.currentTime) {
    window.requestAnimationFrame(predictWebcam);
    return;
  }

  appState.lastVideoTime = videoElement.currentTime;

  try {
    // Adjust canvas size
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    // Detect faces
    const startTimeMs = performance.now();
    const results = appState.faceLandmarker.detectForVideo(videoElement, startTimeMs);

    // Clear and draw video
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    // Process iris data
    let irisData = null;
    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      // Use IrisTracker to process and draw iris data
      irisData = appState.irisTracker.processIrisData(
          landmarks,
          canvasCtx,
          canvasElement.width,
          canvasElement.height
      );

      // Record data
      appState.recordedData.push({
        timestamp: startTimeMs,
        ...irisData
      });
    }

    canvasCtx.restore();

    // Update performance metrics
    updatePerformanceMetrics();

    // Trigger custom event with iris data (for other pages to use)
    if (irisData) {
      window.dispatchEvent(new CustomEvent('irisDataUpdate', { detail: irisData }));
    }

  } catch (error) {
    console.error('❌ Prediction error:', error);
  }

  window.requestAnimationFrame(predictWebcam);
}

/**
 * Update performance metrics
 */
function updatePerformanceMetrics() {
  appState.frameCount++;
  const now = performance.now();
  appState.fps = 1000 / (now - appState.lastFrameTime);
  appState.lastFrameTime = now;
}

/**
 * Export recorded data to CSV
 */
function exportCSV() {
  if (appState.recordedData.length === 0) {
    alert('❌ No data to export. Please record some tracking data first.');
    return;
  }

  const headers = 'timestamp,leftIrisX,leftIrisY,rightIrisX,rightIrisY,leftRadius,rightRadius,gazeHorizontal,gazeVertical,movementType,movementMagnitude,velocity';

  const csvContent = appState.recordedData.map(d => [
    d.timestamp.toFixed(2),
    d.leftIrisNormalized?.x.toFixed(4) || '',
    d.leftIrisNormalized?.y.toFixed(4) || '',
    d.rightIrisNormalized?.x.toFixed(4) || '',
    d.rightIrisNormalized?.y.toFixed(4) || '',
    d.leftRadius.toFixed(4),
    d.rightRadius.toFixed(4),
    d.gazeDirection.horizontal,
    d.gazeDirection.vertical,
    d.movement.type,
    d.movement.magnitude.toFixed(4),
    d.velocity.toFixed(4)
  ].join(',')).join('\n');

  const blob = new Blob([headers + '\n' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `iris-tracking-data-${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log(`✅ Exported ${appState.recordedData.length} frames of data.`);
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  appState,
  initialize,
  startTracking,
  stopTracking,
  exportCSV
};
