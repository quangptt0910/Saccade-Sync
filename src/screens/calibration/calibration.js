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

const gazePointEl = document.getElementById("gaze-point");

const parameterDisplay = document.createElement("div");
parameterDisplay.id = "calibration-parameters";
parameterDisplay.style.marginTop = "20px";
statusEl.parentNode.insertBefore(parameterDisplay, statusEl.nextSibling);

let faceLandmarker = null;
let running = false;
let lastTime = -1;
let isPreChecking = false;
let distanceCheckFailed = false;

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
const SAMPLE_INTERVAL_MS = 200;

const DISTANCE_FAR_THRESHOLD = 0.12;
const DISTANCE_CLOSE_THRESHOLD = 0.20;

let currentPointIndex = 0;
let isRecording = false;
let gazeData = [];
let sampleTimer = null;

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

function displayCalibrationParameters() {
    const paramSummary = CALIBRATION_POINTS.map((point, idx) => {
        const samples = gazeData.filter(d => d.point_index === idx);
        if (samples.length === 0) {
            return {
                label: point.label,
                count: 0,
                avg_iris: { x: "N/A", y: "N/A", radius: "N/A" },
            };
        }
        const avg = samples.reduce(
            (acc, cur) => {
                acc.x += cur.iris_center.x;
                acc.y += cur.iris_center.y;
                acc.radius += cur.iris_radius;
                return acc;
            },
            { x: 0, y: 0, radius: 0 }
        );
        return {
            label: point.label,
            count: samples.length,
            avg_iris: {
                x: (avg.x / samples.length).toFixed(4),
                y: (avg.y / samples.length).toFixed(4),
                radius: (avg.radius / samples.length).toFixed(4),
            },
        };
    });

    parameterDisplay.innerHTML = `
        <style>
            #calibration-parameters {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
                    Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
                color: #374151;
                max-width: 450px;
                margin-top: 20px;
            }
            #calibration-parameters h3 {
                font-weight: 600;
                margin-bottom: 8px;
                font-size: 1.2em;
            }
            #calibration-parameters table {
                width: 100%;
                border-collapse: collapse;
                box-shadow: 0 2px 6px rgb(0 0 0 / 0.1);
                border-radius: 6px;
                overflow: hidden;
                background: #fff;
            }
            #calibration-parameters th,
            #calibration-parameters td {
                padding: 12px 15px;
                text-align: left;
                font-size: 0.9em;
            }
            #calibration-parameters th {
                background: #f3f4f6;
                font-weight: 600;
                border-bottom: 1px solid #e5e7eb;
                color: #4b5563;
            }
            #calibration-parameters tbody tr:hover {
                background: #f9fafb;
            }
            #calibration-parameters tbody tr:last-child td {
                border-bottom: none;
            }
            #calibration-parameters p {
                margin-top: 12px;
                font-size: 0.85em;
                color: #6b7280;
            }
        </style>
        <h3>Calibration Results (Iris Center & Radius averages)</h3>
        <table>
            <thead>
                <tr>
                    <th>Target Point</th>
                    <th>Samples</th>
                    <th>Avg Iris X</th>
                    <th>Avg Iris Y</th>
                    <th>Avg Radius</th>
                </tr>
            </thead>
            <tbody>
                ${paramSummary
        .map(
            (p) => `
                <tr>
                    <td>${p.label}</td>
                    <td>${p.count}</td>
                    <td>${p.avg_iris.x}</td>
                    <td>${p.avg_iris.y}</td>
                    <td>${p.avg_iris.radius}</td>
                </tr>
            `
        )
        .join("")}
            </tbody>
        </table>
        <p>*These values are used for personalized gaze detection calibration.</p>
    `;
}


function nextCalibrationPoint() {
    if (currentPointIndex < CALIBRATION_POINTS.length) {
        const target = CALIBRATION_POINTS[currentPointIndex];

        gazePointEl.style.display = "block";
        gazePointEl.style.top = `${target.y * 100}%`;
        gazePointEl.style.left = `${target.x * 100}%`;
        gazePointEl.classList.remove("recording");

        recordBtn.textContent = `✓ Record (0/${SAMPLES_PER_POINT})`;
        recordBtn.disabled = false;
        recordBtn.style.display = "inline-block";

        statusEl.textContent = `Look at the dot and click 'Record'. Point ${currentPointIndex + 1} of ${CALIBRATION_POINTS.length}`;
        statusEl.className = "";
        parameterDisplay.innerHTML = "";
    } else {
        stopCalibration(false);
        statusEl.textContent = "Calibration complete! 🎉";
        statusEl.className = "good";

        stopBtn.style.display = "none";
        recordBtn.style.display = "none";
        startBtn.style.display = "inline-block";
        gazePointEl.style.display = "none";

        displayCalibrationParameters();
    }
}

async function startCalibration() {
    if (running) return;

    running = true;
    isPreChecking = true;
    distanceCheckFailed = false;

    startBtn.style.display = "none";
    stopBtn.disabled = false;
    stopBtn.style.display = "inline-block";
    recordBtn.style.display = "none";
    gazePointEl.style.display = "none";

    distanceOverlay.classList.remove("hide");
    overlayStatusText.textContent = "Starting camera...";
    overlayInstructions.textContent = "Waiting for video stream...";
    closeOverlayBtn.style.display = "none";

    statusEl.textContent = "Performing Distance Check...";
    statusEl.className = "";
    parameterDisplay.innerHTML = "";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" },
        });
        video.srcObject = stream;

        await video.play();

        requestAnimationFrame(loop);
    } catch (e) {
        statusEl.textContent = "Error: Camera access denied or unavailable.";
        statusEl.className = "far";
        distanceOverlay.classList.remove("hide");
        overlayStatusText.textContent = "Camera Error!";
        overlayInstructions.textContent = "Access denied or unavailable. Please check permissions.";
        stopCalibration(true);
        console.error("Camera access error:", e);
    }
}

function continueGazeCalibration() {
    if (!running) return;
    distanceOverlay.classList.add("hide");

    isPreChecking = false;
    currentPointIndex = 0;
    gazeData = [];
    nextCalibrationPoint();
}

function stopCalibration(resetButtons = true) {
    running = false;
    isPreChecking = false;
    isRecording = false;

    if(sampleTimer) {
        clearInterval(sampleTimer);
        sampleTimer = null;
    }

    if (resetButtons) {
        startBtn.style.display = "inline-block";
        stopBtn.style.display = "none";
        recordBtn.style.display = "none";
        gazePointEl.style.display = "none";
    }
    distanceOverlay.classList.add("hide");

    if (video.srcObject) {
        video.srcObject.getTracks().forEach((t) => t.stop());
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentPointIndex < CALIBRATION_POINTS.length && running) {
        statusEl.textContent = "Calibration stopped.";
        statusEl.className = "";
        parameterDisplay.innerHTML = "";
    }
}


function startRecording() {
    if (isRecording || !running || isPreChecking || currentPointIndex >= CALIBRATION_POINTS.length) return;

    isRecording = true;
    recordBtn.disabled = true;
    gazePointEl.classList.add("recording");

    let samplesCollected = 0;

    sampleTimer = setInterval(() => {
        if (!running || distanceCheckFailed) {
            clearInterval(sampleTimer);
            sampleTimer = null;
            return;
        }

        samplesCollected++;
        recordBtn.textContent = `✓ Record (${samplesCollected}/${SAMPLES_PER_POINT})`;

        if (samplesCollected >= SAMPLES_PER_POINT) {
            clearInterval(sampleTimer);
            sampleTimer = null;
            isRecording = false;
            currentPointIndex++;
            nextCalibrationPoint();
        }
    }, SAMPLE_INTERVAL_MS);
}

function checkDistanceAndHandleOverlay(landmarks) {
    const leftEyeOuter = landmarks[33];
    const rightEyeOuter = landmarks[263];

    const eyeDistance = Math.sqrt(
        (leftEyeOuter.x - rightEyeOuter.x) ** 2 + (leftEyeOuter.y - rightEyeOuter.y) ** 2
    );

    let distanceCheckPassed = false;
    let overlayVisible = !distanceOverlay.classList.contains("hide");

    if (eyeDistance < DISTANCE_FAR_THRESHOLD) {
        overlayStatusText.textContent = "TOO FAR! ⬅️";
        overlayInstructions.textContent = "Please move closer. Return to the optimal distance (3 feet - 1 meter) to continue.";
        closeOverlayBtn.style.display = "none";
        statusEl.textContent = "Distance Alert: TOO FAR! Move closer to resume.";
        statusEl.className = "far";
    } else if (eyeDistance > DISTANCE_CLOSE_THRESHOLD) {
        overlayStatusText.textContent = "TOO CLOSE! ➡️";
        overlayInstructions.textContent = "Please move back. Return to the optimal distance (3 feet - 1 meter) to continue.";
        closeOverlayBtn.style.display = "none";
        statusEl.textContent = "Distance Alert: TOO CLOSE! Move back to resume.";
        statusEl.className = "close";
    } else {
        distanceCheckPassed = true;
        statusEl.textContent = isPreChecking ? "DISTANCE CORRECT! ✅" : `Collecting samples: ${gazeData.filter((d) => d.point_index === currentPointIndex).length} / ${SAMPLES_PER_POINT}`;
        statusEl.className = "good";

        if (isPreChecking) {
            overlayStatusText.textContent = "DISTANCE CORRECT! ✅";
            overlayInstructions.textContent = "Keep your head still and click 'Close Window' to start calibration.";
            closeOverlayBtn.style.display = "inline-block";
        }
    }

    if (isPreChecking) {
        if (!overlayVisible) {
            distanceOverlay.classList.remove("hide");
        }
    } else {
        if (!distanceCheckPassed) {
            if (!overlayVisible) {
                isRecording = false;
                recordBtn.disabled = true;
                if (sampleTimer) {
                    clearInterval(sampleTimer);
                    sampleTimer = null;
                }
                gazePointEl.classList.remove("recording");
                distanceOverlay.classList.remove("hide");
                distanceCheckFailed = true;
            }
        } else {
            if (overlayVisible && distanceCheckFailed) {
                distanceCheckFailed = false;
                distanceOverlay.classList.add("hide");
                if (recordBtn.textContent.startsWith("✓ Record")) {
                    startRecording();
                }
                statusEl.textContent = `Look at the dot and click 'Record'. Point ${currentPointIndex + 1} of ${CALIBRATION_POINTS.length}`;
            }
        }
    }

    return distanceCheckPassed;
}

function drawFaceIndicators(landmarks, distanceCheckPassed) {
    const forehead = landmarks[10];
    const markerX = forehead.x * canvas.width;
    const markerY = forehead.y * canvas.height;
    ctx.beginPath();
    ctx.arc(markerX, markerY, 8, 0, 2 * Math.PI);
    ctx.fillStyle = distanceCheckPassed ? "#10b981" : "#ef4444";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
}
function loop() {
    if (!running) return;
    requestAnimationFrame(loop);

    if (!faceLandmarker) return;
    if (lastTime === video.currentTime) return;
    lastTime = video.currentTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const results = faceLandmarker.detectForVideo(video, performance.now());

    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
        if (!isPreChecking && running) {
            distanceCheckFailed = true;
            isRecording = false;
            recordBtn.disabled = true;
            if (sampleTimer) {
                clearInterval(sampleTimer);
                sampleTimer = null;
            }
            gazePointEl.classList.remove("recording");
            distanceOverlay.classList.remove("hide");
        }

        overlayStatusText.textContent = "No face detected!";
        overlayInstructions.textContent = "Please ensure your entire face is visible and centered.";
        closeOverlayBtn.style.display = isPreChecking ? "none" : "inline-block";

        statusEl.textContent = "No face detected. Please center your face.";
        statusEl.className = "far";

        return;
    }

    const landmarks = results.faceLandmarks[0];
    const distanceCheckPassed = checkDistanceAndHandleOverlay(landmarks);
    drawFaceIndicators(landmarks, distanceCheckPassed);


    if (isPreChecking || distanceCheckFailed) {
        return;
    }

    const currentSamplesCount = gazeData.filter((d) => d.point_index === currentPointIndex).length;

    gazePointEl.classList.toggle("recording", isRecording);


    if (isRecording && currentSamplesCount < SAMPLES_PER_POINT) {
        const irisIndices = [468, 473];
        const irisPoints = irisIndices.map(i => landmarks[i]);

        const leftIrisCenter = landmarks[468];
        const rightIrisCenter = landmarks[473];

        const irisCenter = {
            x: (leftIrisCenter.x + rightIrisCenter.x) / 2,
            y: (leftIrisCenter.y + rightIrisCenter.y) / 2
        };

        const irisRadius = Math.abs(leftIrisCenter.x - rightIrisCenter.x) / 2;


        gazeData.push({
            point_index: currentPointIndex,
            target_x_norm: CALIBRATION_POINTS[currentPointIndex].x,
            target_y_norm: CALIBRATION_POINTS[currentPointIndex].y,
            iris_center: { x: irisCenter.x, y: irisCenter.y },
            iris_radius: irisRadius,
        });

        ctx.beginPath();
        ctx.arc(
            irisCenter.x * canvas.width,
            irisCenter.y * canvas.height,
            irisRadius * canvas.width * 5,
            0,
            2 * Math.PI
        );
        ctx.fillStyle = "rgba(59, 130, 246, 0.35)";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(
            irisCenter.x * canvas.width,
            irisCenter.y * canvas.height,
            2,
            0,
            2 * Math.PI
        );
        ctx.fillStyle = "#2563eb";
        ctx.fill();
    }
}

startBtn.addEventListener("click", startCalibration);
stopBtn.addEventListener("click", () => stopCalibration(true));
closeOverlayBtn.addEventListener("click", continueGazeCalibration);
recordBtn.addEventListener("click", startRecording);

initFaceLandmarker();