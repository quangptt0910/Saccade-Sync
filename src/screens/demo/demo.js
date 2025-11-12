// ============================================================================
// ENHANCED IRIS TRACKING DEMO - COMPLETE FIXED VERSION
// Features: Pupil, Iris, Gaze Direction, Eye Movement Detection
// ============================================================================

import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const { FaceLandmarker, FilesetResolver, DrawingUtils } = vision;

// ============================================================================
// IRIS LANDMARK INDICES
// ============================================================================

const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;
const LEFT_IRIS_CONTOUR = [469, 470, 471, 472];
const RIGHT_IRIS_CONTOUR = [474, 475, 476, 477];

// Eye corners for gaze calculation
const LEFT_EYE_INNER = 133;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;

// Eye boundary landmarks
const LEFT_EYE_TOP = [159, 158, 157, 173, 133];
const LEFT_EYE_BOTTOM = [145, 153, 154, 155, 33];
const RIGHT_EYE_TOP = [386, 385, 384, 398, 362];
const RIGHT_EYE_BOTTOM = [374, 380, 381, 382, 263];

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const videoElement = document.getElementById('input_video');
const canvasElement = document.getElementById('output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const statusText = document.getElementById('statusText');

// Data Display Elements
const leftXEl = document.getElementById('leftX');
const leftYEl = document.getElementById('leftY');
const rightXEl = document.getElementById('rightX');
const rightYEl = document.getElementById('rightY');
const leftREl = document.getElementById('leftR');
const rightREl = document.getElementById('rightR');
const framesEl = document.getElementById('frames');
const fpsEl = document.getElementById('fps');
const recordedEl = document.getElementById('recorded');

// Gaze Elements
const gazePointEl = document.getElementById('gazePoint');
const gazeDirectionEl = document.getElementById('gazeDirection');
const gazeHEl = document.getElementById('gazeH');
const gazeVEl = document.getElementById('gazeV');

// Movement Elements
const movementTypeEl = document.getElementById('movementType');
const movementMagnitudeEl = document.getElementById('movementMagnitude');
const velocityEl = document.getElementById('velocity');

// ============================================================================
// STATE VARIABLES
// ============================================================================

let faceLandmarker = null;
let isRunning = false;
let frameCount = 0;
let lastFrameTime = performance.now();
let lastVideoTime = -1;
const recordedData = [];
let webcamRunning = false;
let drawingUtils = null;

// Tracking history
let prevLeftIris = null;
let prevRightIris = null;
let movementHistory = [];
const maxHistoryLength = 10;

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initialize() {
    try {
        console.log('🚀 Initializing MediaPipe Face Landmarker...');
        statusText.textContent = 'Loading MediaPipe...';

        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );

        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
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

        drawingUtils = new DrawingUtils(canvasCtx);
        statusText.textContent = '✅ Ready to start tracking';
        console.log('✅ MediaPipe initialized successfully!');

    } catch (error) {
        console.error('❌ Error initializing MediaPipe:', error);
        statusText.textContent = '❌ Failed to load MediaPipe';
        alert('Failed to load MediaPipe. Please refresh the page.');
    }
}

// ============================================================================
// WEBCAM CONTROL
// ============================================================================

async function startTracking() {
    if (isRunning) return;

    try {
        isRunning = true;
        webcamRunning = true;
        startBtn.disabled = true;
        stopBtn.disabled = false;
        exportBtn.disabled = true;
        recordedData.length = 0;
        frameCount = 0;
        prevLeftIris = null;
        prevRightIris = null;
        movementHistory = [];
        statusText.textContent = '🎥 Starting camera...';

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
            statusText.textContent = '🟢 Tracking active';
            predictWebcam();
        });

        console.log('✅ Camera started');

    } catch (error) {
        console.error('❌ Webcam error:', error);
        statusText.textContent = '❌ Camera access denied';
        alert('Failed to access webcam. Please check permissions.');
        isRunning = false;
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

function stopTracking() {
    if (!isRunning) return;

    isRunning = false;
    webcamRunning = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    exportBtn.disabled = recordedData.length === 0;

    if (videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
    }

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    statusText.textContent = `⏸️ Stopped - ${recordedData.length} frames recorded`;
    console.log('⏹️ Camera stopped');
}

// ============================================================================
// DETECTION LOOP
// ============================================================================

async function predictWebcam() {
    if (!isRunning || !webcamRunning) return;

    if (!faceLandmarker || !videoElement) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    if (lastVideoTime === videoElement.currentTime) {
        window.requestAnimationFrame(predictWebcam);
        return;
    }

    lastVideoTime = videoElement.currentTime;

    try {
        // Adjust canvas size
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;

        const startTimeMs = performance.now();
        const results = faceLandmarker.detectForVideo(videoElement, startTimeMs);

        // Draw video frame
        canvasCtx.save();
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

        // Process landmarks
        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];

            // Draw visualizations
            drawIrisVisualization(landmarks);

            // Process iris data
            const irisData = processIrisData(landmarks);

            // Update UI
            updateUI(irisData);

            // Record data
            recordedData.push({
                timestamp: startTimeMs,
                ...irisData
            });

            recordedEl.textContent = recordedData.length;
        } else {
            updateNoDetection();
        }

        updatePerformanceMetrics();
        canvasCtx.restore();

    } catch (error) {
        console.error('❌ Prediction error:', error);
    }

    window.requestAnimationFrame(predictWebcam);
}

// ============================================================================
// IRIS DATA PROCESSING
// ============================================================================

function processIrisData(landmarks) {
    // Get iris centers
    const leftIris = landmarks[LEFT_IRIS_CENTER];
    const rightIris = landmarks[RIGHT_IRIS_CENTER];

    // Get iris contours
    const leftIrisContour = LEFT_IRIS_CONTOUR.map(idx => landmarks[idx]);
    const rightIrisContour = RIGHT_IRIS_CONTOUR.map(idx => landmarks[idx]);

    // Calculate iris radius (pupil size)
    const leftRadius = calculateIrisRadius(leftIrisContour);
    const rightRadius = calculateIrisRadius(rightIrisContour);

    // Convert to pixel coordinates
    const leftIrisPixel = {
        x: leftIris.x * canvasElement.width,
        y: leftIris.y * canvasElement.height
    };

    const rightIrisPixel = {
        x: rightIris.x * canvasElement.width,
        y: rightIris.y * canvasElement.height
    };

    // Calculate gaze direction
    const gazeDirection = calculateGazeDirection(landmarks, leftIris, rightIris);

    // Detect eye movement
    const movement = detectEyeMovement(leftIris, rightIris);

    // Calculate velocity
    const velocity = calculateVelocity(leftIris, rightIris);

    // Update previous positions
    prevLeftIris = leftIris;
    prevRightIris = rightIris;

    return {
        leftIris: leftIrisPixel,
        rightIris: rightIrisPixel,
        leftIrisNormalized: { x: leftIris.x, y: leftIris.y, z: leftIris.z },
        rightIrisNormalized: { x: rightIris.x, y: rightIris.y, z: rightIris.z },
        leftRadius,
        rightRadius,
        gazeDirection,
        movement,
        velocity
    };
}

function calculateIrisRadius(contourPoints) {
    if (contourPoints.length !== 4) return 0;

    const horizontalDist = calculateDistance(contourPoints[0], contourPoints[2]);
    const verticalDist = calculateDistance(contourPoints[1], contourPoints[3]);

    return (horizontalDist + verticalDist) / 4;
}

function calculateDistance(p1, p2) {
    return Math.sqrt(
        Math.pow(p1.x - p2.x, 2) +
        Math.pow(p1.y - p2.y, 2) +
        Math.pow(p1.z - p2.z, 2)
    );
}


function calculateGazeDirection(landmarks, leftIris, rightIris) {
    // Get eye corners
    const leftEyeInner = landmarks[LEFT_EYE_INNER];
    const leftEyeOuter = landmarks[LEFT_EYE_OUTER];
    const rightEyeInner = landmarks[RIGHT_EYE_INNER];
    const rightEyeOuter = landmarks[RIGHT_EYE_OUTER];

    // Calculate eye widths
    const leftEyeWidth = Math.abs(leftEyeOuter.x - leftEyeInner.x);
    const rightEyeWidth = Math.abs(rightEyeOuter.x - rightEyeInner.x);

    // Calculate eye centers
    const leftEyeCenterX = (leftEyeInner.x + leftEyeOuter.x) / 2;
    const rightEyeCenterX = (rightEyeInner.x + rightEyeOuter.x) / 2;

    // IMPROVED: Calculate relative iris position (0 = left, 0.5 = center, 1 = right)
    const leftIrisRelativeX = 0.5 + (leftIris.x - leftEyeCenterX) / leftEyeWidth;
    const rightIrisRelativeX = 0.5 + (rightIris.x - rightEyeCenterX) / rightEyeWidth;

    // Average both eyes
    const avgRelativeX = (leftIrisRelativeX + rightIrisRelativeX) / 2;

    // IMPROVED VERTICAL: Use more landmarks for better boundary detection
    const leftEyeTop = Math.min(...LEFT_EYE_TOP.map(i => landmarks[i].y));
    const leftEyeBottom = Math.max(...LEFT_EYE_BOTTOM.map(i => landmarks[i].y));
    const leftEyeHeight = leftEyeBottom - leftEyeTop;
    const leftEyeCenterY = (leftEyeTop + leftEyeBottom) / 2;

    const rightEyeTop = Math.min(...RIGHT_EYE_TOP.map(i => landmarks[i].y));
    const rightEyeBottom = Math.max(...RIGHT_EYE_BOTTOM.map(i => landmarks[i].y));
    const rightEyeHeight = rightEyeBottom - rightEyeTop;
    const rightEyeCenterY = (rightEyeTop + rightEyeBottom) / 2;

    // Amplify vertical sensitivity (eyes move less vertically)
    const VERTICAL_AMPLIFICATION = 1.5; // Increase sensitivity by 50%

    const leftIrisRelativeY = 0.5 + ((leftIris.y - leftEyeCenterY) / leftEyeHeight) * VERTICAL_AMPLIFICATION;
    const rightIrisRelativeY = 0.5 + ((rightIris.y - rightEyeCenterY) / rightEyeHeight) * VERTICAL_AMPLIFICATION;
    const avgRelativeY = (leftIrisRelativeY + rightIrisRelativeY) / 2;

    //  Continuous mapping instead of discrete categories
    // Map 0-1 range to -1 to 1 range (centered at 0)
    const gazeX = (avgRelativeX - 0.5) * 2; // -1 (left) to 1 (right)
    const gazeY = (avgRelativeY - 0.5) * 2; // -1 (up) to 1 (down)

    // Narrower dead zone for more sensitivity
    const HORIZONTAL_DEADZONE = 0.15;
    const VERTICAL_DEADZONE = 0.08;

    // Calculate discrete direction (for display text)
    let horizontal = "Center";
    let vertical = "Center";
    let horizontalValue = 0;
    let verticalValue = 0;

    // Horizontal classification
    if (avgRelativeX > (0.5 + HORIZONTAL_DEADZONE)) {
        horizontal = "Left";
        const leftZoneStart = 0.5 + HORIZONTAL_DEADZONE;
        horizontalValue = (avgRelativeX - leftZoneStart) / (1 - leftZoneStart);
    } else if (avgRelativeX < (0.5 - HORIZONTAL_DEADZONE)) {
        horizontal = "Right";
        const rightZoneStart = 0.5 - HORIZONTAL_DEADZONE;
        horizontalValue = (rightZoneStart - avgRelativeX) / rightZoneStart;
    }

    // Vertical classification
    if (avgRelativeY < (0.5 - VERTICAL_DEADZONE)) {
        vertical = "Up";
        const upZoneStart = 0.5 - VERTICAL_DEADZONE;
        verticalValue = (upZoneStart - avgRelativeY) / upZoneStart;
    } else if (avgRelativeY > (0.5 + VERTICAL_DEADZONE)) {
        vertical = "Down";
        const downZoneStart = 0.5 + VERTICAL_DEADZONE;
        verticalValue = (avgRelativeY - downZoneStart) / (1 - downZoneStart);
    }

    const SMOOTHING_ALPHA = 0.3; // 0 = no smoothing, 1 = no history
    if (!window.gazeHistory) {
        window.gazeHistory = { x: gazeX, y: gazeY };
    }

    const smoothedGazeX = window.gazeHistory.x * (1 - SMOOTHING_ALPHA) + gazeX * SMOOTHING_ALPHA;
    const smoothedGazeY = window.gazeHistory.y * (1 - SMOOTHING_ALPHA) + gazeY * SMOOTHING_ALPHA;

    window.gazeHistory = { x: smoothedGazeX, y: smoothedGazeY };

    return {
        horizontal,
        vertical,
        direction: `${horizontal} ${vertical}`,
        horizontalValue: Math.min(1, Math.max(0, horizontalValue)),
        verticalValue: Math.min(1, Math.max(0, verticalValue)),
        rawX: avgRelativeX,
        rawY: avgRelativeY,

        //Continuous gaze values for smooth visualization
        continuousGazeX: smoothedGazeX, // -1 to 1
        continuousGazeY: smoothedGazeY  // -1 to 1
    };
}


function updateGazeVisualization(gazeDirection) {
    const maxOffset = 45; // percentage from center

    // Smooth non-linear scaling for natural feel
    const scaleNonLinear = (value) => {
        const sign = Math.sign(value);
        const abs = Math.abs(value);
        return sign * Math.pow(abs, 0.8); // Slight curve for better control
    };

    // So we need to INVERT the continuousGazeX
    const scaledGazeX = -scaleNonLinear(gazeDirection.continuousGazeX); // ← INVERT
    const scaledGazeY = scaleNonLinear(gazeDirection.continuousGazeY);

    // Map to pixel offsets
    const offsetX = scaledGazeX * maxOffset;
    const offsetY = scaledGazeY * maxOffset;

    // Use CSS transition for fluid motion
    gazePointEl.style.transition = 'left 0.1s ease-out, top 0.1s ease-out, width 0.1s ease-out, height 0.1s ease-out';
    gazePointEl.style.left = `calc(50% + ${offsetX}%)`;
    gazePointEl.style.top = `calc(50% + ${offsetY}%)`;

    //   Size indicates gaze intensity
    const gazeIntensity = Math.sqrt(scaledGazeX * scaledGazeX + scaledGazeY * scaledGazeY);
    const pointSize = 20 + (gazeIntensity * 10); // 20px to 30px
    gazePointEl.style.width = `${pointSize}px`;
    gazePointEl.style.height = `${pointSize}px`;

    //   Add glow effect based on intensity
    const glowIntensity = gazeIntensity * 15;
    gazePointEl.style.boxShadow = `0 0 ${glowIntensity}px rgba(76, 175, 80, 0.8)`;

    // DEBUG: Verify alignment
    console.log(
        `Label: ${gazeDirection.direction} | ` +
        `rawX: ${gazeDirection.rawX.toFixed(2)}, rawY: ${gazeDirection.rawY.toFixed(2)} | ` +
        `continuousX: ${gazeDirection.continuousGazeX.toFixed(2)}, continuousY: ${gazeDirection.continuousGazeY.toFixed(2)} | ` +
        `scaledX: ${scaledGazeX.toFixed(2)}, scaledY: ${scaledGazeY.toFixed(2)} | ` +
        `offset: (${offsetX.toFixed(1)}%, ${offsetY.toFixed(1)}%)`
    );
}



function detectEyeMovement(leftIris, rightIris) {
    if (!prevLeftIris || !prevRightIris) {
        return {
            type: "Initializing",
            magnitude: 0,
            direction: { x: 0, y: 0 }
        };
    }

    const leftDeltaX = leftIris.x - prevLeftIris.x;
    const leftDeltaY = leftIris.y - prevLeftIris.y;
    const rightDeltaX = rightIris.x - prevRightIris.x;
    const rightDeltaY = rightIris.y - prevRightIris.y;

    const avgDeltaX = (leftDeltaX + rightDeltaX) / 2;
    const avgDeltaY = (leftDeltaY + rightDeltaY) / 2;
    const totalMovement = Math.sqrt(avgDeltaX * avgDeltaX + avgDeltaY * avgDeltaY);

    let type = "Steady";
    if (totalMovement > 0.015) type = "Saccade";
    else if (totalMovement > 0.008) type = "Rapid";
    else if (totalMovement > 0.004) type = "Moderate";
    else if (totalMovement > 0.001) type = "Slight";

    return {
        type,
        magnitude: totalMovement,
        direction: { x: avgDeltaX, y: avgDeltaY }
    };
}

function calculateVelocity(leftIris, rightIris) {
    if (!prevLeftIris || !prevRightIris) {
        return 0;
    }

    const leftMovement = calculateDistance(leftIris, prevLeftIris);
    const rightMovement = calculateDistance(rightIris, prevRightIris);
    const avgMovement = (leftMovement + rightMovement) / 2;

    movementHistory.push(avgMovement);
    if (movementHistory.length > maxHistoryLength) {
        movementHistory.shift();
    }

    const sum = movementHistory.reduce((a, b) => a + b, 0);
    return sum / movementHistory.length;
}

// ============================================================================
// VISUALIZATION
// ============================================================================

function drawIrisVisualization(landmarks) {
    // Draw eye contours
    drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
        { color: "#00FF00", lineWidth: 2 }
    );

    drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
        { color: "#FF3030", lineWidth: 2 }
    );

    // Draw iris
    drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
        { color: "#00FF00", lineWidth: 3 }
    );

    drawingUtils.drawConnectors(
        landmarks,
        FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
        { color: "#FF3030", lineWidth: 3 }
    );

    // Highlight iris centers
    const leftIris = landmarks[LEFT_IRIS_CENTER];
    const rightIris = landmarks[RIGHT_IRIS_CENTER];

    drawPoint(leftIris, '#00FF00', 6);
    drawPoint(rightIris, '#FF3030', 6);

    drawCircle(leftIris, 20, '#00FF00', 2);
    drawCircle(rightIris, 20, '#FF3030', 2);
}

function drawPoint(landmark, color, size) {
    const x = landmark.x * canvasElement.width;
    const y = landmark.y * canvasElement.height;

    canvasCtx.beginPath();
    canvasCtx.arc(x, y, size, 0, 2 * Math.PI);
    canvasCtx.fillStyle = color;
    canvasCtx.fill();

    canvasCtx.shadowBlur = 10;
    canvasCtx.shadowColor = color;
    canvasCtx.fill();
    canvasCtx.shadowBlur = 0;
}

function drawCircle(landmark, radius, color, lineWidth) {
    const x = landmark.x * canvasElement.width;
    const y = landmark.y * canvasElement.height;

    canvasCtx.beginPath();
    canvasCtx.arc(x, y, radius, 0, 2 * Math.PI);
    canvasCtx.strokeStyle = color;
    canvasCtx.lineWidth = lineWidth;
    canvasCtx.stroke();
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateUI(irisData) {
    // Iris position
    leftXEl.textContent = irisData.leftIris.x.toFixed(1);
    leftYEl.textContent = irisData.leftIris.y.toFixed(1);
    rightXEl.textContent = irisData.rightIris.x.toFixed(1);
    rightYEl.textContent = irisData.rightIris.y.toFixed(1);

    // Pupil radius
    leftREl.textContent = (irisData.leftRadius * 100).toFixed(2);
    rightREl.textContent = (irisData.rightRadius * 100).toFixed(2);

    // Gaze direction
    gazeDirectionEl.textContent = irisData.gazeDirection.direction;
    gazeHEl.textContent = irisData.gazeDirection.horizontal;
    gazeVEl.textContent = irisData.gazeDirection.vertical;

    // Update gaze visualizer
    updateGazeVisualization(irisData.gazeDirection);

    // Eye movement
    movementTypeEl.textContent = irisData.movement.type;
    movementMagnitudeEl.textContent = `Magnitude: ${irisData.movement.magnitude.toFixed(4)}`;

    // Color code movement type
    let color = '#4CAF50';
    if (irisData.movement.type === 'Saccade') color = '#f44336';
    else if (irisData.movement.type === 'Rapid') color = '#FF9800';
    else if (irisData.movement.type === 'Moderate') color = '#FFC107';
    movementTypeEl.style.color = color;

    // Velocity
    velocityEl.textContent = (irisData.velocity * 1000).toFixed(2);
}



function updateNoDetection() {
    leftXEl.textContent = '-';
    leftYEl.textContent = '-';
    rightXEl.textContent = '-';
    rightYEl.textContent = '-';
    leftREl.textContent = '-';
    rightREl.textContent = '-';
    gazeDirectionEl.textContent = 'No face detected';
    gazeHEl.textContent = '-';
    gazeVEl.textContent = '-';
    movementTypeEl.textContent = 'No detection';
    movementMagnitudeEl.textContent = 'Magnitude: 0.000';
    velocityEl.textContent = '0.00';
}

function updatePerformanceMetrics() {
    frameCount++;
    const now = performance.now();
    const fps = 1000 / (now - lastFrameTime);
    lastFrameTime = now;
    fpsEl.textContent = fps.toFixed(0);
    framesEl.textContent = frameCount;
}

// ============================================================================
// EXPORT FUNCTION
// ============================================================================

function exportCSV() {
    if (recordedData.length === 0) {
        alert('❌ No data to export. Please record some tracking data first.');
        return;
    }

    const headers = 'timestamp,leftIrisX,leftIrisY,rightIrisX,rightIrisY,leftRadius,rightRadius,gazeHorizontal,gazeVertical,gazeDirection,movementType,movementMagnitude,velocity';

    const csvContent = recordedData.map(d => [
        d.timestamp.toFixed(2),
        d.leftIrisNormalized.x.toFixed(4),
        d.leftIrisNormalized.y.toFixed(4),
        d.rightIrisNormalized.x.toFixed(4),
        d.rightIrisNormalized.y.toFixed(4),
        d.leftRadius.toFixed(4),
        d.rightRadius.toFixed(4),
        d.gazeDirection.horizontal,
        d.gazeDirection.vertical,
        d.gazeDirection.direction,
        d.movement.type,
        d.movement.magnitude.toFixed(4),
        d.velocity.toFixed(4)
    ].join(',')).join('\n');

    const blob = new Blob([headers + '\n' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `advanced-iris-tracking-${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log(`✅ Exported ${recordedData.length} frames of data.`);
    alert(`✅ Successfully exported ${recordedData.length} frames with full iris tracking data!`);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

startBtn.addEventListener('click', startTracking);
stopBtn.addEventListener('click', stopTracking);
exportBtn.addEventListener('click', exportCSV);

// ============================================================================
// INITIALIZE ON LOAD
// ============================================================================

initialize();
