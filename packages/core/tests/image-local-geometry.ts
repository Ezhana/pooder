import {
  coordinatePoint,
  coordinateRect,
  multiplyCoordinateMatrices,
  transformCoordinatePoint,
} from "../src/coordinate";
import { resolveImageGeometry } from "../src/image-geometry";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > EPSILON) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertMatrixEqual(
  actual: readonly number[],
  expected: readonly number[],
  label: string,
): void {
  actual.forEach((value, index) =>
    assertClose(value, expected[index], `${label}[${index}]`),
  );
}

const frame = coordinateRect("object-local", {
  left: 10,
  top: 20,
  width: 200,
  height: 100,
});
const source = { width: 400, height: 400 };

const cover = resolveImageGeometry({
  source: { src: "real.png", size: source },
  frame,
  fit: "cover",
  transform: { anchorX: 0.25, anchorY: 0.75 },
  clip: frame,
});
const center = transformCoordinatePoint(
  cover.imageLocalToObjectLocal,
  coordinatePoint("object-local", 200, 200),
);
assertClose(center.x, 60, "normalized anchor x");
assertClose(center.y, 95, "normalized anchor y");
assertClose(cover.imageLocalToObjectLocal.values[0], 0.5, "cover scale x");
assertClose(cover.imageLocalToObjectLocal.values[3], 0.5, "cover scale y");
if (cover.clip?.space !== "object-local") {
  throw new Error("clip must remain object-local");
}
if ("originX" in cover || "left" in cover || "scaleX" in cover) {
  throw new Error("resolved image geometry must not expose Fabric placement fields");
}

const contain = resolveImageGeometry({
  source: { src: "contain.png", size: source },
  frame,
  fit: "contain",
});
assertClose(contain.imageLocalToObjectLocal.values[0], 0.25, "contain scale x");
assertClose(contain.imageLocalToObjectLocal.values[3], 0.25, "contain scale y");

const stretch = resolveImageGeometry({
  source: { src: "stretch.png", size: source },
  frame,
  fit: "stretch",
});
assertClose(stretch.imageLocalToObjectLocal.values[0], 0.5, "stretch scale x");
assertClose(stretch.imageLocalToObjectLocal.values[3], 0.25, "stretch scale y");

const clampedAnchor = resolveImageGeometry({
  source: { src: "anchor.png", size: source },
  frame,
  fit: "contain",
  transform: { anchorX: 2, anchorY: -1 },
});
const clampedCenter = transformCoordinatePoint(
  clampedAnchor.imageLocalToObjectLocal,
  coordinatePoint("object-local", 200, 200),
);
assertClose(clampedCenter.x, 210, "anchor clamps to local right edge");
assertClose(clampedCenter.y, 20, "anchor clamps to local top edge");

const placeholder = resolveImageGeometry({
  source: { src: "placeholder.png", size: source },
  frame,
  fit: "cover",
  transform: { anchorX: 0.25, anchorY: 0.75 },
});
assertMatrixEqual(
  placeholder.imageLocalToObjectLocal.values,
  cover.imageLocalToObjectLocal.values,
  "placeholder and real image geometry",
);

const replacement = resolveImageGeometry({
  source: { src: "replacement.png", size: source },
  frame,
  fit: "cover",
  transform: { anchorX: 0.25, anchorY: 0.75 },
});
const objectToScene = {
  from: "object-local" as const,
  to: "scene" as const,
  values: [2, 0, 0, 3, 500, 700] as const,
};
assertMatrixEqual(
  multiplyCoordinateMatrices(
    objectToScene,
    replacement.imageLocalToObjectLocal,
  ).values,
  multiplyCoordinateMatrices(objectToScene, cover.imageLocalToObjectLocal)
    .values,
  "replacement preserves object and scene placement",
);
