import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
} from "@pooder/core";
import { Circle, Group, Point } from "fabric";
import CanvasService from "./CanvasService";
import { DielineGeometry } from "./dieline";
import { getNearestPointOnDieline, HoleData } from "./geometry";

interface HoleToolOptions {
  innerRadius: number;
  outerRadius: number;
  style: "solid" | "dashed";
  holes?: Array<{ x: number; y: number }>;
  constraintTarget?: "original" | "bleed";
}

export class HoleTool implements Extension {
  public metadata = { name: "HoleTool" };
  
  private _options: HoleToolOptions = {
    innerRadius: 15,
    outerRadius: 25,
    style: "solid",
    holes: [],
    constraintTarget: "bleed",
  };

  private canvasService?: CanvasService;
  private context?: ExtensionContext;

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleDielineChange: ((geometry: DielineGeometry) => void) | null =
    null;

  // Cache geometry to enforce constraints during drag
  private currentGeometry: DielineGeometry | null = null;

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");

    if (!this.canvasService) {
      console.warn("CanvasService not found for HoleTool");
      return;
    }

    this.setup();
  }

  deactivate(context: ExtensionContext) {
    this.teardown();
    this.canvasService = undefined;
    this.context = undefined;
  }

  contribute() {
    return {
      [ContributionPointIds.CONFIGURATIONS]: [
        {
          id: "hole.innerRadius",
          type: "number",
          label: "Inner Radius",
          min: 1,
          max: 100,
          default: 15,
        },
        {
          id: "hole.outerRadius",
          type: "number",
          label: "Outer Radius",
          min: 1,
          max: 100,
          default: 25,
        },
        {
          id: "hole.style",
          type: "select",
          label: "Line Style",
          options: ["solid", "dashed"],
          default: "solid",
        },
        {
          id: "hole.constraintTarget",
          type: "select",
          label: "Constraint Target",
          options: ["original", "bleed"],
          default: "bleed",
        },
        {
          id: "hole.holes",
          type: "json",
          label: "Holes",
          default: [],
        },
      ] as ConfigurationContribution[],
      [ContributionPointIds.COMMANDS]: [
        {
          command: "resetHoles",
          title: "Reset Holes",
          handler: () => {
            if (!this.canvasService) return false;
            let defaultPos = { x: this.canvasService.canvas.width! / 2, y: 50 };

            if (this.currentGeometry) {
              const g = this.currentGeometry;
              const topCenter = { x: g.x, y: g.y - g.height / 2 };
              defaultPos = getNearestPointOnDieline(topCenter, {
                ...g,
                holes: [],
              } as any);
            }

            this._options = {
              innerRadius: 15,
              outerRadius: 25,
              style: "solid",
              holes: [defaultPos],
            };
            this.redraw();
            this.syncHolesToDieline();
            return true;
          },
        },
        {
          command: "addHole",
          title: "Add Hole",
          handler: (x: number, y: number) => {
            if (!this._options.holes) this._options.holes = [];
            this._options.holes.push({ x, y });
            this.redraw();
            this.syncHolesToDieline();
            return true;
          },
        },
        {
          command: "clearHoles",
          title: "Clear Holes",
          handler: () => {
            this._options.holes = [];
            this.redraw();
            this.syncHolesToDieline();
            return true;
          },
        },
      ] as CommandContribution[],
    };
  }

  private setup() {
    if (!this.canvasService || !this.context) return;
    const canvas = this.canvasService.canvas;

    // 1. Listen for Dieline Geometry Changes
    if (!this.handleDielineChange) {
      this.handleDielineChange = (geometry: DielineGeometry) => {
        this.currentGeometry = geometry;
        this.enforceConstraints();
        // After enforcing constraints (updating markers), we must tell Dieline to update its holes
        this.syncHolesToDieline();
      };
      this.context.eventBus.on(
        "dieline:geometry:change",
        this.handleDielineChange
      );
    }

    // 2. Initial Fetch of Geometry
    // Assuming DielineTool registered 'getGeometry' command which is now available via CommandService
    // Since we don't have direct access to CommandService here (it was in activate),
    // we can get it from context.services
    const commandService = this.context.services.get<any>("CommandService");
    if (commandService) {
      try {
        const geometry = commandService.executeCommand("getGeometry");
        if (geometry) {
          // If executeCommand returns a promise, await it? 
          // CommandService.executeCommand is async in previous definition.
          // But here we are in sync setup.
          // Let's assume we can handle the promise if needed, or if it returns value directly (if not async).
          // Checking CommandService implementation: executeCommand IS async.
          Promise.resolve(geometry).then((g) => {
             if (g) {
                this.currentGeometry = g as DielineGeometry;
                // Re-run setup logic dependent on geometry
                this.initializeHoles();
             }
          });
        }
      } catch (e) {
        // Command might not be ready
      }
    }

    // 3. Setup Canvas Interaction
    if (!this.handleMoving) {
      this.handleMoving = (e: any) => {
        const target = e.target;
        if (!target || target.data?.type !== "hole-marker") return;

        if (!this.currentGeometry) return;

        // Calculate effective geometry based on constraint target
        const effectiveOffset =
          this._options.constraintTarget === "original"
            ? 0
            : this.currentGeometry.offset;
        const constraintGeometry = {
          ...this.currentGeometry,
          width: Math.max(0, this.currentGeometry.width + effectiveOffset * 2),
          height: Math.max(
            0,
            this.currentGeometry.height + effectiveOffset * 2
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
      canvas.on("object:moving", this.handleMoving);
    }

    if (!this.handleModified) {
      this.handleModified = (e: any) => {
        const target = e.target;
        if (!target || target.data?.type !== "hole-marker") return;

        // Update state when hole is moved
        this.syncHolesFromCanvas();
      };
      canvas.on("object:modified", this.handleModified);
    }

    this.initializeHoles();
  }

  private initializeHoles() {
    if (!this.canvasService) return;
    const opts = this._options;
    // Default hole if none exist
    if (!opts.holes || opts.holes.length === 0) {
      let defaultPos = { x: this.canvasService.canvas.width! / 2, y: 50 };

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

    this._options = { ...opts };
    this.redraw();
    this.syncHolesToDieline();
  }

  private teardown() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;

    if (this.handleMoving) {
      canvas.off("object:moving", this.handleMoving);
      this.handleMoving = null;
    }
    if (this.handleModified) {
      canvas.off("object:modified", this.handleModified);
      this.handleModified = null;
    }
    if (this.handleDielineChange && this.context) {
      this.context.eventBus.off(
        "dieline:geometry:change",
        this.handleDielineChange
      );
      this.handleDielineChange = null;
    }

    const objects = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");
    objects.forEach((obj) => canvas.remove(obj));

    // Clear holes from Dieline (visual only, state preserved in HoleTool options)
    if (this.context) {
        const commandService = this.context.services.get<any>("CommandService");
        if (commandService) {
            try {
                commandService.executeCommand("setHoles", []);
            } catch(e) {}
        }
    }

    this.canvasService.requestRenderAll();
  }

  private syncHolesFromCanvas() {
    if (!this.canvasService) return;
    const objects = this.canvasService.canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");

    const holes = objects.map((obj) => ({ x: obj.left!, y: obj.top! }));
    this._options.holes = holes;

    this.syncHolesToDieline();
  }

  private syncHolesToDieline() {
    const { holes, innerRadius, outerRadius } = this._options;
    const currentHoles = holes || [];

    const holeData: HoleData[] = currentHoles.map((h) => ({
      x: h.x,
      y: h.y,
      innerRadius,
      outerRadius,
    }));

    if (this.context) {
        const commandService = this.context.services.get<any>("CommandService");
        if (commandService) {
            try {
                commandService.executeCommand("setHoles", holeData);
            } catch (e) {}
        }
    }
  }

  private redraw() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;

    // Remove existing holes
    const existing = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");
    existing.forEach((obj) => canvas.remove(obj));

    const { innerRadius, outerRadius, style, holes } = this._options;

    if (!holes || holes.length === 0) {
      this.canvasService.requestRenderAll();
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

    this.canvasService.requestRenderAll();
  }

  public enforceConstraints() {
    const geometry = this.currentGeometry;
    if (!geometry || !this.canvasService) return;

    const effectiveOffset =
      this._options.constraintTarget === "original" ? 0 : geometry.offset;
    const constraintGeometry = {
      ...geometry,
      width: Math.max(0, geometry.width + effectiveOffset * 2),
      height: Math.max(0, geometry.height + effectiveOffset * 2),
      radius: Math.max(0, geometry.radius + effectiveOffset),
    };

    // Get all hole markers
    const objects = this.canvasService.canvas
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
      this._options.holes = newHoles;
      this.canvasService.requestRenderAll();
      // Need to sync changes back to Dieline if constraints moved them
      this.syncHolesToDieline();
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
      clampedDist = Math.min(signedDist, this._options.innerRadius);
    } else {
      clampedDist = Math.max(signedDist, -this._options.outerRadius);
    }

    // Reconstruct point
    if (dist < 0.001) return nearestP;

    // We want the result to lie on the line connecting Nearest -> P
    const scale = Math.abs(clampedDist) / (dist || 1);
    const offset = v.scalarMultiply(scale);

    return nearestP.add(offset);
  }
}
