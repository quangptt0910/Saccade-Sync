import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const { FaceLandmarker, FilesetResolver } = vision;

const video = document.getElementById("calibration-video");
const canvas = document.getElementById("calibration-canvas");
const ctx = canvas.getContext("2d");

const videoContainer = document.querySelector(".video-container");
const staticPreview = document.getElementById("static-preview");

const statusEl = document.getElementById("distance-status");
const startBtn = document.getElementById("start-calibration-btn");
const stopBtn = document.getElementById("stop-calibration-btn");

const distanceOverlay = document.getElementById("distance-overlay");
const overlayStatusText = document.getElementById("overlay-status-text");
const overlayInstructions = document.getElementById("overlay-instructions");

const runCalibBtnOverlay = document.getElementById("run-calibration-btn-overlay");

const gazePointEl = document.getElementById("gaze-point");
const parameterDisplay = document.getElementById("calibration-parameters");

const dotStage = document.getElementById("dot-stage");
const calDot = document.getElementById("cal-dot");
const fsWarning = document.getElementById("fs-warning");
const fsWarningPanel = fsWarning.querySelector(".panel");

let faceLandmarker = null;
let runningCamera = false;
let lastVideoTime = -1;

let distanceOK = false;
let runningDot = false;
let abortDot = false;

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
    return 1 - Math.pow(1, 3);
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
}

function computeEyeDistance(landmarks) {
    const left = landmarks[33];
    const right = landmarks[263];
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function handleDistanceState(landmarks) {
    if (!landmarks) {
        distanceOK = false;
        runCalibBtnOverlay.style.display = "none";
        overlayStatusText.textContent = "NO FACE";
        overlayInstructions.textContent = "Position face in view.";
        statusEl.textContent = "No face detected";
        statusEl.className = "";
        return false;
    }

    const d = computeEyeDistance(landmarks);

    if (d <= DISTANCE_FAR_THRESHOLD) {
        distanceOK = false;
        runCalibBtnOverlay.style.display = "none";
        overlayStatusText.textContent = "TOO FAR";
        overlayInstructions.textContent = "Move closer (≈ 40–100 cm).";
        statusEl.textContent = "Distance Alert: TOO FAR!";
        statusEl.className = "far";
        return false;
    }

    if (d >= DISTANCE_CLOSE_THRESHOLD) {
        distanceOK = false;
        runCalibBtnOverlay.style.display = "none";
        overlayStatusText.textContent = "TOO CLOSE";
        overlayInstructions.textContent = "Move back (≈ 40–100 cm).";
        statusEl.textContent = "Distance Alert: TOO CLOSE!";
        statusEl.className = "close";
        return false;
    }

    distanceOK = true;
    runCalibBtnOverlay.style.display = "inline-block";
    overlayStatusText.textContent = "DISTANCE OK";
    overlayInstructions.textContent =
        "Click Run Calibration to begin calibration.";
    statusEl.textContent = "Distance OK";
    statusEl.className = "good";

    return true;
}

function setCanvasSizeToVideo() {
    if (!video.videoWidth || !video.videoHeight) return;

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(video.videoWidth * dpr);
    canvas.height = Math.round(video.videoHeight * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvas.style.width = `${video.clientWidth}px`;
    canvas.style.height = `${video.clientHeight}px`;
}

function adjustVideoContainerHeight() {
    if (!video.videoWidth || !video.videoHeight) return;

    video.style.width = "100%";
    video.style.height = "auto";

    videoContainer.style.height = `${video.clientHeight}px`;
}

function cameraLoop() {
    if (!runningCamera) return;
    requestAnimationFrame(cameraLoop);

    if (!faceLandmarker) return;
    if (lastVideoTime === video.currentTime) return;
    lastVideoTime = video.currentTime;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!video.paused && !video.ended) {
        const dpr = window.devicePixelRatio || 1;
        ctx.drawImage(
            video,
            0, 0,
            video.videoWidth,
            video.videoHeight,
            0, 0,
            canvas.width / dpr,
            canvas.height / dpr
        );
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

async function startDistanceCheck() {
    if (runningCamera) return;

    runningCamera = true;
    distanceOK = false;

    staticPreview.classList.remove("show-flex");
    staticPreview.style.display = "none";

    stopBtn.style.display = "inline-block";

    video.classList.add("show");
    canvas.classList.add("show");

    runCalibBtnOverlay.style.display = "none";

    distanceOverlay.classList.add("show-flex");


    overlayStatusText.textContent = "Starting camera...";
    overlayInstructions.textContent = "Waiting for video stream...";
    statusEl.textContent = "Performing distance check...";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "user"
            },
            audio: false
        });

        video.srcObject = stream;

        await new Promise((resolve) => {
            const onMeta = () => {
                video.removeEventListener("loadedmetadata", onMeta);
                resolve();
            };
            video.addEventListener("loadedmetadata", onMeta);
        });

        adjustVideoContainerHeight();
        setCanvasSizeToVideo();

        await video.play();

        cameraLoop();
    } catch (err) {
        runningCamera = false;

        staticPreview.classList.add("show-flex");
        staticPreview.style.display = "flex";
        distanceOverlay.classList.remove("show-flex");
        stopBtn.style.display = "none";
        video.classList.remove("show");
        canvas.classList.remove("show");

        overlayStatusText.textContent = "Camera Error!";
        overlayInstructions.textContent =
            "Unable to access camera. Check permissions.";

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
    distanceOK = false;

    runCalibBtnOverlay.style.display = "none";

    if (resetUI) {
        staticPreview.classList.add("show-flex");
        staticPreview.style.display = "flex";

        stopBtn.style.display = "none";
        distanceOverlay.classList.remove("show-flex");

        video.classList.remove("show");
        canvas.classList.remove("show");

        statusEl.textContent = "STATUS: AWAITING START";
        statusEl.className = "";
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    videoContainer.style.height = "";
    canvas.style.width = "";
    canvas.style.height = "";
}

function getDotPoints() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    const margin = Math.max(
        60,
        Math.min(200, Math.round(Math.min(w, h) * 0.08))
    );

    return [
        { x: margin, y: margin },
        { x: w / 2, y: margin },
        { x: w - margin, y: margin },
        { x: margin, y: h / 2 },
        { x: w / 2, y: h / 2 },
        { x: w - margin, y: h / 2 },
        { x: margin, y: h - margin },
        { x: w / 2, y: h - margin },
        { x: w - margin, y: h - margin }
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

            placeDot(
                startX + (tx - startX) * e,
                startY + (ty - startY) * e,
                true
            );

            if (t < 1) requestAnimationFrame(step);
            else resolve();
        }

        requestAnimationFrame(step);
    });
}

async function collectSamplesForPoint(idx, screenX, screenY) {
    let count = 0;

    while (count < SAMPLES_PER_POINT) {
        if (!runningDot || abortDot) break;
        if (!distanceOK) {
            abortDot = true;
            break;
        }

        const results = faceLandmarker.detectForVideo(video, performance.now());

        if (results?.faceLandmarks?.length > 0) {
            const landmarks = results.faceLandmarks[0];
            // Use 468-474 for iris points
            const iris = landmarks.slice(468, 474);

            const cx = iris.reduce((a, p) => a + p.x, 0) / iris.length;
            const cy = iris.reduce((a, p) => a + p.y, 0) / iris.length;
            const radius =
                iris.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) /
                iris.length;

            gazeData.push({
                point_index: idx,
                targetX: screenX,
                targetY: screenY,
                iris_center: { x: cx, y: cy },
                iris_radius: radius
            });

            count++;
        }

        await sleep(SAMPLE_INTERVAL_MS);
    }
}

async function runDotCalibration() {
    if (!runningCamera) {
        alert("Start distance check first.");
        return;
    }

    if (!distanceOK) {
        alert("Stay in correct distance to start calibration.");
        return;
    }

    try {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
        }
    } catch (err) {
        console.warn("Fullscreen blocked.");
    }

    dotStage.style.display = "flex";
    video.classList.remove("show");
    canvas.classList.remove("show");

    const points = getDotPoints();

    abortDot = false;
    runningDot = true;
    gazeData = [];

    placeDot(window.innerWidth / 2, window.innerHeight / 2, true);
    await sleep(200);

    for (let i = 0; i < points.length; i++) {
        if (abortDot) break;
        if (!distanceOK) {
            abortDot = true;
            break;
        }

        const p = points[i];

        await animateDotTo(p.x, p.y, TRANSITION_MS);
        if (abortDot) break;

        placeDot(p.x, p.y, true);
        await collectSamplesForPoint(
            i,
            p.x / window.innerWidth,
            p.y / window.innerHeight
        );

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
        return;
    }

    if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    }

    hideFsWarning();
    dotStage.style.display = "none";
    video.classList.add("show");
    canvas.classList.add("show");

    displayCalibrationParameters();
    displayPredictionModel();
}

function showFsWarning() {
    fsWarning.style.display = "flex";
    if (fsWarningPanel) fsWarningPanel.style.opacity = "1";
    calDot.style.opacity = "0";
    calDot.classList.remove("pulse");
}

function hideFsWarning() {
    fsWarning.style.display = "none";
    if (fsWarningPanel) fsWarningPanel.style.opacity = "0";
}

function displayCalibrationParameters() {
    const grouped = CALIBRATION_POINTS.map((p, i) => {
        const samples = gazeData.filter(s => s.point_index === i);
        if (!samples.length) {
            return {
                label: p.label,
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
            label: p.label,
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
    <table border="1" style="width:100%;max-width:600px;margin:auto;text-align:center;">
      <thead>
        <tr>
            <th>Point</th>
            <th>Samples</th>
            <th>Iris X</th>
            <th>Iris Y</th>
            <th>Iris Radius</th>
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
        </tr>
        `
        )
        .join("")}
      </tbody>
    </table>
    `;
}

function transpose(m) {
    return m[0].map((_, i) => m.map(r => r[i]));
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
    const a = m[0][0], b = m[0][1], c = m[0][2];
    const d = m[1][0], e = m[1][1], f = m[1][2];
    const g = m[2][0], h = m[2][1], i = m[2][2];

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

    return multiply(ATA_inv, ATb).map(r => r[0]);
}

function displayPredictionModel() {
    if (gazeData.length < 3) {
        parameterDisplay.innerHTML += `<p>Not enough samples for fitting model.</p>`;
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

    const px = leastSquares(A, bx);
    const py = leastSquares(A, by);

    if (!px || !py) {
        parameterDisplay.innerHTML += `<p>Matrix inversion failed.</p>`;
        return;
    }

    calibrationModel = {
        a: px[0],
        b: px[1],
        c: px[2],
        d: py[0],
        e: py[1],
        f: py[2]
    };

    parameterDisplay.innerHTML += `
    <h3>Affine Model</h3>
    <p>ScreenX = a*ix + b*iy + c<br>ScreenY = d*ix + e*iy + f</p>
    <table border="1" style="width:100%;max-width:600px;margin:auto;">
        <tr><td>a</td><td>${calibrationModel.a.toFixed(6)}</td></tr>
        <tr><td>b</td><td>${calibrationModel.b.toFixed(6)}</td></tr>
        <tr><td>c</td><td>${calibrationModel.c.toFixed(6)}</td></tr>
        <tr><td>d</td><td>${calibrationModel.d.toFixed(6)}</td></tr>
        <tr><td>e</td><td>${calibrationModel.e.toFixed(6)}</td></tr>
        <tr><td>f</td><td>${calibrationModel.f.toFixed(6)}</td></tr>
    </table>
    `;
}

runCalibBtnOverlay.addEventListener("click", () => {
    runDotCalibration();
});

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

window.addEventListener("resize", () => {
    if (runningCamera) {
        adjustVideoContainerHeight();
        setCanvasSizeToVideo();
    }

    if (runningDot) {
        placeDot(window.innerWidth / 2, window.innerHeight / 2, false);
    }
});

initFaceLandmarker();