// ============================================================================
// IRIS TRACKING MODULE - Extracted from app.js
// ============================================================================
// This module handles all iris-specific tracking functionality
// Focuses on iris landmarks (468-477) and eye movement detection
// ============================================================================

export class IrisTracker {
    constructor() {
        // Iris landmark indices (MediaPipe Face Landmarker)
        this.LEFT_IRIS_CENTER = 468;
        this.RIGHT_IRIS_CENTER = 473;
        this.LEFT_IRIS_CONTOUR = [469, 470, 471, 472];
        this.RIGHT_IRIS_CONTOUR = [474, 475, 476, 477];

        // Eye landmark indices for context
        this.LEFT_EYE = [33, 133, 160, 159, 158, 157, 173, 144, 145, 153, 154, 155];
        this.RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387];

        // Eye corners for gaze calculation
        this.LEFT_EYE_INNER = 133;
        this.LEFT_EYE_OUTER = 33;
        this.RIGHT_EYE_INNER = 362;
        this.RIGHT_EYE_OUTER = 263;

        // Previous positions for movement tracking
        this.prevLeftIris = null;
        this.prevRightIris = null;

        // Movement history for smoothing
        this.movementHistory = [];
        this.maxHistoryLength = 10;
    }

    /**
     * Process iris data from face landmarks
     * @param {Array} landmarks - Full 478 face landmarks
     * @param {CanvasRenderingContext2D} canvasCtx - Canvas context for drawing
     * @param {number} canvasWidth - Canvas width for pixel conversion
     * @param {number} canvasHeight - Canvas height for pixel conversion
     * @returns {object} Iris tracking data
     */
    processIrisData(landmarks, canvasCtx, canvasWidth, canvasHeight) {
        if (!landmarks || landmarks.length < 478) {
            return this.getNoDetectionData();
        }

        // Extract iris positions
        const leftIris = landmarks[this.LEFT_IRIS_CENTER];
        const rightIris = landmarks[this.RIGHT_IRIS_CENTER];

        // Get iris contours
        const leftIrisContour = this.LEFT_IRIS_CONTOUR.map(idx => landmarks[idx]);
        const rightIrisContour = this.RIGHT_IRIS_CONTOUR.map(idx => landmarks[idx]);

        // Calculate iris radius (pupil size estimation)
        const leftRadius = this.calculateIrisRadius(leftIrisContour);
        const rightRadius = this.calculateIrisRadius(rightIrisContour);

        // Convert to pixel coordinates
        const leftIrisPixel = {
            x: leftIris.x * canvasWidth,
            y: leftIris.y * canvasHeight
        };

        const rightIrisPixel = {
            x: rightIris.x * canvasWidth,
            y: rightIris.y * canvasHeight
        };

        // Calculate gaze direction
        const gazeDirection = this.calculateGazeDirection(landmarks, leftIris, rightIris);

        // Detect eye movement
        const movement = this.detectEyeMovement(leftIris, rightIris);

        // Calculate movement velocity
        const velocity = this.calculateMovementVelocity(leftIris, rightIris);

        // Update previous positions
        this.prevLeftIris = leftIris;
        this.prevRightIris = rightIris;

        // Draw iris visualizations if context provided
        if (canvasCtx) {
            this.drawIrisVisualization(
                landmarks,
                canvasCtx,
                canvasWidth,
                canvasHeight
            );
        }

        return {
            leftIris: leftIrisPixel,
            rightIris: rightIrisPixel,
            leftIrisNormalized: { x: leftIris.x, y: leftIris.y, z: leftIris.z },
            rightIrisNormalized: { x: rightIris.x, y: rightIris.y, z: rightIris.z },
            leftRadius,
            rightRadius,
            gazeDirection,
            movement,
            velocity,
            timestamp: performance.now()
        };
    }

    /**
     * Calculate iris radius from contour points
     * @param {Array} contourPoints - 4 points forming iris contour
     * @returns {number} Average radius
     */
    calculateIrisRadius(contourPoints) {
        if (contourPoints.length !== 4) return 0;

        // Calculate diameter horizontally and vertically
        const horizontalDist = this.calculateDistance(contourPoints[0], contourPoints[2]);
        const verticalDist = this.calculateDistance(contourPoints[1], contourPoints[3]);

        // Return average radius
        return (horizontalDist + verticalDist) / 4;
    }

    /**
     * Calculate Euclidean distance between two points
     * @param {object} p1 - Point 1 {x, y, z}
     * @param {object} p2 - Point 2 {x, y, z}
     * @returns {number} Distance
     */
    calculateDistance(p1, p2) {
        return Math.sqrt(
            Math.pow(p1.x - p2.x, 2) +
            Math.pow(p1.y - p2.y, 2) +
            Math.pow(p1.z - p2.z, 2)
        );
    }

    /**
     * Calculate gaze direction based on iris position within eye
     * @param {Array} landmarks - All face landmarks
     * @param {object} leftIris - Left iris center landmark
     * @param {object} rightIris - Right iris center landmark
     * @returns {object} Gaze direction with horizontal and vertical components
     */
    calculateGazeDirection(landmarks, leftIris, rightIris) {
        // Get eye corners for reference
        const leftEyeInner = landmarks[this.LEFT_EYE_INNER];
        const leftEyeOuter = landmarks[this.LEFT_EYE_OUTER];
        const rightEyeInner = landmarks[this.RIGHT_EYE_INNER];
        const rightEyeOuter = landmarks[this.RIGHT_EYE_OUTER];

        // Calculate eye widths
        const leftEyeWidth = Math.abs(leftEyeOuter.x - leftEyeInner.x);
        const rightEyeWidth = Math.abs(rightEyeOuter.x - rightEyeInner.x);

        // Calculate relative iris position (0 = far right, 1 = far left)
        const leftIrisRelativeX = (leftIris.x - leftEyeInner.x) / leftEyeWidth;
        const rightIrisRelativeX = (rightIris.x - rightEyeInner.x) / rightEyeWidth;

        // Average both eyes for final gaze
        const avgRelativeX = (leftIrisRelativeX + rightIrisRelativeX) / 2;
        const avgRelativeY = (leftIris.y + rightIris.y) / 2;

        // Determine gaze direction with thresholds
        let horizontal = "Center";
        let vertical = "Center";
        let horizontalValue = 0;
        let verticalValue = 0;

        // Horizontal gaze
        if (avgRelativeX < 0.35) {
            horizontal = "Right";
            horizontalValue = (0.35 - avgRelativeX) / 0.35;
        } else if (avgRelativeX > 0.65) {
            horizontal = "Left";
            horizontalValue = (avgRelativeX - 0.65) / 0.35;
        }

        // Vertical gaze
        if (avgRelativeY < 0.47) {
            vertical = "Up";
            verticalValue = (0.47 - avgRelativeY) / 0.47;
        } else if (avgRelativeY > 0.53) {
            vertical = "Down";
            verticalValue = (avgRelativeY - 0.53) / 0.47;
        }

        return {
            horizontal,
            vertical,
            direction: `${horizontal} ${vertical}`,
            horizontalValue,
            verticalValue,
            rawX: avgRelativeX,
            rawY: avgRelativeY
        };
    }

    /**
     * Detect eye movement type and magnitude
     * @param {object} leftIris - Current left iris position
     * @param {object} rightIris - Current right iris position
     * @returns {object} Movement classification and metrics
     */
    detectEyeMovement(leftIris, rightIris) {
        if (!this.prevLeftIris || !this.prevRightIris) {
            return {
                type: "Initializing",
                magnitude: 0,
                direction: { x: 0, y: 0 }
            };
        }

        // Calculate movement deltas
        const leftDeltaX = leftIris.x - this.prevLeftIris.x;
        const leftDeltaY = leftIris.y - this.prevLeftIris.y;
        const rightDeltaX = rightIris.x - this.prevRightIris.x;
        const rightDeltaY = rightIris.y - this.prevRightIris.y;

        // Average both eyes
        const avgDeltaX = (leftDeltaX + rightDeltaX) / 2;
        const avgDeltaY = (leftDeltaY + rightDeltaY) / 2;
        const totalMovement = Math.sqrt(avgDeltaX * avgDeltaX + avgDeltaY * avgDeltaY);

        // Classify movement type
        let type = "Steady";
        if (totalMovement > 0.015) type = "Saccade"; // Rapid eye movement
        else if (totalMovement > 0.008) type = "Rapid";
        else if (totalMovement > 0.004) type = "Moderate";
        else if (totalMovement > 0.001) type = "Slight";

        return {
            type,
            magnitude: totalMovement,
            direction: { x: avgDeltaX, y: avgDeltaY }
        };
    }

    /**
     * Calculate movement velocity over time
     * @param {object} leftIris - Current left iris position
     * @param {object} rightIris - Current right iris position
     * @returns {number} Movement velocity
     */
    calculateMovementVelocity(leftIris, rightIris) {
        if (!this.prevLeftIris || !this.prevRightIris) {
            return 0;
        }

        const leftMovement = this.calculateDistance(leftIris, this.prevLeftIris);
        const rightMovement = this.calculateDistance(rightIris, this.prevRightIris);
        const avgMovement = (leftMovement + rightMovement) / 2;

        // Add to history
        this.movementHistory.push(avgMovement);
        if (this.movementHistory.length > this.maxHistoryLength) {
            this.movementHistory.shift();
        }

        // Calculate average velocity
        const sum = this.movementHistory.reduce((a, b) => a + b, 0);
        return sum / this.movementHistory.length;
    }

    /**
     * Draw iris visualization on canvas
     * @param {Array} landmarks - All face landmarks
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    drawIrisVisualization(landmarks, ctx, width, height) {
        // Helper function to draw a point
        const drawPoint = (landmark, color, size = 4) => {
            const x = landmark.x * width;
            const y = landmark.y * height;

            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();

            // Add glow effect
            ctx.shadowBlur = 10;
            ctx.shadowColor = color;
            ctx.fill();
            ctx.shadowBlur = 0;
        };

        // Helper function to draw a circle
        const drawCircle = (landmark, radius, color, lineWidth = 2) => {
            const x = landmark.x * width;
            const y = landmark.y * height;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.stroke();
        };

        // Draw eye contours
        this.drawEyeContour(landmarks, this.LEFT_EYE, ctx, width, height, 'rgba(0, 255, 255, 0.5)');
        this.drawEyeContour(landmarks, this.RIGHT_EYE, ctx, width, height, 'rgba(255, 100, 100, 0.5)');

        // Draw iris centers (bright green)
        const leftIrisCenter = landmarks[this.LEFT_IRIS_CENTER];
        const rightIrisCenter = landmarks[this.RIGHT_IRIS_CENTER];

        drawPoint(leftIrisCenter, '#00FF00', 6);
        drawPoint(rightIrisCenter, '#00FF00', 6);

        // Draw iris contours (yellow)
        this.LEFT_IRIS_CONTOUR.forEach(idx => {
            drawPoint(landmarks[idx], '#FFFF00', 3);
        });

        this.RIGHT_IRIS_CONTOUR.forEach(idx => {
            drawPoint(landmarks[idx], '#FFFF00', 3);
        });

        // Draw circles around iris centers
        drawCircle(leftIrisCenter, 20, '#00FF00', 2);
        drawCircle(rightIrisCenter, 20, '#00FF00', 2);

        // Draw connecting line between iris centers
        ctx.beginPath();
        ctx.moveTo(leftIrisCenter.x * width, leftIrisCenter.y * height);
        ctx.lineTo(rightIrisCenter.x * width, rightIrisCenter.y * height);
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /**
     * Draw eye contour
     * @param {Array} landmarks - All face landmarks
     * @param {Array} eyeIndices - Indices for eye contour
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @param {string} color - Stroke color
     */
    drawEyeContour(landmarks, eyeIndices, ctx, width, height, color) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        eyeIndices.forEach((idx, i) => {
            const landmark = landmarks[idx];
            const x = landmark.x * width;
            const y = landmark.y * height;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.closePath();
        ctx.stroke();
    }

    /**
     * Get empty data structure when no face is detected
     * @returns {object} Empty iris data
     */
    getNoDetectionData() {
        return {
            leftIris: null,
            rightIris: null,
            leftIrisNormalized: null,
            rightIrisNormalized: null,
            leftRadius: 0,
            rightRadius: 0,
            gazeDirection: {
                horizontal: "Not detected",
                vertical: "Not detected",
                direction: "Not detected",
                horizontalValue: 0,
                verticalValue: 0,
                rawX: 0,
                rawY: 0
            },
            movement: {
                type: "No face detected",
                magnitude: 0,
                direction: { x: 0, y: 0 }
            },
            velocity: 0,
            timestamp: performance.now()
        };
    }

    /**
     * Reset tracking state
     */
    reset() {
        this.prevLeftIris = null;
        this.prevRightIris = null;
        this.movementHistory = [];
    }
}
