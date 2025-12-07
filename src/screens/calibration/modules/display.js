import { parameterDisplay } from "./domRefs.js";
import { CALIBRATION_POINTS, gazeData, calibrationModel } from "./dotCalibration.js";
import { leastSquares } from "./mathUtils.js";

export function displayCalibrationParameters() {
    const grouped = CALIBRATION_POINTS.map((p, i) => {
        const s = gazeData.filter(v => v.point_index === i);
        if (!s.length) {
            return { label: p.label, count: 0, x: "N/A", y: "N/A", r: "N/A" };
        }

        const sum = s.reduce(
            (a, v) => ({
                x: a.x + v.iris_center.x,
                y: a.y + v.iris_center.y,
                r: a.r + v.iris_radius
            }),
            { x: 0, y: 0, r: 0 }
        );

        return {
            label: p.label,
            count: s.length,
            x: (sum.x / s.length).toFixed(4),
            y: (sum.y / s.length).toFixed(4),
            r: (sum.r / s.length).toFixed(4)
        };
    });

    parameterDisplay.innerHTML = `
    <h3>Calibration Data Samples</h3>
    <table border="1" style="width:100%;max-width:600px;margin:auto;">
        <thead>
            <tr><th>Point</th><th>Samples</th><th>X</th><th>Y</th><th>Radius</th></tr>
        </thead>
        <tbody>
            ${grouped.map(g => `
                <tr>
                    <td>${g.label}</td>
                    <td>${g.count}</td>
                    <td>${g.x}</td>
                    <td>${g.y}</td>
                    <td>${g.r}</td>
                </tr>
            `).join("")}
        </tbody>
    </table>`;
}

export function displayPredictionModel() {
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

    calibrationModel.a = px[0];
    calibrationModel.b = px[1];
    calibrationModel.c = px[2];
    calibrationModel.d = py[0];
    calibrationModel.e = py[1];
    calibrationModel.f = py[2];

    parameterDisplay.innerHTML += `
    <h3>Affine Model</h3>
    <p>ScreenX = a*ix + b*iy + c<br>ScreenY = d*ix + e*iy + f</p>
    <table border="1" style="width:100%;max-width:600px;margin:auto;">
        ${Object.entries(calibrationModel)
        .map(([k, v]) => `<tr><td>${k}</td><td>${v.toFixed(6)}</td></tr>`)
        .join("")}
    </table>`;
}