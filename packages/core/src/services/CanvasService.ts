import { Canvas } from "fabric";
import { Service } from "../service";

export default class CanvasService implements Service {
  private canvas: Canvas;
  constructor(el: HTMLCanvasElement) {
    this.canvas = new Canvas(el, {
      preserveObjectStacking: true,
    });
  }

  dispose() {
    this.canvas.dispose().then((r) => console.log(`CanvasService:${r}`));
  }
}
