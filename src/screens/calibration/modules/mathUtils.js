export function transpose(m) {
    return m[0].map((_, i) => m.map(r => r[i]));
}

export function multiply(a, b) {
    const r = [];
    for (let i = 0; i < a.length; i++) {
        r[i] = [];
        for (let j = 0; j < b[0].length; j++) {
            let sum = 0;
            for (let k = 0; k < b.length; k++) sum += a[i][k] * b[k][j];
            r[i][j] = sum;
        }
    }
    return r;
}

export function invert3x3(m) {
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

    const inv = 1 / det;

    return [
        [A * inv, B * inv, C * inv],
        [D * inv, E * inv, F * inv],
        [G * inv, H * inv, I * inv]
    ];
}

export function leastSquares(A, b) {
    const AT = transpose(A);
    const ATA = multiply(AT, A);
    const ATb = multiply(AT, b.map(v => [v]));
    const ATA_inv = invert3x3(ATA);
    if (!ATA_inv) return null;
    return multiply(ATA_inv, ATb).map(r => r[0]);
}