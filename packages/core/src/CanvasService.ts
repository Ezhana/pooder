import { Service } from "./service";
import { Canvas } from "fabric";

export default class CanvasService implements Service {
  private canvas: Canvas;
  constructor(el: HTMLCanvasElement) {
    this.canvas = new Canvas(el);
  }

  init() {}
}
