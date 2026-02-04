import {
  Extension,
  ExtensionContext,
  ContributionPointIds,
  CommandContribution,
  ConfigurationContribution,
  ConfigurationService,
} from "@pooder/core";
import { Circle, Group, Point, Rect } from "fabric";
import CanvasService from "./CanvasService";
import { DielineGeometry } from "./dieline";
import {
  getNearestPointOnDieline,
  EdgeFeature,
  resolveFeaturePosition,
} from "./geometry";
import { Coordinate } from "./coordinate";

export class FeatureTool implements Extension {
  id = "pooder.kit.feature";

  public metadata = {
    name: "FeatureTool",
  };

  private features: EdgeFeature[] = [];
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleDielineChange: ((geometry: DielineGeometry) => void) | null =
    null;

  private currentGeometry: DielineGeometry | null = null;

  constructor(
    options?: Partial<{
      features: EdgeFeature[];
    }>,
  ) {
    if (options) {
      Object.assign(this, options);
    }
  }

  activate(context: ExtensionContext) {
    this.context = context;
    this.canvasService = context.services.get<CanvasService>("CanvasService");

    if (!this.canvasService) {
      console.warn("CanvasService not found for FeatureTool");
      return;
    }

    const configService = context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      this.features = configService.get("dieline.features", []);

      configService.onAnyChange((e: { key: string; value: any }) => {
        if (this.isUpdatingConfig) return;

        if (e.key === "dieline.features") {
          this.features = e.value || [];
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
      [ContributionPointIds.COMMANDS]: [
        {
          command: "addFeature",
          title: "Add Edge Feature",
          handler: (type: "add" | "subtract" = "subtract") => {
            return this.addFeature(type);
          },
        },
        {
          command: "addHole",
          title: "Add Hole",
          handler: () => {
            return this.addFeature("subtract");
          },
        },
        {
          command: "addDoubleLayerHole",
          title: "Add Double Layer Hole",
          handler: () => {
            return this.addDoubleLayerHole();
          },
        },
        {
          command: "clearFeatures",
          title: "Clear Features",
          handler: () => {
            const configService =
              this.context?.services.get<ConfigurationService>(
                "ConfigurationService",
              );
            if (configService) {
              configService.update("dieline.features", []);
            }
            return true;
          },
        },
      ] as CommandContribution[],
    };
  }

  private addFeature(type: "add" | "subtract") {
    if (!this.canvasService) return false;

    // Default to top edge center
    const newFeature: EdgeFeature = {
      id: Date.now().toString(),
      operation: type,
      target: "offset",
      shape: "rect",
      x: 0.5,
      y: 0, // Top edge
      width: 10,
      height: 10,
      rotation: 0,
    };

    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );

    if (configService) {
      const current = configService.get(
        "dieline.features",
        [],
      ) as EdgeFeature[];
      configService.update("dieline.features", [...current, newFeature]);
    }
    return true;
  }

  private addDoubleLayerHole() {
    if (!this.canvasService) return false;

    const groupId = Date.now().toString();
    const timestamp = Date.now();

    // 1. Lug (Outer) - Add
    const lug: EdgeFeature = {
      id: `${timestamp}-lug`,
      groupId,
      operation: "add",
      shape: "circle",
      x: 0.5,
      y: 0,
      radius: 20, // 20mm diameter
      rotation: 0,
    };

    // 2. Hole (Inner) - Subtract
    const hole: EdgeFeature = {
      id: `${timestamp}-hole`,
      groupId,
      operation: "subtract",
      shape: "circle",
      x: 0.5,
      y: 0,
      radius: 15, // 10mm diameter
      rotation: 0,
    };

    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );

    if (configService) {
      const current = configService.get(
        "dieline.features",
        [],
      ) as EdgeFeature[];
      configService.update("dieline.features", [...current, lug, hole]);
    }
    return true;
  }

  private setup() {
    if (!this.canvasService || !this.context) return;
    const canvas = this.canvasService.canvas;

    // 1. Listen for Dieline Geometry Changes
    if (!this.handleDielineChange) {
      this.handleDielineChange = (geometry: DielineGeometry) => {
        this.currentGeometry = geometry;
        this.redraw();
        this.enforceConstraints();
      };
      this.context.eventBus.on(
        "dieline:geometry:change",
        this.handleDielineChange,
      );
    }

    // 2. Initial Fetch of Geometry
    const commandService = this.context.services.get<any>("CommandService");
    if (commandService) {
      try {
        Promise.resolve(commandService.executeCommand("getGeometry")).then(
          (g) => {
            if (g) {
              this.currentGeometry = g as DielineGeometry;
              this.redraw();
            }
          },
        );
      } catch (e) {}
    }

    // 3. Setup Canvas Interaction
    if (!this.handleMoving) {
      this.handleMoving = (e: any) => {
        const target = e.target;
        if (!target || target.data?.type !== "feature-marker") return;
        if (!this.currentGeometry) return;

        // Snap to edge during move
        // For Group, target.left/top is group center (or top-left depending on origin)
        // We snap the target position itself.
        const p = new Point(target.left, target.top);
        const snapped = this.snapToEdge(p, this.currentGeometry);

        target.set({
          left: snapped.x,
          top: snapped.y,
        });
      };
      canvas.on("object:moving", this.handleMoving);
    }

    if (!this.handleModified) {
      this.handleModified = (e: any) => {
        const target = e.target;
        if (!target || target.data?.type !== "feature-marker") return;

        // Sync changes back to config
        if (target.data?.isGroup) {
          // It's a Group object
          const groupObj = target as Group;
          // @ts-ignore
          const indices = groupObj.data?.indices as number[];
          if (!indices) return;

          // We need to update all features in the group based on their new absolute positions.
          // Fabric Group children positions are relative to group center.
          // We need to calculate absolute position for each child.
          // Note: groupObj has already been moved to new position (target.left, target.top)

          const groupCenter = new Point(groupObj.left, groupObj.top);
          // Get group matrix to transform children
          // Simplified: just add relative coordinates if no rotation/scaling on group
          // We locked rotation/scaling, so it's safe.

          const newFeatures = [...this.features];
          const { width, height, x, y } = this.currentGeometry!;
          const layoutLeft = x - width / 2;
          const layoutTop = y - height / 2;

          // Fabric Group objects have .getObjects() which returns children
          // But children inside group have coordinates relative to group center.
          // center is (0,0) inside the group local coordinate system.

          groupObj.getObjects().forEach((child, i) => {
            const originalIndex = indices[i];
            // Calculate absolute position
            // child.left/top are relative to group center
            const absX = groupCenter.x + (child.left || 0);
            const absY = groupCenter.y + (child.top || 0);

            // Normalize
            const normalizedX = width > 0 ? (absX - layoutLeft) / width : 0.5;
            const normalizedY = height > 0 ? (absY - layoutTop) / height : 0.5;

            newFeatures[originalIndex] = {
              ...newFeatures[originalIndex],
              x: normalizedX,
              y: normalizedY,
            };
          });

          this.features = newFeatures;

          const configService =
            this.context?.services.get<ConfigurationService>(
              "ConfigurationService",
            );
          if (configService) {
            this.isUpdatingConfig = true;
            try {
              configService.update("dieline.features", this.features);
            } finally {
              this.isUpdatingConfig = false;
            }
          }
        } else {
          // Single object
          this.syncFeatureFromCanvas(target);
        }
      };
      canvas.on("object:modified", this.handleModified);
    }
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
      .filter((obj: any) => obj.data?.type === "feature-marker");
    objects.forEach((obj) => canvas.remove(obj));

    this.canvasService.requestRenderAll();
  }

  private snapToEdge(
    p: Point,
    geometry: DielineGeometry,
  ): { x: number; y: number } {
    // Use geometry helper to find nearest point on Base Shape
    // geometry object matches GeometryOptions structure required by getNearestPointOnDieline
    // except for 'features' which we don't need for base shape snapping
    const result = getNearestPointOnDieline({ x: p.x, y: p.y }, {
      ...geometry,
      features: [],
    } as any);
    return result;
  }

  private syncFeatureFromCanvas(target: any) {
    if (!this.currentGeometry || !this.context) return;

    const index = target.data?.index;
    if (index === undefined || index < 0 || index >= this.features.length)
      return;

    const feature = this.features[index];
    const { width, height, x, y } = this.currentGeometry;

    // Calculate Normalized Position
    // The geometry x/y is the CENTER.
    const left = x - width / 2;
    const top = y - height / 2;

    const normalizedX = width > 0 ? (target.left - left) / width : 0.5;
    const normalizedY = height > 0 ? (target.top - top) / height : 0.5;

    // Update feature
    const updatedFeature = {
      ...feature,
      x: normalizedX,
      y: normalizedY,
      // Could also update rotation if we allowed rotating markers
    };

    const newFeatures = [...this.features];
    newFeatures[index] = updatedFeature;
    this.features = newFeatures;

    // Save to config
    const configService = this.context.services.get<ConfigurationService>(
      "ConfigurationService",
    );
    if (configService) {
      this.isUpdatingConfig = true;
      try {
        configService.update("dieline.features", this.features);
      } finally {
        this.isUpdatingConfig = false;
      }
    }
  }

  private redraw() {
    if (!this.canvasService || !this.currentGeometry) return;
    const canvas = this.canvasService.canvas;
    const geometry = this.currentGeometry;

    // Remove existing markers
    const existing = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "feature-marker");
    existing.forEach((obj) => canvas.remove(obj));

    if (!this.features || this.features.length === 0) {
      this.canvasService.requestRenderAll();
      return;
    }

    const unitScale = Coordinate.convertUnit(1, "mm", geometry.unit || "mm");
    const scale = geometry.scale || 1;
    const finalScale = unitScale * scale;

    // Group features by groupId
    const groups: { [key: string]: { feature: EdgeFeature; index: number }[] } =
      {};
    const singles: { feature: EdgeFeature; index: number }[] = [];

    this.features.forEach((f, i) => {
      if (f.groupId) {
        if (!groups[f.groupId]) groups[f.groupId] = [];
        groups[f.groupId].push({ feature: f, index: i });
      } else {
        singles.push({ feature: f, index: i });
      }
    });

    // Helper to create marker shape
    const createMarkerShape = (
      feature: EdgeFeature,
      pos: { x: number; y: number },
    ) => {
      const visualWidth = (feature.width || 10) * finalScale;
      const visualHeight = (feature.height || 10) * finalScale;
      const visualRadius = (feature.radius || 0) * finalScale;
      const color = feature.operation === "add" ? "#00FF00" : "#FF0000";
      const strokeDash = feature.operation === "subtract" ? [4, 4] : undefined;

      let shape: any;
      if (feature.shape === "rect") {
        shape = new Rect({
          width: visualWidth,
          height: visualHeight,
          rx: visualRadius,
          ry: visualRadius,
          fill: "transparent",
          stroke: color,
          strokeWidth: 2,
          strokeDashArray: strokeDash,
          originX: "center",
          originY: "center",
          left: pos.x,
          top: pos.y,
        });
      } else {
        shape = new Circle({
          radius: visualRadius || 5 * finalScale,
          fill: "transparent",
          stroke: color,
          strokeWidth: 2,
          strokeDashArray: strokeDash,
          originX: "center",
          originY: "center",
          left: pos.x,
          top: pos.y,
        });
      }
      if (feature.rotation) {
        shape.rotate(feature.rotation);
      }
      return shape;
    };

    // Render Singles
    singles.forEach(({ feature, index }) => {
      const pos = resolveFeaturePosition(feature, geometry);
      const marker = createMarkerShape(feature, pos);

      marker.set({
        selectable: true,
        hasControls: false,
        hasBorders: false,
        hoverCursor: "move",
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        data: { type: "feature-marker", index, isGroup: false },
      });

      // Auto-hide logic
      marker.set("opacity", 0);
      marker.on("mouseover", () => {
        marker.set("opacity", 1);
        canvas.requestRenderAll();
      });
      marker.on("mouseout", () => {
        if (canvas.getActiveObject() !== marker) {
          marker.set("opacity", 0);
          canvas.requestRenderAll();
        }
      });
      marker.on("selected", () => {
        marker.set("opacity", 1);
        canvas.requestRenderAll();
      });
      marker.on("deselected", () => {
        marker.set("opacity", 0);
        canvas.requestRenderAll();
      });

      canvas.add(marker);
      canvas.bringObjectToFront(marker);
    });

    // Render Groups
    Object.keys(groups).forEach((groupId) => {
      const members = groups[groupId];
      if (members.length === 0) return;

      // Calculate group center (average position) to position the group correctly
      // But Fabric Group uses relative coordinates.
      // Easiest way: Create shapes at absolute positions, then Group them.
      // Fabric will auto-calculate group center and adjust children.

      const shapes = members.map(({ feature }) => {
        const pos = resolveFeaturePosition(feature, geometry);
        return createMarkerShape(feature, pos);
      });

      const groupObj = new Group(shapes, {
        selectable: true,
        hasControls: false,
        hasBorders: false,
        hoverCursor: "move",
        lockRotation: true,
        lockScalingX: true,
        lockScalingY: true,
        subTargetCheck: true, // Allow events to pass through if needed, but we treat as one
        interactive: false, // Children not interactive
        // @ts-ignore
        data: {
          type: "feature-marker",
          isGroup: true,
          groupId,
          indices: members.map((m) => m.index),
        },
      });

      // Auto-hide logic for group
      groupObj.set("opacity", 0);
      groupObj.on("mouseover", () => {
        groupObj.set("opacity", 1);
        canvas.requestRenderAll();
      });
      groupObj.on("mouseout", () => {
        if (canvas.getActiveObject() !== groupObj) {
          groupObj.set("opacity", 0);
          canvas.requestRenderAll();
        }
      });
      groupObj.on("selected", () => {
        groupObj.set("opacity", 1);
        canvas.requestRenderAll();
      });
      groupObj.on("deselected", () => {
        groupObj.set("opacity", 0);
        canvas.requestRenderAll();
      });

      canvas.add(groupObj);
      canvas.bringObjectToFront(groupObj);
    });

    this.canvasService.requestRenderAll();
  }

  private enforceConstraints() {
    if (!this.canvasService || !this.currentGeometry) return;
    // Iterate markers and snap them if geometry changed
    const canvas = this.canvasService.canvas;
    const markers = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "feature-marker");

    markers.forEach((marker: any) => {
      const snapped = this.snapToEdge(
        new Point(marker.left, marker.top),
        this.currentGeometry!,
      );
      marker.set({ left: snapped.x, top: snapped.y });
      marker.setCoords();
    });
    canvas.requestRenderAll();
  }
}
