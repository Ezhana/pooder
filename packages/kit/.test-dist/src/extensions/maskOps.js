"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMask = createMask;
exports.inferMaskMode = inferMaskMode;
exports.analyzeAlpha = analyzeAlpha;
exports.circularMorphology = circularMorphology;
exports.fillHoles = fillHoles;
exports.countForeground = countForeground;
exports.isMaskConnected8 = isMaskConnected8;
exports.findMinimalConnectRadius = findMinimalConnectRadius;
exports.polygonSignedArea = polygonSignedArea;
function createMask(imageData, options) {
    const { width, height, data } = imageData;
    const { threshold, padding, paddedWidth, paddedHeight, maskMode = "auto", whiteThreshold = 240, alphaOpaqueCutoff = 250, } = options;
    const resolvedMode = maskMode === "auto" ? inferMaskMode(imageData, alphaOpaqueCutoff) : maskMode;
    const mask = new Uint8Array(paddedWidth * paddedHeight);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = (y * width + x) * 4;
            const r = data[srcIdx];
            const g = data[srcIdx + 1];
            const b = data[srcIdx + 2];
            const a = data[srcIdx + 3];
            const destIdx = (y + padding) * paddedWidth + (x + padding);
            if (resolvedMode === "alpha") {
                if (a > threshold)
                    mask[destIdx] = 1;
            }
            else {
                if (a > threshold &&
                    !(r > whiteThreshold && g > whiteThreshold && b > whiteThreshold)) {
                    mask[destIdx] = 1;
                }
            }
        }
    }
    return mask;
}
function inferMaskMode(imageData, alphaOpaqueCutoff) {
    const analysis = analyzeAlpha(imageData, alphaOpaqueCutoff);
    if (analysis.minAlpha === 255)
        return "whitebg";
    if (analysis.veryTransparentRatio >= 0.0005)
        return "alpha";
    if (analysis.belowOpaqueRatio >= 0.01)
        return "alpha";
    return "whitebg";
}
function analyzeAlpha(imageData, alphaOpaqueCutoff) {
    const { data } = imageData;
    const total = data.length / 4;
    let belowOpaque = 0;
    let veryTransparent = 0;
    let minAlpha = 255;
    for (let i = 3; i < data.length; i += 4) {
        const a = data[i];
        if (a < minAlpha)
            minAlpha = a;
        if (a < alphaOpaqueCutoff)
            belowOpaque++;
        if (a < 32)
            veryTransparent++;
    }
    return {
        total,
        minAlpha,
        belowOpaqueRatio: belowOpaque / total,
        veryTransparentRatio: veryTransparent / total,
    };
}
function circularMorphology(mask, width, height, radius, op) {
    const dilate = (m, r) => {
        const horizontalDist = new Int32Array(width * height);
        for (let y = 0; y < height; y++) {
            let lastSolid = -r * 2;
            for (let x = 0; x < width; x++) {
                if (m[y * width + x])
                    lastSolid = x;
                horizontalDist[y * width + x] = x - lastSolid;
            }
            lastSolid = width + r * 2;
            for (let x = width - 1; x >= 0; x--) {
                if (m[y * width + x])
                    lastSolid = x;
                horizontalDist[y * width + x] = Math.min(horizontalDist[y * width + x], lastSolid - x);
            }
        }
        const result = new Uint8Array(width * height);
        const r2 = r * r;
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                let found = false;
                const minY = Math.max(0, y - r);
                const maxY = Math.min(height - 1, y + r);
                for (let dy = minY; dy <= maxY; dy++) {
                    const dY = dy - y;
                    const hDist = horizontalDist[dy * width + x];
                    if (hDist * hDist + dY * dY <= r2) {
                        found = true;
                        break;
                    }
                }
                if (found)
                    result[y * width + x] = 1;
            }
        }
        return result;
    };
    const erode = (m, r) => {
        const inverted = new Uint8Array(m.length);
        for (let i = 0; i < m.length; i++)
            inverted[i] = m[i] ? 0 : 1;
        const dilatedInverted = dilate(inverted, r);
        const result = new Uint8Array(m.length);
        for (let i = 0; i < m.length; i++)
            result[i] = dilatedInverted[i] ? 0 : 1;
        return result;
    };
    switch (op) {
        case "dilate":
            return dilate(mask, radius);
        case "erode":
            return erode(mask, radius);
        case "closing":
            return erode(dilate(mask, radius), radius);
        case "opening":
            return dilate(erode(mask, radius), radius);
        default:
            return mask;
    }
}
function fillHoles(mask, width, height) {
    const background = new Uint8Array(width * height);
    const queue = [];
    for (let x = 0; x < width; x++) {
        if (mask[x] === 0) {
            background[x] = 1;
            queue.push(x);
        }
        const lastRowIdx = (height - 1) * width + x;
        if (mask[lastRowIdx] === 0) {
            background[lastRowIdx] = 1;
            queue.push(lastRowIdx);
        }
    }
    for (let y = 1; y < height - 1; y++) {
        const leftIdx = y * width;
        const rightIdx = y * width + (width - 1);
        if (mask[leftIdx] === 0) {
            background[leftIdx] = 1;
            queue.push(leftIdx);
        }
        if (mask[rightIdx] === 0) {
            background[rightIdx] = 1;
            queue.push(rightIdx);
        }
    }
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;
        const up = y > 0 ? idx - width : -1;
        const down = y < height - 1 ? idx + width : -1;
        const left = x > 0 ? idx - 1 : -1;
        const right = x < width - 1 ? idx + 1 : -1;
        if (up >= 0 && mask[up] === 0 && background[up] === 0) {
            background[up] = 1;
            queue.push(up);
        }
        if (down >= 0 && mask[down] === 0 && background[down] === 0) {
            background[down] = 1;
            queue.push(down);
        }
        if (left >= 0 && mask[left] === 0 && background[left] === 0) {
            background[left] = 1;
            queue.push(left);
        }
        if (right >= 0 && mask[right] === 0 && background[right] === 0) {
            background[right] = 1;
            queue.push(right);
        }
    }
    const filledMask = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
        filledMask[i] = background[i] === 0 ? 1 : 0;
    }
    return filledMask;
}
function countForeground(mask) {
    let c = 0;
    for (let i = 0; i < mask.length; i++)
        c += mask[i] ? 1 : 0;
    return c;
}
function isMaskConnected8(mask, width, height) {
    const total = countForeground(mask);
    if (total === 0)
        return true;
    let start = -1;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i]) {
            start = i;
            break;
        }
    }
    if (start === -1)
        return true;
    const visited = new Uint8Array(mask.length);
    const queue = [start];
    visited[start] = 1;
    let seen = 1;
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head++];
        const x = idx % width;
        const y = (idx - x) / width;
        for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= height)
                continue;
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0)
                    continue;
                const nx = x + dx;
                if (nx < 0 || nx >= width)
                    continue;
                const nidx = ny * width + nx;
                if (mask[nidx] && !visited[nidx]) {
                    visited[nidx] = 1;
                    queue.push(nidx);
                    seen++;
                }
            }
        }
    }
    return seen === total;
}
function findMinimalConnectRadius(mask, width, height, maxRadius) {
    if (maxRadius <= 0)
        return 0;
    if (isMaskConnected8(mask, width, height))
        return 0;
    let low = 0;
    let high = 1;
    while (high <= maxRadius) {
        const closed = circularMorphology(mask, width, height, high, "closing");
        if (isMaskConnected8(closed, width, height))
            break;
        high *= 2;
    }
    if (high > maxRadius)
        high = maxRadius;
    if (!isMaskConnected8(circularMorphology(mask, width, height, high, "closing"), width, height)) {
        return high;
    }
    while (low + 1 < high) {
        const mid = Math.floor((low + high) / 2);
        const closed = circularMorphology(mask, width, height, mid, "closing");
        if (isMaskConnected8(closed, width, height)) {
            high = mid;
        }
        else {
            low = mid;
        }
    }
    return high;
}
function polygonSignedArea(points) {
    if (points.length < 3)
        return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return sum / 2;
}
