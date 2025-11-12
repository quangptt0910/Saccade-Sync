import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";
const { FaceLandmarker, FilesetResolver } = vision;

const video = document.getElementById("calibration-video");
const canvas = document.getElementById("calibration-canvas");
const ctx = canvas.getContext("2d");
const statusEl = document.getElementById("distance-status");
const startBtn = document.getElementById("start-calibration-btn");
const stopBtn = document.getElementById("stop-calibration-btn");

let faceLandmarker = null;
let running = false;
let lastTime = -1;

async function initFaceLandmarker() {
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
    console.log("FaceLandmarker ready for calibration");
}

async function startCalibration() {
    if (running) return;
    running = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusEl.textContent = "Starting camera...";

    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" }
    });
    video.srcObject = stream;

    await video.play();
    requestAnimationFrame(loop);
}

function stopCalibration() {
    running = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
    }
    statusEl.textContent = "Calibration stopped.";
}

function loop() {
    if (!running) return;
    requestAnimationFrame(loop);

    if (!faceLandmarker) return;
    if (lastTime === video.currentTime) return;
    lastTime = video.currentTime;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const results = faceLandmarker.detectForVideo(video, performance.now());
    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
        statusEl.textContent = "No face detected. Please face the camera.";
        statusEl.className = "";
        return;
    }

    const landmarks = results.faceLandmarks[0];

    //estimating distance using eye corner distance
    const leftEyeOuter = landmarks[33]; //left eye outer corner
    const rightEyeOuter = landmarks[263]; //right eye outer corner
    const eyeDistance = Math.sqrt(
        Math.pow(leftEyeOuter.x - rightEyeOuter.x, 2) +
        Math.pow(leftEyeOuter.y - rightEyeOuter.y, 2)
    );

    //empirically calibrated thresholds (depends on camera FOV)
    //~0.15 at 1m distance for 640px width (it's a reference value)
    if (eyeDistance > 0.22) {
        statusEl.textContent = "You are TOO CLOSE to the screen!";
        statusEl.className = "close";
    } else if (eyeDistance < 0.10) {
        statusEl.textContent = "You are TOO FAR from the screen!";
        statusEl.className = "far";
    } else {
        statusEl.textContent = "Good distance! (~1 meter)";
        statusEl.className = "good";
    }
}

startBtn.addEventListener("click", startCalibration);
stopBtn.addEventListener("click", stopCalibration);

initFaceLandmarker();