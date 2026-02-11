"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CanvasService = void 0;
__exportStar(require("./background"), exports);
__exportStar(require("./dieline"), exports);
__exportStar(require("./film"), exports);
__exportStar(require("./feature"), exports);
__exportStar(require("./image"), exports);
__exportStar(require("./white-ink"), exports);
__exportStar(require("./ruler"), exports);
__exportStar(require("./mirror"), exports);
__exportStar(require("./units"), exports);
var CanvasService_1 = require("./CanvasService");
Object.defineProperty(exports, "CanvasService", { enumerable: true, get: function () { return __importDefault(CanvasService_1).default; } });
