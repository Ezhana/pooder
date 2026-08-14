import {
  coordinateMatrix,
  coordinatePoint,
  createAffinePlacement,
  createLocalToSceneMatrix,
  invertCoordinateMatrix,
  multiplyCoordinateMatrices,
  transformCoordinatePoint,
  transformCoordinateRect,
} from "../src/coordinate";

const EPSILON = 1e-9;

function assertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > EPSILON) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertPoint(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  label: string,
): void {
  assertClose(actual.x, expected.x, `${label}.x`);
  assertClose(actual.y, expected.y, `${label}.y`);
}

// Three nested objects flatten to one object-local -> scene matrix.
const root = coordinateMatrix("parent-local", "scene", [1, 0, 0, 1, 100, 50]);
const middle = coordinateMatrix(
  "parent-local",
  "parent-local",
  [2, 0, 0, 2, 10, 5],
);
const leaf = coordinateMatrix(
  "object-local",
  "parent-local",
  [1, 0, 0, 1, 3, 4],
);
const nested = multiplyCoordinateMatrices(
  root,
  multiplyCoordinateMatrices(middle, leaf),
);
assertPoint(
  transformCoordinatePoint(nested, coordinatePoint("object-local", 1, 2)),
  { x: 118, y: 67 },
  "three-level nesting",
);

// Every affine parent/child combination must compose in the same order as
// applying the child first and then its parent, and remain invertible.
const affineCases = [
  [1, 0, 0, 1, 0, 0],
  [1, 0, 0, 1, 17, -9],
  [2, 0, 0, 0.5, 0, 0],
  [0, 1, -1, 0, 3, 4],
  [1, 0.25, -0.5, 1, 8, 6],
  [-1, 0, 0, 1, 12, 0],
] as const;
for (const [parentIndex, parentValues] of affineCases.entries()) {
  const parent = coordinateMatrix("parent-local", "scene", parentValues);
  for (const [childIndex, childValues] of affineCases.entries()) {
    const child = coordinateMatrix("object-local", "parent-local", childValues);
    const composed = multiplyCoordinateMatrices(parent, child);
    const localPoint = coordinatePoint("object-local", 7, -3);
    const sequential = transformCoordinatePoint(
      parent,
      transformCoordinatePoint(child, localPoint),
    );
    const flattened = transformCoordinatePoint(composed, localPoint);
    assertPoint(
      flattened,
      sequential,
      `parent-child matrix[${parentIndex},${childIndex}]`,
    );
    assertPoint(
      transformCoordinatePoint(invertCoordinateMatrix(composed), flattened),
      localPoint,
      `parent-child inverse[${parentIndex},${childIndex}]`,
    );
  }
}

// Non-uniform scale is applied before rotation without decomposition loss.
const scaledThenRotated = createLocalToSceneMatrix({
  position: { x: 0, y: 0 },
  pivot: { x: 0, y: 0 },
  scaleX: 2,
  scaleY: 3,
  rotation: 90,
});
assertPoint(
  transformCoordinatePoint(
    scaledThenRotated,
    coordinatePoint("object-local", 1, 1),
  ),
  { x: -3, y: 2 },
  "non-uniform scale then rotate",
);

// Negative scale mirrors around the declared local pivot.
const mirrored = createLocalToSceneMatrix({
  position: { x: 10, y: 0 },
  pivot: { x: 5, y: 0 },
  scaleX: -1,
  scaleY: 1,
});
assertPoint(
  transformCoordinatePoint(mirrored, coordinatePoint("object-local", 7, 0)),
  { x: 8, y: 0 },
  "negative scale mirror",
);

// A non-central pivot maps exactly to the requested scene position.
const pivoted = createLocalToSceneMatrix({
  position: { x: 30, y: 40 },
  pivot: { x: 2, y: 9 },
  rotation: 37,
  skewX: 11,
});
assertPoint(
  transformCoordinatePoint(pivoted, coordinatePoint("object-local", 2, 9)),
  { x: 30, y: 40 },
  "non-central pivot",
);

// Local bounds may start away from (0, 0); they are not a scene position.
const offsetBoundsPlacement = createAffinePlacement({
  localBounds: { left: 20, top: 30, width: 40, height: 10 },
  pivot: { x: 20, y: 30 },
  localToScene: createLocalToSceneMatrix({
    position: { x: 200, y: 300 },
    pivot: { x: 20, y: 30 },
  }),
});
const offsetBounds = transformCoordinateRect(
  offsetBoundsPlacement.localToScene,
  offsetBoundsPlacement.localBounds,
);
assertPoint(
  { x: offsetBounds.left, y: offsetBounds.top },
  { x: 200, y: 300 },
  "offset local bounds",
);

// Viewport re-application always starts from the canonical scene matrix.
const canonical = createLocalToSceneMatrix({
  position: { x: 12, y: 8 },
  pivot: { x: 0, y: 0 },
  scaleX: 1.5,
  scaleY: 0.75,
  rotation: 23,
});
const viewport2x = coordinateMatrix("scene", "screen", [2, 0, 0, 2, 5, 7]);
const firstApply = multiplyCoordinateMatrices(viewport2x, canonical);
const viewport3x = coordinateMatrix("scene", "screen", [3, 0, 0, 3, 9, 4]);
multiplyCoordinateMatrices(viewport3x, canonical);
const secondApply = multiplyCoordinateMatrices(viewport2x, canonical);
firstApply.values.forEach((value, index) =>
  assertClose(value, secondApply.values[index], `viewport reapply[${index}]`),
);
