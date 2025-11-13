import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const { FaceLandmarker, FilesetResolver } = vision;

const video = document.getElementById("calibration-video");
const canvas = document.getElementById("calibration-canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("distance-status");
const startBtn = document.getElementById("start-calibration-btn");
const stopBtn = document.getElementById("stop-calibration-btn");
const recordBtn = document.getElementById("record-calibration-btn");

const distanceOverlay = document.getElementById("distance-overlay");
const overlayStatusText = document.getElementById("overlay-status-text");
const overlayInstructions = document.getElementById("overlay-instructions");
const closeOverlayBtn = document.getElementById("close-overlay-btn");

const parameterDisplay = document.createElement("div");
parameterDisplay.id = "calibration-parameters";
statusEl.parentNode.insertBefore(parameterDisplay, statusEl.nextSibling);

let faceLandmarker = null;
let running = false;
let lastTime = -1;
let isPreChecking = false;

// normalized coordinates (0.1 = 10% from the edge)
const CALIBRATION_POINTS = [
    { x: 0.1, y: 0.1, label: "Top-Left" },
    { x: 0.5, y: 0.1, label: "Top-Center" },
    { x: 0.9, y: 0.1, label: "Top-Right" },
    { x: 0.1, y: 0.5, label: "Mid-Left" },
    { x: 0.5, y: 0.5, label: "Center" },
    { x: 0.9, y: 0.5, label: "Mid-Right" },
    { x: 0.1, y: 0.9, label: "Bottom-Left" },
    { x: 0.5, y: 0.9, label: "Bottom-Center" },
    { x: 0.9, y: 0.9, label: "Bottom-Right" }
];
const SAMPLES_PER_POINT = 15;
const SAMPLE_DURATION_MS = 250;

// target range: [0.91m, 1.0m] (based on normalized inter-eye distance)
const DISTANCE_FAR_THRESHOLD = 0.12;  // Too Far (< 0.91m / 3ft)
const DISTANCE_CLOSE_THRESHOLD = 0.20; // Too Close (> 1m)

let currentPointIndex = 0;
let isRecording = false;
let gazeData = [];


/**
 * initialization the FaceLandmarker model
 */
async function initFaceLandmarker() {
    statusEl.textContent = "Loading AI model...";

    const resolver = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromOptions(resolver, {
        baseOptions: {
            modelAssetPath:
                "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numFaces: 1
    });

    statusEl.textContent = "Model ready. Click 'Start Check'.";
    statusEl.className = "";
}

/**
 * logic to display parameters (remains the same)
 */
function displayCalibrationParameters() {
    const parameterSummary = CALIBRATION_POINTS.map((point, index) => {
        const pointData = gazeData.filter(d => d.point_index === index);

        if (pointData.length === 0) {
            return { label: point.label, count: 0, avg_iris: { x: 'N/A', y: 'N/A', z: 'N/A' } };
        }

        const avg_iris = pointData.reduce((acc, curr) => ({
            x: acc.x + curr.iris_3d.x, y: acc.y + curr.iris_3d.y, z: acc.z + curr.iris_3d.z
        }), { x: 0, y: 0, z: 0 });

        return {
            label: point.label,
            count: pointData.length,
            avg_iris: {
                x: (avg_iris.x / pointData.length).toFixed(4),
                y: (avg_iris.y / pointData.length).toFixed(4),
                z: (avg_iris.z / pointData.length).toFixed(4)
            }
        };
    });

    let html = `
        <style>
            .param-table {
                width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 0.9em; text-align: left;
                background: #fcfcfc; border-radius: 8px; overflow: hidden;
            }
            .param-table th, .param-table td { padding: 10px 15px; border-bottom: 1px solid #eee; }
            .param-table th { background-color: #e5e7eb; font-weight: 600; color: #4b5563; }
            .param-table tr:last-child td { border-bottom: none; }
            .param-table tr:hover { background-color: #f7f7f7; }
        </style>
        
        <h3>Calibration Parameters (Averages)</h3>
        <table class="param-table">
            <thead>
                <tr>
                    <th>Target Point</th><th>Samples</th><th>Avg. Iris X</th><th>Avg. Iris Y</th><th>Avg. Iris Z</th>
                </tr>
            </thead>
            <tbody>
    `;

    parameterSummary.forEach(p => {
        html += `
            <tr>
                <td>${p.label}</td><td>${p.count}</td><td>${p.avg_iris.x}</td><td>${p.avg_iris.y}</td><td>${p.avg_iris.z}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
        <p style="margin-top: 15px; font-size: 0.9em; color: #6b7280;">
            *Those values will be used in the test to ensure personalisation :))
        </p>
    `;

    parameterDisplay.innerHTML = html;
}

/**
 * updates the UI for the next calibration point or ends the routine
 */
function nextCalibrationPoint() {
    if (currentPointIndex < CALIBRATION_POINTS.length) {

        recordBtn.textContent = `✓ Record (0/${SAMPLES_PER_POINT})`;
        recordBtn.disabled = false;
        recordBtn.style.display = 'inline-block';

        statusEl.textContent = `Look at the dot. Click 'Record'. Point ${currentPointIndex + 1}/${CALIBRATION_POINTS.length}`;
        statusEl.className = "close";
        parameterDisplay.innerHTML = '';

    } else {
        stopCalibration(false);

        statusEl.textContent = "Calibration completed!!";
        statusEl.className = "good";

        stopBtn.style.display = 'none';
        recordBtn.style.display = 'none';
        startBtn.style.display = 'inline-block';

        displayCalibrationParameters();
    }
}

/**
 * starts the camera and initiates the distance pre-check flow
 */
async function startCalibration() {
    if (running) return;

    running = true;
    isPreChecking = true;
    startBtn.style.display = 'none';
    stopBtn.disabled = false;
    stopBtn.style.display = 'inline-block';
    recordBtn.style.display = 'none';

    distanceOverlay.classList.remove('hide');
    overlayStatusText.textContent = "Starting camera...";
    overlayInstructions.textContent = "Waiting for video stream...";
    closeOverlayBtn.style.display = 'none';

    statusEl.textContent = "Performing Distance Check...";
    statusEl.className = "";
    parameterDisplay.innerHTML = '';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" }
        });
        video.srcObject = stream;

        await video.play();

        requestAnimationFrame(loop);
    } catch (e) {
        statusEl.textContent = "Error: Camera access denied or unavailable.";
        statusEl.className = "far";
        distanceOverlay.classList.remove('hide');
        overlayStatusText.textContent = "Camera Error!";
        overlayInstructions.textContent = "Access denied or unavailable. Please check permissions.";
        stopCalibration(true);
        console.error("Camera access error:", e);
    }
}

/**
 * transitions from distance check (overlay closed) to gaze calibration
 */
function continueGazeCalibration() {
    if (!running) return;
    distanceOverlay.classList.add('hide');

    isPreChecking = false;
    currentPointIndex = 0;
    gazeData = [];
    nextCalibrationPoint();
}


/**
 * stops the camera and the process
 */
function stopCalibration(resetButtons = true) {
    running = false;
    isPreChecking = false;
    isRecording = false;

    if (resetButtons) {
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        recordBtn.style.display = 'none';
    }
    distanceOverlay.classList.add('hide');

    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentPointIndex < CALIBRATION_POINTS.length && running) {
        statusEl.textContent = "Calibration stopped.";
        statusEl.className = "";
        parameterDisplay.innerHTML = '';
    }
}
/**
 * starts the automatic data collection for the current point over a set duration
 */
function startRecording() {
    if (isRecording || !running || currentPointIndex >= CALIBRATION_POINTS.length) return;

    isRecording = true;
    recordBtn.disabled = true;

    let samplesCollectedInStep = 0;

    const interval = setInterval(() => {
        samplesCollectedInStep++;

        if (samplesCollectedInStep >= SAMPLES_PER_POINT) {
            clearInterval(interval);
            isRecording = false;
            currentPointIndex++;
            nextCalibrationPoint();
        }
    }, SAMPLE_DURATION_MS / SAMPLES_PER_POINT);
}

/**
 * the main loop for video processing, drawing, and data collection
 */
function loop() {
    if (!running) return;
    requestAnimationFrame(loop);

    if (!faceLandmarker) return;
    if (lastTime === video.currentTime) return;
    lastTime = video.currentTime;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const results = faceLandmarker.detectForVideo(video, performance.now());

    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
        if (isPreChecking) {
            overlayStatusText.textContent = "No face detected!";
            overlayInstructions.textContent = "Please ensure your entire face is visible and centered.";
            closeOverlayBtn.style.display = 'none';
        } else {
            statusEl.textContent = "No face detected. Please center your face.";
            statusEl.className = "";
        }
        return;
    }

    const landmarks = results.faceLandmarks[0];
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];

    if (isPreChecking) {
        const eyeDistance = Math.sqrt(
            Math.pow(leftEyeOuter.x - rightEyeOuter.x, 2) +
            Math.pow(leftEyeOuter.y - rightEyeOuter.y, 2)
        );
        let distanceCheckPassed = false;

        if (eyeDistance < DISTANCE_FAR_THRESHOLD) {
            overlayStatusText.textContent = "TOO FAR! ⬅️";
            overlayInstructions.textContent = "Please move closer. You must be between 3 feet and 1 meter (≈0.91m - 1.0m).";
            closeOverlayBtn.style.display = 'none';
        } else if (eyeDistance > DISTANCE_CLOSE_THRESHOLD) {
            overlayStatusText.textContent = "TOO CLOSE! ➡️";
            overlayInstructions.textContent = "Please move back. You must be between 3 feet and 1 meter (≈0.91m - 1.0m).";
            closeOverlayBtn.style.display = 'none';
        } else {
            overlayStatusText.textContent = "DISTANCE CORRECT! ✅";
            overlayInstructions.textContent = "Now, keep your head still and click 'Close Window' to proceed to calibration.";
            closeOverlayBtn.style.display = 'inline-block';
            distanceCheckPassed = true;
        }

        const forehead = landmarks[10];
        const markerX = forehead.x * canvas.width;
        const markerY = forehead.y * canvas.height;
        ctx.beginPath();
        ctx.arc(markerX, markerY, 8, 0, 2 * Math.PI);
        ctx.fillStyle = distanceCheckPassed ? '#10b981' : '#ef4444';
        ctx.fill();

        return;
    }

    const currentSamplesCount = gazeData.filter(d => d.point_index === currentPointIndex).length;

    if (running && currentPointIndex < CALIBRATION_POINTS.length) {
        const target = CALIBRATION_POINTS[currentPointIndex];
        const targetX = target.x * canvas.width;
        const targetY = target.y * canvas.height;

        ctx.beginPath();
        ctx.arc(targetX, targetY, 15, 0, 2 * Math.PI);
        ctx.fillStyle = isRecording ? '#10b981' : '#ef4444';
        ctx.shadowColor = isRecording ? '#10b981' : '#ef4444';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    if (isRecording) {
        statusEl.textContent = `Collecting samples: ${currentSamplesCount + 1} of ${SAMPLES_PER_POINT}`;
        statusEl.className = "good";

        const eyeMarkerX = leftEyeOuter.x * canvas.width;
        const eyeMarkerY = leftEyeOuter.y * canvas.height;

        ctx.beginPath();
        ctx.arc(eyeMarkerX, eyeMarkerY, 8, 0, 2 * Math.PI);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.stroke();
    }

    if (isRecording && currentSamplesCount < SAMPLES_PER_POINT) {

        const irisData = {
            x: leftEyeOuter.x,
            y: leftEyeOuter.y,
            z: leftEyeOuter.z || 0,
        };

        const currentTarget = CALIBRATION_POINTS[currentPointIndex];

        gazeData.push({
            point_index: currentPointIndex,
            target_x_norm: currentTarget.x,
            target_y_norm: currentTarget.y,
            iris_3d: irisData,
        });
    }
}

startBtn.addEventListener("click", startCalibration);
stopBtn.addEventListener("click", () => stopCalibration(true));
closeOverlayBtn.addEventListener("click", continueGazeCalibration); // New button event
recordBtn.addEventListener("click", startRecording);

initFaceLandmarker();