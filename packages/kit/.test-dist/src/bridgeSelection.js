"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickExitIndex = pickExitIndex;
exports.scoreOutsideAbove = scoreOutsideAbove;
function pickExitIndex(hits) {
    for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        if (h.insideBelow && !h.insideAbove)
            return i;
    }
    return -1;
}
function scoreOutsideAbove(samples) {
    let score = 0;
    for (const s of samples) {
        if (s.outsideAbove)
            score++;
    }
    return score;
}
