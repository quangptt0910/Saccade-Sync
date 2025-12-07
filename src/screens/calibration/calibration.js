import { initFaceLandmarker, faceLandmarker } from "./modules/faceModel.js";
import { startBtn, stopBtn, runCalibBtnOverlay } from "./modules/domRefs.js";
import { startDistanceCheck, stopDistanceCheck } from "./modules/video.js";
import { runDotCalibration } from "./modules/dotCalibration.js";

initFaceLandmarker();

startBtn.addEventListener("click", () => {
    if (!faceLandmarker) {
        initFaceLandmarker().then(() => startDistanceCheck());
    } else {
        startDistanceCheck();
    }
});

stopBtn.addEventListener("click", () => stopDistanceCheck());

runCalibBtnOverlay.addEventListener("click", runDotCalibration);

window.addEventListener("resize", () => {
});