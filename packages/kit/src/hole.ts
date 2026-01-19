import {
  Command,
  Editor,
  EditorState,
  Extension,
  OptionSchema,
  Circle,
  Group,
  Point,
} from "@pooder/core";
import { DielineGeometry } from "./dieline";
import { getNearestPointOnDieline, HoleData } from "./geometry";

export interface HoleToolOptions {
  innerRadius: number;
  outerRadius: number;
  style: "solid" | "dashed";
  holes?: Array<{ x: number; y: number }>;
  constraintTarget?: "original" | "bleed";
}

export class HoleTool implements Extension<HoleToolOptions> {
  public name = "HoleTool";
  public options: HoleToolOptions = {
    innerRadius: 15,
    outerRadius: 25,
    style: "solid",
    holes: [],
    constraintTarget: "bleed",
  };

  public schema: Record<keyof HoleToolOptions, OptionSchema> = {
    innerRadius: {
      type: "number",
      min: 1,
      max: 100,
      label: "Inner Radius",
    },
    outerRadius: {
      type: "number",
      min: 1,
      max: 100,
      label: "Outer Radius",
    },
    style: {
      type: "select",
      options: ["solid", "dashed"],
      label: "Line Style",
    },
    constraintTarget: {
      type: "select",
      options: ["original", "bleed"],
      label: "Constraint Target",
    },
    holes: {
      type: "json",
      label: "Holes",
    } as any,
  };

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleDielineChange: ((geometry: DielineGeometry) => void) | null =
    null;

  // Cache geometry to enforce constraints during drag
  private currentGeometry: DielineGeometry | null = null;

  onMount(editor: Editor) {
    this.setup(editor);
  }

  onUnmount(editor: Editor) {
    this.teardown(editor);
  }

  onDestroy(editor: Editor) {
    this.teardown(editor);
  }

  private setup(editor: Editor) {
    // 1. Listen for Dieline Geometry Changes
    if (!this.handleDielineChange) {
      this.handleDielineChange = (geometry: DielineGeometry) => {
        this.currentGeometry = geometry;
        this.enforceConstraints(editor);
        // After enforcing constraints (updating markers), we must tell Dieline to update its holes
        this.syncHolesToDieline(editor);
      };
      editor.on("dieline:geometry:change", this.handleDielineChange);
    }

    // 2. Initial Fetch of Geometry
    // We use executeCommand to avoid direct dependency on DielineTool instance
    const geometry = editor.executeCommand("DielineTool.getGeometry");
    if (geometry) {
      this.currentGeometry = geometry as DielineGeometry;
    }

    // 3. Setup Canvas Interaction
    if (!this.handleMoving) {
      this.handleMoving = (e: any) => {
        const target = e.target;
        if (!target || target.data?.type !== "hole-marker") return;

        if (!this.currentGeometry) return;

        // Calculate effective geometry based on constraint target
        const effectiveOffset =
          this.options.constraintTarget === "original"
            ? 0
            : this.currentGeometry.offset;
        const constraintGeometry = {
          ...this.currentGeometry,
          width: Math.max(0, this.currentGeometry.width + effectiveOffset * 2),
          height: Math.max(
            0,
            this.currentGeometry.height + effectiveOffset * 2,
          ),
          radius: Math.max(0, this.currentGeometry.radius + effectiveOffset),
        };

        const p = new Point(target.left, target.top);
        const newPos = this.calculateConstrainedPosition(p, constraintGeometry);

        target.set({
          left: newPos.x,
          top: newPos.y,
        });
      };
      editor.canvas.on("object:moving", this.handleMoving);
    }

    if (!this.handleModified) {
      this.handleModified = (e: any) => {
        const target = e.target;
        if (!target || target.data?.type !== "hole-marker") return;

        // Update state when hole is moved
        this.syncHolesFromCanvas(editor);
      };
      editor.canvas.on("object:modified", this.handleModified);
    }

    const opts = this.options;
    // Default hole if none exist
    if (!opts.holes || opts.holes.length === 0) {
      let defaultPos = { x: editor.canvas.width! / 2, y: 50 };

      if (this.currentGeometry) {
        const g = this.currentGeometry;
        // Default to Top-Center of Dieline shape
        const topCenter = { x: g.x, y: g.y - g.height / 2 };
        // Snap to exact shape edge
        const snapped = getNearestPointOnDieline(topCenter, {
          ...g,
          holes: [],
        } as any);
        defaultPos = snapped;
      }

      opts.holes = [defaultPos];
    }

    this.options = { ...opts };
    this.redraw(editor);
    this.syncHolesToDieline(editor);
  }

  private teardown(editor: Editor) {
    if (this.handleMoving) {
      editor.canvas.off("object:moving", this.handleMoving);
      this.handleMoving = null;
    }
    if (this.handleModified) {
      editor.canvas.off("object:modified", this.handleModified);
      this.handleModified = null;
    }
    if (this.handleDielineChange) {
      editor.off("dieline:geometry:change", this.handleDielineChange);
      this.handleDielineChange = null;
    }

    const objects = editor.canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");
    objects.forEach((obj) => editor.canvas.remove(obj));

    // Clear holes from Dieline (visual only, state preserved in HoleTool options)
    // Use try-catch or safe execute to avoid errors if Dieline is already gone/disabled
    editor.executeCommand("dieline.setHoles", []);

    editor.canvas.requestRenderAll();
  }

  onUpdate(editor: Editor, state: EditorState) {
    this.enforceConstraints(editor);
    this.redraw(editor);
    this.syncHolesToDieline(editor);
  }

  commands: Record<string, Command> = {
    reset: {
      execute: (editor: Editor) => {
        let defaultPos = { x: editor.canvas.width! / 2, y: 50 };

        if (this.currentGeometry) {
          const g = this.currentGeometry;
          const topCenter = { x: g.x, y: g.y - g.height / 2 };
          defaultPos = getNearestPointOnDieline(topCenter, {
            ...g,
            holes: [],
          } as any);
        }

        this.options = {
          innerRadius: 15,
          outerRadius: 25,
          style: "solid",
          holes: [defaultPos],
        };
        this.redraw(editor);
        this.syncHolesToDieline(editor);

        return true;
      },
    },
    addHole: {
      execute: (editor: Editor, x: number, y: number) => {
        if (!this.options.holes) this.options.holes = [];
        this.options.holes.push({ x, y });
        this.redraw(editor);
        this.syncHolesToDieline(editor);

        return true;
      },
      schema: {
        x: {
          type: "number",
          label: "X Position",
          required: true,
        },
        y: {
          type: "number",
          label: "Y Position",
          required: true,
        },
      },
    },
    clearHoles: {
      execute: (editor: Editor) => {
        this.options.holes = [];
        this.redraw(editor);
        this.syncHolesToDieline(editor);

        return true;
      },
    },
  };

  private syncHolesFromCanvas(editor: Editor) {
    const objects = editor.canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");

    // Sort to keep order consistent if needed, though canvas order changes on select
    // Using simple mapping here
    const holes = objects.map((obj) => ({ x: obj.left!, y: obj.top! }));
    this.options.holes = holes;

    this.syncHolesToDieline(editor);
  }

  private syncHolesToDieline(editor: Editor) {
    const { holes, innerRadius, outerRadius } = this.options;
    // Even if holes is empty, we should send it to clear holes in Dieline
    const currentHoles = holes || [];

    const holeData: HoleData[] = currentHoles.map((h) => ({
      x: h.x,
      y: h.y,
      innerRadius,
      outerRadius,
    }));

    editor.executeCommand("DielineTool.setHoles", holeData);
  }

  private redraw(editor: Editor) {
    const canvas = editor.canvas;

    // Remove existing holes
    const existing = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");
    existing.forEach((obj) => canvas.remove(obj));

    const { innerRadius, outerRadius, style, holes } = this.options;

    if (!holes || holes.length === 0) {
      canvas.requestRenderAll();
      return;
    }

    holes.forEach((hole, index) => {
      const innerCircle = new Circle({
        radius: innerRadius,
        fill: "transparent",
        stroke: "red",
        strokeWidth: 2,
        originX: "center",
        originY: "center",
      });

      const outerCircle = new Circle({
        radius: outerRadius,
        fill: "transparent",
        stroke: "#666",
        strokeWidth: 1,
        strokeDashArray: style === "dashed" ? [5, 5] : undefined,
        originX: "center",
        originY: "center",
      });

      const holeGroup = new Group([outerCircle, innerCircle], {
        left: hole.x,
        top: hole.y,
        originX: "center",
        originY: "center",
        selectable: true,
        hasControls: false, // Don't allow resizing/rotating
        hasBorders: false,
        subTargetCheck: false,
        opacity: 0, // Default hidden
        hoverCursor: "move",
        data: { type: "hole-marker", index },
      } as any);
      (holeGroup as any).name = "hole-marker";

      // Auto-show/hide logic
      holeGroup.on("mouseover", () => {
        holeGroup.set("opacity", 1);
        canvas.requestRenderAll();
      });
      holeGroup.on("mouseout", () => {
        if (canvas.getActiveObject() !== holeGroup) {
          holeGroup.set("opacity", 0);
          canvas.requestRenderAll();
        }
      });
      holeGroup.on("selected", () => {
        holeGroup.set("opacity", 1);
        canvas.requestRenderAll();
      });
      holeGroup.on("deselected", () => {
        holeGroup.set("opacity", 0);
        canvas.requestRenderAll();
      });

      canvas.add(holeGroup);
      canvas.bringObjectToFront(holeGroup);
    });

    canvas.requestRenderAll();
  }

  public enforceConstraints(editor: Editor) {
    const geometry = this.currentGeometry;
    if (!geometry) return;

    const effectiveOffset =
      this.options.constraintTarget === "original" ? 0 : geometry.offset;
    const constraintGeometry = {
      ...geometry,
      width: Math.max(0, geometry.width + effectiveOffset * 2),
      height: Math.max(0, geometry.height + effectiveOffset * 2),
      radius: Math.max(0, geometry.radius + effectiveOffset),
    };

    // Get all hole markers
    const objects = editor.canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");

    let changed = false;
    // Sort objects by index to maintain order in options.holes
    objects.sort(
      (a: any, b: any) => (a.data?.index ?? 0) - (b.data?.index ?? 0),
    );

    const newHoles: { x: number; y: number }[] = [];

    objects.forEach((obj: any) => {
      const currentPos = new Point(obj.left, obj.top);
      const newPos = this.calculateConstrainedPosition(
        currentPos,
        constraintGeometry,
      );

      if (currentPos.distanceFrom(newPos) > 0.1) {
        obj.set({
          left: newPos.x,
          top: newPos.y,
        });
        obj.setCoords();
        changed = true;
      }
      newHoles.push({ x: obj.left, y: obj.top });
    });

    if (changed) {
      this.options.holes = newHoles;
      editor.canvas.requestRenderAll();
      // Need to sync changes back to Dieline if constraints moved them
      this.syncHolesToDieline(editor);
    }
  }

  private calculateConstrainedPosition(p: Point, g: DielineGeometry): Point {
    // Use Paper.js to get accurate nearest point
    // This handles ellipses, rects, and rounded rects correctly

    // Convert to holes format for geometry options
    const options = {
      ...g,
      holes: [], // We don't need holes for boundary calculation
    };

    const nearest = getNearestPointOnDieline(
      { x: p.x, y: p.y },
      options as any,
    );

    // Now constrain distance
    const nearestP = new Point(nearest.x, nearest.y);
    const dist = p.distanceFrom(nearestP);

    // Vector from nearest to current point
    const v = p.subtract(nearestP);

    // Vector from center to nearest point (approximate normal for convex shapes)
    const center = new Point(g.x, g.y);
    const centerToNearest = nearestP.subtract(center);

    const distToCenter = p.distanceFrom(center);
    const nearestDistToCenter = nearestP.distanceFrom(center);

    let signedDist = dist;
    if (distToCenter < nearestDistToCenter) {
      signedDist = -dist; // Inside
    }

    // Clamp distance
    let clampedDist = signedDist;
    if (signedDist > 0) {
      clampedDist = Math.min(signedDist, this.options.innerRadius);
    } else {
      clampedDist = Math.max(signedDist, -this.options.outerRadius);
    }

    // Reconstruct point
    if (dist < 0.001) return nearestP;

    // We want the result to lie on the line connecting Nearest -> P
    const scale = Math.abs(clampedDist) / (dist || 1);
    const offset = v.scalarMultiply(scale);

    return nearestP.add(offset);
  }
}
