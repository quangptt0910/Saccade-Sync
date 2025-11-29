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
let abortDot = false;
let runningDot = false;

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
const TRANSITION_MS = 650;
const WAIT_AFTER = 200;
const SAMPLES_PER_POINT = 15;
const SAMPLE_INTERVAL_MS = 200;
let calibrationModel = null;

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

    if (d <= DISTANCE_FAR_THRESHOLD) {
        distanceOK = false;
        closeOverlayBtn.style.display = "none";
        overlayStatusText.textContent = "TOO FAR";
        overlayInstructions.textContent = "Please move closer (≈ 40–100 cm).";
        statusEl.textContent = "Distance Alert: TOO FAR! Move closer.";
        statusEl.className = "far";
        return false;
    }

    if (d >= DISTANCE_CLOSE_THRESHOLD) {
        distanceOK = false;
        closeOverlayBtn.style.display = "none";
        overlayStatusText.textContent = "TOO CLOSE";
        overlayInstructions.textContent = "Please move back (≈ 40–100 cm).";
        statusEl.textContent = "Distance Alert: TOO CLOSE! Move back.";
        statusEl.className = "close";
        return false;
    }

    distanceOK = true;

    if (isPreChecking) {
        overlayStatusText.textContent = "DISTANCE CORRECT";
        overlayInstructions.textContent =
            "Keep your head still and click 'Proceed to Calibration'.";
        closeOverlayBtn.style.display = "inline-block";
        statusEl.textContent = "DISTANCE CORRECT";
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
}
function showFsWarning() {
    fsWarning.style.display = "flex";
    fsWarningPanel.style.opacity = "1";
    calDot.style.opacity = "0";
    calDot.classList.remove("pulse");
}

function hideFsWarning() {
    fsWarning.style.display = "none";
    fsWarningPanel.style.opacity = "0";
}

async function startDistanceCheck() {
    if (runningCamera) return;

    runningCamera = true;
    isPreChecking = true;
    distanceOK = false;

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
        statusEl.textContent = "STATUS: AWAITING START";
        statusEl.className = "";
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

    const left = margin;
    const right = w - margin;
    const top = margin;
    const bottom = h - margin;

    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);

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
    if (visible) {
        calDot.classList.add("pulse");
    } else {
        calDot.classList.remove("pulse");
    }
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
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(step);
    });
}

async function collectSamplesForPoint(point_index, screenX, screenY) {
    let samplesCollected = 0;

    while (samplesCollected < SAMPLES_PER_POINT) {
        if (!runningDot || abortDot) break;
        if (!distanceOK) {
            abortDot = true;
            break;
        }

        const results = faceLandmarker.detectForVideo(video, performance.now());

        if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
            const landmarks = results.faceLandmarks[0];

            const irisPoints = landmarks.slice(468, 474);
            const centerX =
                irisPoints.reduce((acc, pt) => acc + pt.x, 0) / irisPoints.length;
            const centerY =
                irisPoints.reduce((acc, pt) => acc + pt.y, 0) / irisPoints.length;

            const radius =
                irisPoints.reduce(
                    (acc, pt) => acc + Math.hypot(pt.x - centerX, pt.y - centerY),
                    0
                ) / irisPoints.length;

            gazeData.push({
                point_index,
                targetX: screenX,
                targetY: screenY,
                iris_center: { x: centerX, y: centerY },
                iris_radius: radius
            });

            samplesCollected++;
        }

        await sleep(SAMPLE_INTERVAL_MS);
    }
}

// Main calibration flow
async function runDotCalibration() {
    if (runningDot) return;

    if (!runningCamera) {
        statusEl.textContent =
            "Camera not active — please run distance check first.";
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
    canvas.classList.add("hidden");

    const screenPoints = getDotPoints();

    abortDot = false;
    runningDot = true;
    gazeData = [];

    placeDot(window.innerWidth / 2, window.innerHeight / 2, false);
    await sleep(120);
    placeDot(window.innerWidth / 2, window.innerHeight / 2, true);

    for (let i = 0; i < screenPoints.length; i++) {
        if (!runningDot || abortDot) break;

        if (!distanceOK) {
            abortDot = true;
            break;
        }

        const p = screenPoints[i];

        await animateDotTo(p.x, p.y, TRANSITION_MS);
        if (abortDot) break;

        placeDot(p.x, p.y, true);

        await collectSamplesForPoint(
            i,
            p.x / window.innerWidth,
            p.y / window.innerHeight
        );

        if (abortDot) break;

        calDot.style.transform = "translate(-50%,-50%) scale(0.85)";
        await sleep(120);
        calDot.style.transform = "translate(-50%,-50%) scale(1)";
        await sleep(WAIT_AFTER);
    }

    runningDot = false;
    calDot.style.opacity = "0";
    calDot.classList.remove("pulse");

    if (abortDot) {
        showFsWarning();
    } else {
        hideFsWarning();
        dotStage.style.display = "none";
        video.classList.remove("hidden");
        canvas.classList.remove("hidden");

        displayCalibrationParameters();
        displayPredictionModel();
    }
}

function displayCalibrationParameters() {
    const grouped = CALIBRATION_POINTS.map((point, idx) => {
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
    <h3>Calibration Data Samples</h3>
    <table border="1" cellpadding="5" cellspacing="0" style="margin:auto; width: 100%; max-width: 600px; border-collapse: collapse; text-align: center;">
      <thead>
        <tr>
          <th>Target Point</th>
          <th>Samples</th>
          <th>Avg Iris X</th>
          <th>Avg Iris Y</th>
          <th>Avg Iris Radius</th>
        </tr>
      </thead>
      <tbody>
        ${grouped
        .map(
            p => `
          <tr>
            <td>${p.label}</td>
            <td>${p.count}</td>
            <td>${p.avg_iris.x}</td>
            <td>${p.avg_iris.y}</td>
            <td>${p.avg_iris.radius}</td>
          </tr>`
        )
        .join("")}
      </tbody>
    </table>
    <p style="color:#6b7280;margin-top:8px;font-size:0.9em; text-align: center;">
      These values are used for personalized gaze detection calibration.
    </p>`;
}

function transpose(m) {
    return m[0].map((_, i) => m.map(row => row[i]));
}

function multiply(a, b) {
    const result = [];
    for (let i = 0; i < a.length; i++) {
        result[i] = [];
        for (let j = 0; j < b[0].length; j++) {
            let sum = 0;
            for (let k = 0; k < b.length; k++) {
                sum += a[i][k] * b[k][j];
            }
            result[i][j] = sum;
        }
    }
    return result;
}
function invert3x3(m) {
    const a = m[0][0],
        b = m[0][1],
        c = m[0][2];
    const d = m[1][0],
        e = m[1][1],
        f = m[1][2];
    const g = m[2][0],
        h = m[2][1],
        i = m[2][2];

    const A = e * i - f * h;
    const B = c * h - b * i;
    const C = b * f - c * e;
    const D = f * g - d * i;
    const E = a * i - c * g;
    const F = c * d - a * f;
    const G = d * h - e * g;
    const H = b * g - a * h;
    const I = a * e - b * d;

    const det = a * A + b * D + c * G;
    if (Math.abs(det) < 1e-12) return null;

    const invDet = 1 / det;
    return [
        [A * invDet, B * invDet, C * invDet],
        [D * invDet, E * invDet, F * invDet],
        [G * invDet, H * invDet, I * invDet]
    ];
}

function leastSquares(A, b) {
    const AT = transpose(A);
    const ATA = multiply(AT, A);
    const ATb = multiply(
        AT,
        b.map(v => [v])
    );
    const ATA_inv = invert3x3(ATA);
    if (!ATA_inv) return null;
    const x = multiply(ATA_inv, ATb);
    return x.map(row => row[0]);
}

function displayPredictionModel() {
    if (gazeData.length < 3) {
        parameterDisplay.innerHTML +=
            `<p>Insufficient data for model fitting (need at least 3 samples).</p>`;
        return;
    }

    const A = [];
    const bx = [];
    const by = [];

    gazeData.forEach(d => {
        A.push([d.iris_center.x, d.iris_center.y, 1]);
        bx.push(d.targetX);
        by.push(d.targetY);
    });

    const paramsX = leastSquares(A, bx);
    const paramsY = leastSquares(A, by);

    if (!paramsX || !paramsY) {
        parameterDisplay.innerHTML +=
            `<p style="text-align:center;">Model fitting failed (singular matrix).</p>`;
        return;
    }
    calibrationModel = {
        a: paramsX[0],
        b: paramsX[1],
        c: paramsX[2],
        d: paramsY[0],
        e: paramsY[1],
        f: paramsY[2]
    };
    parameterDisplay.innerHTML += `
    <h3>Calibration Affine Transform Model</h3>
    <p style="text-align: center; font-size: 0.9em; color:#6b7280; margin-bottom: 5px;">
      ScreenX = a * IrisX + b * IrisY + c<br>
      ScreenY = d * IrisX + e * IrisY + f
    </p>
    <table border="1" cellpadding="5" cellspacing="0" style="margin:auto; width: 100%; max-width: 600px; border-collapse: collapse; text-align: left;">
      <thead>
        <tr><th>Parameter</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>a (screenX / irisX)</td><td>${calibrationModel.a.toFixed(6)}</td></tr>
        <tr><td>b (screenX / irisY)</td><td>${calibrationModel.b.toFixed(6)}</td></tr>
        <tr><td>c (screenX offset)</td><td>${calibrationModel.c.toFixed(6)}</td></tr>
        <tr><td>d (screenY / irisX)</td><td>${calibrationModel.d.toFixed(6)}</td></tr>
        <tr><td>e (screenY / irisY)</td><td>${calibrationModel.e.toFixed(6)}</td></tr>
        <tr><td>f (screenY offset)</td><td>${calibrationModel.f.toFixed(6)}</td></tr>
      </tbody>
    </table>
    <p style="color:#6b7280;margin-top:8px;font-size:0.9em; text-align: center;">
      Use these parameters to predict gaze screen position from iris center coordinates.
    </p>`;
}
function predictScreenPosition(irisX, irisY) {
    if (!calibrationModel) return null;
    const { a, b, c, d, e, f } = calibrationModel;
    const screenX = a * irisX + b * irisY + c;
    const screenY = d * irisX + e * irisY + f;
    return { screenX, screenY };
}

startBtn.addEventListener("click", () => {
    if (!faceLandmarker) {
        initFaceLandmarker().then(() => startDistanceCheck());
    } else {
        startDistanceCheck();
    }
});
stopBtn.addEventListener("click", () => {
    stopDistanceCheck();
});
closeOverlayBtn.addEventListener("click", () => {
    distanceOverlay.classList.add("hide");
    isPreChecking = false;
    closeOverlayBtn.style.display = "none";
});

document
    .getElementById("run-calibration-btn")
    .addEventListener("click", () => {
        if (!distanceOK) {
            alert("Distance not OK! Please complete the distance check first.");
            return;
        }
        if (isPreChecking) {
            alert("Please click 'Proceed to Calibration' first.");
            return;
        }
        runDotCalibration();
    });
window.addEventListener("resize", () => {
    if (runningDot) {
        placeDot(window.innerWidth / 2, window.innerHeight / 2, false);
    }
});
initFaceLandmarker();