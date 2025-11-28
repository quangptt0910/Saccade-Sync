import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const { FaceLandmarker, FilesetResolver } = vision;

const video = document.getElementById("calibration-video");
const canvas = document.getElementById("calibration-canvas");
const ctx = canvas.getContext("2d");

const statusEl = document.getElementById("distance-status");
const startBtn = document.getElementById("start-calibration-btn");
const stopBtn = document.getElementById("stop-calibration-btn");

const distanceOverlay = document.getElementById("distance-overlay");
const overlayStatusText = document.getElementById("overlay-status-text");
const overlayInstructions = document.getElementById("overlay-instructions");
const closeOverlayBtn = document.getElementById("close-overlay-btn");

const gazePointEl = document.getElementById("gaze-point");
const parameterDisplay = document.getElementById("calibration-parameters");

const dotStage = document.getElementById("dot-stage");
const calDot = document.getElementById("cal-dot");
const fsWarning = document.getElementById("fs-warning");
const fsWarningPanel = fsWarning.querySelector(".panel");

let faceLandmarker = null;
let runningCamera = false;
let lastVideoTime = -1;
let isPreChecking = false;
let distanceOK = false;
let distanceCheckFailed = false;

const DISTANCE_FAR_THRESHOLD = 0.12;
const DISTANCE_CLOSE_THRESHOLD = 0.20;

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

let gazeData = [];
let runningDot = false;
let abortDot = false;
let animationFrameId = null;

const DISPLAY_MS = 900;
const TRANSITION_MS = 650;
const WAIT_AFTER = 200;

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

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

function computeEyeDistance(landmarks) {
    const left = landmarks[33];
    const right = landmarks[263];
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function handleDistanceState(landmarks) {
    if (!landmarks) {
        distanceOK = false;
        closeOverlayBtn.style.display = "none";
        return false;
    }

    const d = computeEyeDistance(landmarks);

    if (d < DISTANCE_FAR_THRESHOLD) {
        distanceOK = false;
        closeOverlayBtn.style.display = "none";
        overlayStatusText.textContent = "TOO FAR! ⬅️";
        overlayInstructions.textContent = "Please move closer (≈ 40–100 cm).";
        statusEl.textContent = "Distance Alert: TOO FAR! Move closer.";
        statusEl.className = "far";
        return false;
    }

    if (d > DISTANCE_CLOSE_THRESHOLD) {
        distanceOK = false;
        closeOverlayBtn.style.display = "none";
        overlayStatusText.textContent = "TOO CLOSE! ➡️";
        overlayInstructions.textContent = "Please move back (≈ 40–100 cm).";
        statusEl.textContent = "Distance Alert: TOO CLOSE! Move back.";
        statusEl.className = "close";
        return false;
    }

    distanceOK = true;

    if (isPreChecking) {
        overlayStatusText.textContent = "DISTANCE CORRECT! ✅";
        overlayInstructions.textContent =
            "Keep your head still and click 'Close Window & Start Calibration'.";
        closeOverlayBtn.style.display = "inline-block";
        statusEl.textContent = "DISTANCE CORRECT! ✅";
        statusEl.className = "good";
    } else {
        statusEl.textContent = "Distance OK";
        statusEl.className = "good";
    }

    return true;
}

function cameraLoop() {
    if (!runningCamera) return;

    requestAnimationFrame(cameraLoop);

    if (!faceLandmarker) return;
    if (lastVideoTime === video.currentTime) return;
    lastVideoTime = video.currentTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!video.paused && !video.ended) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    const results = faceLandmarker.detectForVideo(video, performance.now());

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
        handleDistanceState(null);
        if (runningDot && !abortDot) {
            abortDot = true;
            showFsWarning();
        }
        return;
    }

    const landmarks = results.faceLandmarks[0];
    const ok = handleDistanceState(landmarks);

    if (runningDot && !ok && !abortDot) {
        abortDot = true;
        showFsWarning();
    }

    if (!isPreChecking && !runningDot && abortDot && ok) {
        hideFsWarning();
        awaitRestartDotCalibration();
    }
}

let restartTimeout = null;

function awaitRestartDotCalibration() {
    if (restartTimeout) clearTimeout(restartTimeout);

    restartTimeout = setTimeout(async () => {
        abortDot = false;
        statusEl.textContent = "Distance OK — restarting calibration...";
        statusEl.className = "good";
        await sleep(600);
        if (!runningDot) runDotCalibration();
    }, 700);
}

function showFsWarning() {
    fsWarning.style.display = "flex";
    fsWarningPanel.style.opacity = "1";
    calDot.style.opacity = "0";
    calDot.classList.remove("pulse");
}

function hideFsWarning() {
    fsWarning.style.display = "none";
}

async function startDistanceCheck() {
    if (runningCamera) return;

    runningCamera = true;
    isPreChecking = true;
    distanceOK = false;
    distanceCheckFailed = false;

    startBtn.style.display = "none";
    stopBtn.style.display = "inline-block";
    closeOverlayBtn.style.display = "none";
    distanceOverlay.classList.remove("hide");

    overlayStatusText.textContent = "Starting camera...";
    overlayInstructions.textContent = "Waiting for video stream...";
    statusEl.textContent = "Performing Distance Check...";
    statusEl.className = "";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: "user" },
            audio: false
        });

        video.srcObject = stream;
        await video.play();

        canvas.width = 640;
        canvas.height = 360;

        cameraLoop();
    } catch (err) {
        runningCamera = false;
        startBtn.style.display = "inline-block";
        stopBtn.style.display = "none";

        distanceOverlay.classList.remove("hide");
        closeOverlayBtn.style.display = "none";
        overlayStatusText.textContent = "Camera Error!";
        overlayInstructions.textContent =
            "Unable to access camera. Please check permissions.";

        statusEl.textContent = "Camera error.";
        statusEl.className = "far";

        console.error("Camera error:", err);
    }
}

function stopDistanceCheck(resetUI = true) {
    if (!runningCamera) return;

    const tracks = video.srcObject ? video.srcObject.getTracks() : [];
    tracks.forEach(t => t.stop());
    video.srcObject = null;

    runningCamera = false;
    isPreChecking = false;
    distanceOK = false;

    closeOverlayBtn.style.display = "none";

    if (resetUI) {
        startBtn.style.display = "inline-block";
        stopBtn.style.display = "none";
        distanceOverlay.classList.add("hide");
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getDotPoints() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    const margin = Math.max(
        60,
        Math.min(200, Math.round(Math.min(w, h) * 0.08))
    );

    const left = margin,
        right = w - margin,
        top = margin,
        bottom = h - margin;

    const cx = Math.round(w / 2),
        cy = Math.round(h / 2);

    return [
        { x: left, y: top },
        { x: cx, y: top },
        { x: right, y: top },
        { x: left, y: cy },
        { x: cx, y: cy },
        { x: right, y: cy },
        { x: left, y: bottom },
        { x: cx, y: bottom },
        { x: right, y: bottom }
    ];
}

function placeDot(x, y, visible = true) {
    calDot.style.left = `${x}px`;
    calDot.style.top = `${y}px`;
    calDot.style.opacity = visible ? "1" : "0";
    if (visible) calDot.classList.add("pulse");
    else calDot.classList.remove("pulse");
}

function animateDotTo(tx, ty, duration = TRANSITION_MS) {
    return new Promise(resolve => {
        const startX = parseFloat(calDot.style.left || "-1000");
        const startY = parseFloat(calDot.style.top || "-1000");
        const t0 = performance.now();

        function step(now) {
            if (abortDot) return resolve();

            const t = Math.min(1, (now - t0) / duration);
            const e = easeOutCubic(t);
            const x = startX + (tx - startX) * e;
            const y = startY + (ty - startY) * e;

            placeDot(x, y, true);

            if (t < 1) {
                animationFrameId = requestAnimationFrame(step);
            } else {
                resolve();
            }
        }

        animationFrameId = requestAnimationFrame(step);
    });
}

async function runDotCalibration() {
    if (runningDot) return;

    if (!runningCamera) {
        statusEl.textContent = "Camera not active — please run distance check first.";
        statusEl.className = "far";
        return;
    }

    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        }
    } catch (e) {
        console.warn("Fullscreen request failed (may be blocked):", e);
    }

    dotStage.style.display = "flex";
    video.classList.add("hidden");

    const points = getDotPoints();

    abortDot = false;
    runningDot = true;

    placeDot(window.innerWidth / 2, window.innerHeight / 2, false);
    await sleep(120);
    placeDot(window.innerWidth / 2, window.innerHeight / 2, true);

    for (let i = 0; i < points.length; i++) {
        if (!runningDot || abortDot) break;

        if (!distanceOK) {
            abortDot = true;
            break;
        }

        const p = points[i];

        await animateDotTo(p.x, p.y, TRANSITION_MS);
        if (abortDot) break;

        placeDot(p.x, p.y, true);

        const dwellStart = performance.now();
        while (performance.now() - dwellStart < DISPLAY_MS) {
            if (abortDot || !runningDot) break;

            if (!distanceOK) {
                abortDot = true;
                break;
            }

            await sleep(30);
        }

        if (abortDot) break;

        calDot.style.transform = "translate(-50%,-50%) scale(0.85)";
        await sleep(120);
        calDot.style.transform = "translate(-50%,-50%) scale(1)";
        await sleep(WAIT_AFTER);
    }

    if (abortDot) {
        runningDot = false;
        calDot.style.opacity = "0";
        calDot.classList.remove("pulse");
        showFsWarning();
        return;
    }

    runningDot = false;
    calDot.style.opacity = "0";
    calDot.classList.remove("pulse");

    hideFsWarning();
    dotStage.style.display = "none";
    video.classList.remove("hidden");

    displayCalibrationParameters();
}

closeOverlayBtn.addEventListener("click", async () => {
    if (!isPreChecking) return;

    isPreChecking = false;
    distanceOverlay.classList.add("hide");
    closeOverlayBtn.style.display = "none";

    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        }
    } catch (e) {
        console.warn("Fullscreen request failed:", e);
    }

    statusEl.textContent = "Running fullscreen calibration...";
    statusEl.className = "";
    await runDotCalibration();
});

startBtn.addEventListener("click", startDistanceCheck);

stopBtn.addEventListener("click", () => {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }

    runningCamera = false;
    isPreChecking = false;
    distanceOK = false;

    distanceOverlay.classList.remove("hide");
    closeOverlayBtn.style.display = "none";
    startBtn.style.display = "inline-block";
    stopBtn.style.display = "none";

    statusEl.textContent = "Stopped.";
});

function displayCalibrationParameters() {
    const paramSummary = CALIBRATION_POINTS.map((point, idx) => {
        const samples = gazeData.filter(d => d.point_index === idx);
        if (samples.length === 0) {
            return {
                label: point.label,
                count: 0,
                avg_iris: { x: "N/A", y: "N/A", radius: "N/A" }
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
                radius: (avg.radius / samples.length).toFixed(4)
            }
        };
    });

    parameterDisplay.innerHTML = `
|Target Point|Samples|Avg Iris X|Avg Iris Y|Avg Radius|
|--|--|--|--|--|
${paramSummary
        .map(
            p =>
                `|${p.label}|${p.count}|${p.avg_iris.x}|${p.avg_iris.y}|${p.avg_iris.radius}|`
        )
        .join("\n")}
<p style="color:#6b7280;margin-top:8px;font-size:0.9em">
These values are used for personalized gaze detection calibration.
</p>`;
}

initFaceLandmarker().catch(e => {
    console.error("Failed to init face landmarker", e);
    statusEl.textContent = "Model init failed. Check console.";
    statusEl.className = "far";
});
