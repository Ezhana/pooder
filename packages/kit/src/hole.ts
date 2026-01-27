import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { Circle, Group, Point } from "fabric";
import CanvasService from "./CanvasService";
import { DielineGeometry } from "./dieline";
import {
  getNearestPointOnDieline,
  HoleData,
  resolveHolePosition,
} from "./geometry";
import { Coordinate } from "./coordinate";

export class HoleTool implements Extension {
  id = "pooder.kit.hole";

  public metadata = {
    name: "HoleTool",
  };

  private holes: HoleData[] = [];
  private constraintTarget: "original" | "bleed" = "bleed";

  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleDielineChange: ((geometry: DielineGeometry) => void) | null =
    null;

  // Cache geometry to enforce constraints during drag
  private currentGeometry: DielineGeometry | null = null;

  constructor(
    options?: Partial<{
      holes: HoleData[];
      constraintTarget: "original" | "bleed";
    }>
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");

    if (!this.canvasService) {
      console.warn("CanvasService not found for HoleTool");
      return;
    }

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService"
    );
    if (configService) {
      // Load initial config
      this.constraintTarget = configService.get(
        "hole.constraintTarget",
        this.constraintTarget
      );

      // Load holes from dieline.holes (SSOT)
      this.holes = configService.get("dieline.holes", []);
      
      // Listen for changes
      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === "hole.constraintTarget") {
          this.constraintTarget = e.value;
          this.enforceConstraints();
        }

        // Listen for dieline.holes changes (e.g. from undo/redo or other sources)
        if (e.key === "dieline.holes") {
          this.holes = e.value || [];
          this.redraw();
        }
      });
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
          id: "hole.constraintTarget",
          type: "select",
          label: "Constraint Target",
          options: ["original", "bleed"],
          default: "bleed",
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

            const { width, height } = this.canvasService.canvas;
            const normalizedHole = Coordinate.normalizePoint(defaultPos, {
              width: width || 800,
              height: height || 600,
            });

            const configService = this.context?.services.get<ConfigurationService>(
              "ConfigurationService"
            );
            if (configService) {
              configService.update("dieline.holes", [
                {
                  x: normalizedHole.x,
                  y: normalizedHole.y,
                  innerRadius: 15,
                  outerRadius: 25,
                },
              ]);
            }
            return true;
          },
        },
        {
          command: "addHole",
          title: "Add Hole",
          handler: (x: number, y: number) => {
            if (!this.canvasService) return false;
            
            // Normalize relative to Dieline Geometry if available
            let normalizedX = 0.5;
            let normalizedY = 0.5;

            if (this.currentGeometry) {
                const { x: gx, y: gy, width: gw, height: gh } = this.currentGeometry;
                const left = gx - gw / 2;
                const top = gy - gh / 2;
                normalizedX = gw > 0 ? (x - left) / gw : 0.5;
                normalizedY = gh > 0 ? (y - top) / gh : 0.5;
            } else {
                 const { width, height } = this.canvasService.canvas;
                 normalizedX = Coordinate.toNormalized(x, width || 800);
                 normalizedY = Coordinate.toNormalized(y, height || 600);
            }

            const configService = this.context?.services.get<ConfigurationService>(
              "ConfigurationService"
            );
            
            if (configService) {
              const currentHoles = configService.get("dieline.holes", []) as HoleData[];
              // Use last hole's radii or default
              const lastHole = currentHoles[currentHoles.length - 1];
              const innerRadius = lastHole?.innerRadius ?? 15;
              const outerRadius = lastHole?.outerRadius ?? 25;

              const newHole = {
                  x: normalizedX,
                  y: normalizedY,
                  innerRadius,
                  outerRadius,
              };
              configService.update("dieline.holes", [...currentHoles, newHole]);
            }
            return true;
          },
        },
        {
          command: "clearHoles",
          title: "Clear Holes",
          handler: () => {
            const configService = this.context?.services.get<ConfigurationService>(
              "ConfigurationService"
            );
            if (configService) {
              configService.update("dieline.holes", []);
            }
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
        const changed = this.enforceConstraints();
        // Only sync if constraints actually moved something
        if (changed) {
          this.syncHolesToDieline();
        }
      };
      this.context.eventBus.on(
        "dieline:geometry:change",
        this.handleDielineChange,
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
              this.enforceConstraints();
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

        const index = target.data?.index ?? -1;
        const holeData = this.holes[index];

        // Calculate effective geometry based on constraint target
        const effectiveOffset =
          this.constraintTarget === "original"
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
        const newPos = this.calculateConstrainedPosition(
          p,
          constraintGeometry,
          holeData?.innerRadius ?? 15,
          holeData?.outerRadius ?? 25
        );

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
        // Ensure final position is constrained (handles case where 'modified' reports unconstrained coords)
        const changed = this.enforceConstraints();
        
        // If enforceConstraints changed something, it already synced.
        // If not, we sync manually to save the move (which was valid).
        if (!changed) {
          this.syncHolesFromCanvas();
        }
      };
      canvas.on("object:modified", this.handleModified);
    }

    this.initializeHoles();
  }

  private initializeHoles() {
    if (!this.canvasService) return;
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
        this.handleDielineChange,
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
        } catch (e) {}
      }
    }

    this.canvasService.requestRenderAll();
  }

  private syncHolesFromCanvas() {
    if (!this.canvasService) return;
    const objects = this.canvasService.canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");

    // Sort objects by index
    objects.sort(
      (a: any, b: any) => (a.data?.index ?? 0) - (b.data?.index ?? 0)
    );

    // Update holes based on canvas positions
    // We need to preserve original hole properties (radii, anchor)
    // If a hole has an anchor, we update offsetX/Y instead of x/y
    const newHoles = objects.map((obj, i) => {
      const original = this.holes[i];
      const newAbsX = obj.left!;
      const newAbsY = obj.top!;

      // Get current scale to denormalize offsets
      const scale = this.currentGeometry?.scale || 1;
      const unit = this.currentGeometry?.unit || "mm";
      const unitScale = Coordinate.convertUnit(1, "mm", unit);

      if (original && original.anchor && this.currentGeometry) {
        // Reverse calculate offset from anchor
        const { x, y, width, height } = this.currentGeometry;
        let bx = x;
        let by = y;
        const left = x - width / 2;
        const right = x + width / 2;
        const top = y - height / 2;
        const bottom = y + height / 2;

        switch (original.anchor) {
          case "top-left":
            bx = left;
            by = top;
            break;
          case "top-center":
            bx = x;
            by = top;
            break;
          case "top-right":
            bx = right;
            by = top;
            break;
          case "center-left":
            bx = left;
            by = y;
            break;
          case "center":
            bx = x;
            by = y;
            break;
          case "center-right":
            bx = right;
            by = y;
            break;
          case "bottom-left":
            bx = left;
            by = bottom;
            break;
          case "bottom-center":
            bx = x;
            by = bottom;
            break;
          case "bottom-right":
            bx = right;
            by = bottom;
            break;
        }
        
        return {
          ...original,
          // Denormalize offset back to physical units (mm)
          offsetX: (newAbsX - bx) / scale / unitScale,
          offsetY: (newAbsY - by) / scale / unitScale,
          // Clear direct coordinates if we use anchor
          x: undefined,
          y: undefined,
        };
      }

      // If no anchor, use normalized coordinates relative to Dieline Geometry
      // normalized = (absolute - (center - width/2)) / width
      let normalizedX = 0.5;
      let normalizedY = 0.5;

      if (this.currentGeometry) {
        const { x, y, width, height } = this.currentGeometry;
        const left = x - width / 2;
        const top = y - height / 2;
        normalizedX = width > 0 ? (newAbsX - left) / width : 0.5;
        normalizedY = height > 0 ? (newAbsY - top) / height : 0.5;
      } else {
        // Fallback to Canvas normalization if no geometry (should rare)
        const { width, height } = this.canvasService!.canvas;
        normalizedX = Coordinate.toNormalized(newAbsX, width || 800);
        normalizedY = Coordinate.toNormalized(newAbsY, height || 600);
      }
      
      return {
        ...original,
        x: normalizedX,
        y: normalizedY,
        // Ensure radii are preserved
        innerRadius: original?.innerRadius ?? 15,
        outerRadius: original?.outerRadius ?? 25,
      };
    });

    this.holes = newHoles;
    this.syncHolesToDieline();
  }

  private syncHolesToDieline() {
    if (!this.context || !this.canvasService) return;

    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService"
    );

    if (configService) {
      this.isUpdatingConfig = true;
      try {
        configService.update("dieline.holes", this.holes);
      } finally {
        this.isUpdatingConfig = false;
      }
    }
  }

  private redraw() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;
    const { width, height } = canvas;

    // Remove existing holes
    const existing = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "hole-marker");
    existing.forEach((obj) => canvas.remove(obj));

    const holes = this.holes;

    if (!holes || holes.length === 0) {
      this.canvasService.requestRenderAll();
      return;
    }

    // Resolve geometry if needed for anchors
    const geometry = this.currentGeometry || {
      x: (width || 800) / 2,
      y: (height || 600) / 2,
      width: width || 800,
      height: height || 600,
      scale: 1, // Default scale if no geometry loaded
    } as any;

    holes.forEach((hole, index) => {
      // Geometry scale is needed.
      const scale = geometry.scale || 1;
      const unit = geometry.unit || "mm";
      const unitScale = Coordinate.convertUnit(1, 'mm', unit);
      
      const visualInnerRadius = hole.innerRadius * unitScale * scale;
      const visualOuterRadius = hole.outerRadius * unitScale * scale;

      // Resolve position
      // Apply unit conversion and scale to offsets before resolving (mm -> px)
      const pos = resolveHolePosition(
        {
          ...hole,
          offsetX: (hole.offsetX || 0) * unitScale * scale,
          offsetY: (hole.offsetY || 0) * unitScale * scale,
        },
        geometry,
        { width: geometry.width, height: geometry.height } // Use geometry dims instead of canvas
      );

      const innerCircle = new Circle({
        radius: visualInnerRadius,
        fill: "transparent",
        stroke: "red",
        strokeWidth: 2,
        originX: "center",
        originY: "center",
      });

      const outerCircle = new Circle({
        radius: visualOuterRadius,
        fill: "transparent",
        stroke: "#666",
        strokeWidth: 1,
        strokeDashArray: [5, 5],
        originX: "center",
        originY: "center",
      });

      const holeGroup = new Group([outerCircle, innerCircle], {
        left: pos.x,
        top: pos.y,
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

    // Also bring all existing markers to front to be safe
    const markers = canvas.getObjects().filter((o: any) => o.data?.type === "hole-marker");
    markers.forEach(m => canvas.bringObjectToFront(m));

    this.canvasService.requestRenderAll();
  }

  public enforceConstraints(): boolean {
    const geometry = this.currentGeometry;
    if (!geometry || !this.canvasService) {
      return false;
    }

    const effectiveOffset =
      this.constraintTarget === "original" ? 0 : geometry.offset;
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
      (a: any, b: any) => (a.data?.index ?? 0) - (b.data?.index ?? 0)
    );

    const newHoles: HoleData[] = [];

    objects.forEach((obj: any, i: number) => {
      const currentPos = new Point(obj.left, obj.top);
      // We need to pass the hole's radii to calculateConstrainedPosition
    const holeData = this.holes[i];
    
    // Scale radii for constraint calculation (since geometry is in pixels)
    // Geometry scale is needed.
    const scale = geometry.scale || 1;
    const unit = geometry.unit || "mm";
    const unitScale = Coordinate.convertUnit(1, 'mm', unit);
    
    const innerR = (holeData?.innerRadius ?? 15) * unitScale * scale;
    const outerR = (holeData?.outerRadius ?? 25) * unitScale * scale;

    const newPos = this.calculateConstrainedPosition(
      currentPos,
      constraintGeometry,
      innerR,
      outerR
    );

      if (currentPos.distanceFrom(newPos) > 0.1) {
        obj.set({
          left: newPos.x,
          top: newPos.y,
        });
        obj.setCoords();
        changed = true;
      }
      
      // Update data logic is handled in syncHolesFromCanvas which is called on modified
      // But here we are modifying programmatically.
      // We should probably just let the visual update happen, and then sync?
      // Or just push to newHoles list to verify change?
    });

    if (changed) {
      // If we moved things programmatically, we should update the state
      this.syncHolesFromCanvas();
      return true;
    }
    return false;
  }

  private calculateConstrainedPosition(
    p: Point, 
    g: DielineGeometry, 
    innerRadius: number, 
    outerRadius: number
  ): Point {
    // Use Paper.js to get accurate nearest point
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

    const distToCenter = p.distanceFrom(center);
    const nearestDistToCenter = nearestP.distanceFrom(center);

    let signedDist = dist;
    if (distToCenter < nearestDistToCenter) {
      signedDist = -dist; // Inside
    }

    // Clamp distance
    let clampedDist = signedDist;
    if (signedDist > 0) {
      clampedDist = Math.min(signedDist, innerRadius);
    } else {
      clampedDist = Math.max(signedDist, -outerRadius);
    }

    // Reconstruct point
    if (dist < 0.001) return nearestP;

    // We want the result to lie on the line connecting Nearest -> P
    const scale = Math.abs(clampedDist) / (dist || 1);
    const offset = v.scalarMultiply(scale);

    return nearestP.add(offset);
  }
}
