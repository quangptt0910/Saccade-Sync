
// === IMPORTS (ES Module - from MediaPipe CDN) ===
import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');

// Data Display Elements
const leftXEl = document.getElementById('leftX');
const leftYEl = document.getElementById('leftY');
const rightXEl = document.getElementById('rightX');
const rightYEl = document.getElementById('rightY');
const leftREl = document.getElementById('leftR');
const rightREl = document.getElementById('rightR');
const framesEl = document.getElementById('frames');
const fpsEl = document.getElementById('fps');

// NEW: Blend Shapes Display (from MediaPipe demo)
const videoBlendShapes = document.getElementById('video-blend-shapes');

// ============================================================================
// STATE VARIABLES
// ============================================================================

let faceLandmarker = null;  // MODIFIED: Changed from FaceMesh to FaceLandmarker
let isRunning = false;
let frameCount = 0;
let lastFrameTime = performance.now();
let lastVideoTime = -1;  // NEW: Track video time for efficient processing
const recordedData = [];
let webcamRunning = false;

let drawingUtils = null;

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

/**
 * Initialize MediaPipe Face Landmarker with GPU acceleration
 * Loads the AI model from Google's CDN
 * Configures trackign for video mode with blend shapes enabled
 * Creates DrawingUtils for rendering full 478 landmarks
 * This uses the latest @mediapipe/tasks-vision
 * Supports full 478 face landmarks + iris tracking + blend shapes
 * Config:
 * - numFaces: 1 - track one face
 * - runningMode: 'VIDEO' - continuous video processing
 * - delegate: 'GPU' - use GPU for faster processing
 * - outputFaceBlendshapes: true - enable blend shapes (facial expressions)
 * Handles errors gracefully and alerts user if loading fails
 */
async function initialize() {
  try {
    console.log('🚀 Initializing MediaPipe Face Landmarker...');

    // Use FilesetResolver for proper WASM setup
    const filesetResolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );

    // Create FaceLandmarker with GPU delegate
    faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
        delegate: "GPU"  // Use GPU for faster processing
      },
      runningMode: 'VIDEO',  // Process video frames continuously
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true  //Enable blend shapes (facial expressions)
    });

    //  Initialize DrawingUtils for rendering full landmarks
    drawingUtils = new DrawingUtils(canvasCtx);

    console.log('✅ MediaPipe Face Landmarker initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing MediaPipe:', error);
    alert('Failed to load MediaPipe. Please refresh the page.');
  }
}

// ============================================================================
// WEBCAM & TRACKING CONTROL
// ============================================================================

/**
 * Start webcam and tracking
 * Uses proper getUserMedia API with error handling
 * Request webcam access with resolution 1280x720 - common for webcam!? ~ or i hope so
 * Starts the video stream
 * Inia data recording arrays
 * Launches the prediction loop
 * UI buttons
 * Handles errors gracefully and alerts user if webcam access fails
 */
async function startTracking() {
  if (isRunning) return;

  try {
    isRunning = true;
    webcamRunning = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    exportBtn.disabled = true;
    recordedData.length = 0; // Clear previous data
    frameCount = 0;

    // NEW: Get webcam stream with proper constraints
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user'
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = stream;

    // Wait for video to load and start detection
    videoElement.addEventListener('loadedmetadata', () => {
      videoElement.play();
      predictWebcam();  // Start detection loop
    });

    console.log('✅ Camera and tracking started.');
  } catch (error) {
    console.error('❌ Webcam error:', error);
    alert('Failed to access webcam. Please check permissions.');
    isRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

/**
 * Stop webcam and tracking
 * Halt face detection
 * Enables data export if data was recorded
 * Stops the video stream and releases the camera
 * Clears the canvas
 */
function stopTracking() {
  if (!isRunning) return;

  isRunning = false;
  webcamRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  exportBtn.disabled = recordedData.length === 0;

  // Stop camera stream
  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(track => track.stop());
  }

  // Clear canvas
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  console.log('⏹️ Camera and tracking stopped.');
}

// ============================================================================
// DETECTION & RENDERING LOOP
// ============================================================================

/**
 * Main prediction loop for video frames
 * This is the core loop that processes each video frame
 * Replaces the old onResults callback with requestAnimationFrame pattern
 * Captures video frammes using requestAnimationFrame
 * Detect faces via faceLandmarker.detectForVideo()
 * Draws video feed on canvas
 * Render facial landmarks with color coding:
 * - Green for left eye/iris
 * - Red for right eye/iris
 * - Gray for facemesh, face oval, lips
 * Extracts iris landmarks for saccade tracking
 * Calculates pupil radius
 */
async function predictWebcam() {
  if (isRunning && webcamRunning) {
    window.requestAnimationFrame(predictWebcam);
  }


  if (!faceLandmarker || !videoElement) {
    console.log('⏳ Waiting for MediaPipe to initialize...');
    return;
  }

  // Only process when video has a NEW frame (not every render)
  if (lastVideoTime === videoElement.currentTime) {
    return;
  }
  // Update to new frame time
  lastVideoTime = videoElement.currentTime;


  try {
    // Adjust canvas size to match video
    const radio = videoElement.videoHeight / videoElement.videoWidth;
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
    // Only clear if we would draw something


    const startTimeMs = performance.now();
    const results = faceLandmarker.detectForVideo(videoElement, startTimeMs);

    // ========== DRAWING & DATA PROCESSING ==========

    // Draw video frame on canvas
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

    // Draw all face landmarks using DrawingUtils
    if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
      const landmarks = results.faceLandmarks[0];

      // Draw all face landmarks
      try {
        // Draw face tesselation (wireframe)
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_TESSELATION,
            {color: "#C0C0C070", lineWidth: 1}
        );

        // Draw right eye
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
            {color: "#FF3030", lineWidth: 2}
        );

        // Draw right eyebrow
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
            {color: "#FF3030", lineWidth: 2}
        );

        // Draw left eye
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
            {color: "#30FF30", lineWidth: 2}
        );

        // Draw left eyebrow
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
            {color: "#30FF30", lineWidth: 2}
        );

        // Draw face oval (contour)
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
            {color: "#E0E0E0", lineWidth: 2}
        );

        // Draw lips
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_LIPS,
            {color: "#E0E0E0", lineWidth: 2}
        );

        // Draw iris (left in green, right in red)
        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
            {color: "#30FF30", lineWidth: 2}
        );

        drawingUtils.drawConnectors(
            landmarks,
            FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
            {color: "#FF3030", lineWidth: 2}
        );
      } catch (drawError) {
        console.warn('⚠️ Drawing error:', drawError);
      }

      // ========== EXTRACT IRIS DATA FOR SACCADE TRACKING ==========

      // Iris landmark indices for detailed tracking
      const LEFT_IRIS_INDICES = [474, 475, 476, 477];
      const RIGHT_IRIS_INDICES = [469, 470, 471, 472];
      const LEFT_PUPIL_INDICES = [468];
      const RIGHT_PUPIL_INDICES = [473];

      // Extract iris points
      const leftIris = extractLandmarks(landmarks, LEFT_IRIS_INDICES);
      const rightIris = extractLandmarks(landmarks, RIGHT_IRIS_INDICES);
      const leftPupil = landmarks[LEFT_PUPIL_INDICES[0]];
      const rightPupil = landmarks[RIGHT_PUPIL_INDICES[0]];

      // Calculate pupil radius
      const leftPupilRadius = calculateDistance(leftIris[0], leftIris[2]);
      const rightPupilRadius = calculateDistance(rightIris[0], rightIris[2]);

      // Update UI with iris data
      updateDataPanel(leftPupil, rightPupil, leftPupilRadius, rightPupilRadius);

      // Record data for export
      recordedData.push({
        timestamp: startTimeMs,
        leftPupil,
        rightPupil,
        leftPupilRadius,
        rightPupilRadius,
        allLandmarks: landmarks  //  Store all landmarks for feature extraction
      });


      // Draw blend shapes (facial expressions)
      if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
        drawBlendShapes(videoBlendShapes, results.faceBlendshapes);
      }
      updatePerformanceMetrics();

      canvasCtx.restore();
    }

    // Continue loop if still tracking
    if (isRunning && webcamRunning) {
      window.requestAnimationFrame(predictWebcam);
    }
  } catch (error) {
    console.error('❌ Prediction error:', error);
    canvasCtx.save();
    canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.restore();
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Extract specific landmarks from face landmarks array
 * Used to isolate iris and pupil points
 * @param {Array} faceLandmarks - Full array of 478 face landmarks
 * @param {Array<number>} indices - Indices to extract
 * @returns {Array} Extracted landmarks
 */
function extractLandmarks(faceLandmarks, indices) {
  return indices.map(i => faceLandmarks[i]);
}

/**
 * Calculate Euclidean distance between two points
 * Compute Euclidean distance for pupil radius calculation
 * @param {object} p1 - Point 1 {x, y}
 * @param {object} p2 - Point 2 {x, y}
 * @returns {number} Distance
 */
function calculateDistance(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

/**
 * Update performance metrics (FPS, frame count)
 */
function updatePerformanceMetrics() {
  frameCount++;
  const now = performance.now();
  const fps = 1000 / (now - lastFrameTime);
  lastFrameTime = now;
  fpsEl.textContent = fps.toFixed(0);
  framesEl.textContent = frameCount;
}

/**
 * Update data panel with iris tracking information
 * @param {object} leftPupil - Left pupil position
 * @param {object} rightPupil - Right pupil position
 * @param {number} leftRadius - Left pupil radius
 * @param {number} rightRadius - Right pupil radius
 */
function updateDataPanel(leftPupil, rightPupil, leftRadius, rightRadius) {
  leftXEl.textContent = (leftPupil.x * 100).toFixed(2);
  leftYEl.textContent = (leftPupil.y * 100).toFixed(2);
  rightXEl.textContent = (rightPupil.x * 100).toFixed(2);
  rightYEl.textContent = (rightPupil.y * 100).toFixed(2);
  leftREl.textContent = (leftRadius * 100).toFixed(2);
  rightREl.textContent = (rightRadius * 100).toFixed(2);
}

/**
 * NEW: Draw blend shapes (facial expressions) as visual bar chart
 * Shows 52 facial blend shapes with values 0-1
 * @param {HTMLElement} el - Container element
 * @param {Array} blendShapes - Array of blend shape results
 */
function drawBlendShapes(el, blendShapes) {
  if (!blendShapes || blendShapes.length === 0) {
    return;
  }

  console.log('📊 Blend Shapes:', blendShapes[0]);

  let htmlMaker = "";
  if (blendShapes[0].categories) {
    blendShapes[0].categories.forEach((shape) => {
      htmlMaker += `
        <li class="blend-shapes-item">
          <span class="blend-shapes-label">
            ${shape.displayName || shape.categoryName}
          </span>
          <span class="blend-shapes-value" style="width: calc(${
          +shape.score * 100
      }% - 120px)">
            ${(+shape.score).toFixed(4)}
          </span>
        </li>
      `;
    });
  }

  el.innerHTML = htmlMaker;
}

// ============================================================================
// EXPORT FUNCTIONALITY
// ============================================================================

/**
 * Export recorded iris tracking data to CSV file
 */
function exportCSV() {
  if (recordedData.length === 0) {
    alert('❌ No data to export. Please record some tracking data first.');
    return;
  }

  // CSV headers
  const headers = 'timestamp,leftPupilX,leftPupilY,rightPupilX,rightPupilY,leftPupilRadius,rightPupilRadius';

  // CSV rows
  const csvContent = recordedData.map(d =>
      [
        d.timestamp.toFixed(2),
        d.leftPupil.x.toFixed(4),
        d.leftPupil.y.toFixed(4),
        d.rightPupil.x.toFixed(4),
        d.rightPupil.y.toFixed(4),
        d.leftPupilRadius.toFixed(4),
        d.rightPupilRadius.toFixed(4),
      ].join(',')
  ).join('\n');

  // Create and download file
  const blob = new Blob([headers + '\n' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `saccade-sync-data-${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log(`✅ Exported ${recordedData.length} frames of iris tracking data.`);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

startBtn.addEventListener('click', startTracking);
stopBtn.addEventListener('click', stopTracking);
exportBtn.addEventListener('click', exportCSV);

// ============================================================================
// INITIALIZATION
// ============================================================================

initialize();
console.log('✅ Saccade-Sync app initialized. Click "Start Webcam" to begin tracking.');
