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
  DielineFeature,
  resolveFeaturePosition,
} from "./geometry";
import { ConstraintRegistry } from "./constraints";

export class FeatureTool implements Extension {
  id = "pooder.kit.feature";

  public metadata = {
    name: "FeatureTool",
  };

  private features: DielineFeature[] = [];
  private canvasService?: CanvasService;
  private context?: ExtensionContext;
  private isUpdatingConfig = false;
  private isToolActive = false;

  private handleMoving: ((e: any) => void) | null = null;
  private handleModified: ((e: any) => void) | null = null;
  private handleDielineChange: ((geometry: DielineGeometry) => void) | null =
    null;

  private currentGeometry: DielineGeometry | null = null;

  constructor(
    options?: Partial<{
      features: DielineFeature[];
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

    // Listen to tool activation
    context.eventBus.on("tool:activated", this.onToolActivated);

    this.setup();
  }

  deactivate(context: ExtensionContext) {
    context.eventBus.off("tool:activated", this.onToolActivated);
    this.teardown();
    this.canvasService = undefined;
    this.context = undefined;
  }

  private onToolActivated = (event: { id: string }) => {
    this.isToolActive = event.id === this.id;
    this.updateVisibility();
  };

  private updateVisibility() {
    if (!this.canvasService) return;
    const canvas = this.canvasService.canvas;
    const markers = canvas
      .getObjects()
      .filter((obj: any) => obj.data?.type === "feature-marker");
    
    markers.forEach((marker: any) => {
        // If tool active, allow selection. If not, disable selection.
        // Also might want to hide them entirely or just disable interaction.
        // Assuming we only want to see/edit holes when tool is active.
        marker.set({
            visible: this.isToolActive, // Or just selectable: false if we want them visible but locked
            selectable: this.isToolActive,
            evented: this.isToolActive
        });
    });
    canvas.requestRenderAll();
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

    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );

    // Default to top edge center
    const newFeature: DielineFeature = {
      id: Date.now().toString(),
      operation: type,
      placement: "edge",
      shape: "rect",
      x: 0.5,
      y: 0, // Top edge
      width: 10,
      height: 10,
      rotation: 0,
    };

    if (configService) {
      const current = configService.get(
        "dieline.features",
        [],
      ) as DielineFeature[];
      configService.update("dieline.features", [...current, newFeature]);
    }
    return true;
  }

  private addDoubleLayerHole() {
    if (!this.canvasService) return false;

    const configService = this.context?.services.get<ConfigurationService>(
      "ConfigurationService",
    );

    const groupId = Date.now().toString();
    const timestamp = Date.now();

    // 1. Lug (Outer) - Add
    const lug: DielineFeature = {
      id: `${timestamp}-lug`,
      groupId,
      operation: "add",
      shape: "circle",
      placement: "edge",
      x: 0.5,
      y: 0,
      radius: 20,
      rotation: 0,
    };

    // 2. Hole (Inner) - Subtract
    const hole: DielineFeature = {
      id: `${timestamp}-hole`,
      groupId,
      operation: "subtract",
      shape: "circle",
      placement: "edge",
      x: 0.5,
      y: 0,
      radius: 15,
      rotation: 0,
    };

    if (configService) {
      const current = configService.get(
        "dieline.features",
        [],
      ) as DielineFeature[];
      configService.update("dieline.features", [...current, lug, hole]);
    }
    return true;
  }

  private getGeometryForFeature(
    geometry: DielineGeometry,
    feature?: DielineFeature,
  ): DielineGeometry {
    // Legacy support or specialized scaling can go here if needed
    // Currently all features operate on the base geometry (or scaled version of it)
    return geometry;
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

        // Determine feature to use for snapping context
        let feature: DielineFeature | undefined;
        if (target.data?.isGroup) {
          const indices = target.data?.indices as number[];
          if (indices && indices.length > 0) {
            feature = this.features[indices[0]];
          }
        } else {
          const index = target.data?.index;
          if (index !== undefined) {
            feature = this.features[index];
          }
        }

        const geometry = this.getGeometryForFeature(
          this.currentGeometry,
          feature,
        );

        // Snap to edge during move
        // For Group, target.left/top is group center (or top-left depending on origin)
        // We snap the target position itself.
        const p = new Point(target.left, target.top);
        
        // Calculate limit based on target size (min dimension / 2 ensures overlap)
        // Also subtract stroke width to ensure visual overlap (not just tangent)
        // target.strokeWidth for group is usually 0, need a safe default (e.g. 2 for markers)
        const markerStrokeWidth = (target.strokeWidth || 2) * (target.scaleX || 1);
        const minDim = Math.min(target.getScaledWidth(), target.getScaledHeight());
        const limit = Math.max(0, minDim / 2 - markerStrokeWidth);
        
        const snapped = this.constrainPosition(p, geometry, limit, feature);

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
          const { x, y } = this.currentGeometry!; // Center is same

          // Fabric Group objects have .getObjects() which returns children
          // But children inside group have coordinates relative to group center.
          // center is (0,0) inside the group local coordinate system.

          groupObj.getObjects().forEach((child, i) => {
            const originalIndex = indices[i];
            const feature = this.features[originalIndex];
            const geometry = this.getGeometryForFeature(
              this.currentGeometry!,
              feature,
            );
            const { width, height } = geometry;
            const layoutLeft = x - width / 2;
            const layoutTop = y - height / 2;

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

  private constrainPosition(
    p: Point,
    geometry: DielineGeometry,
    limit: number,
    feature?: DielineFeature
  ): { x: number; y: number } {
    if (feature && feature.constraints) {
      // Use Constraint Registry
      // Convert to normalized coordinates
      const minX = geometry.x - geometry.width / 2;
      const minY = geometry.y - geometry.height / 2;
      
      const nx = geometry.width > 0 ? (p.x - minX) / geometry.width : 0.5;
      const ny = geometry.height > 0 ? (p.y - minY) / geometry.height : 0.5;

      const scale = geometry.scale || 1;
      const dielineWidth = geometry.width / scale;
      const dielineHeight = geometry.height / scale;

      const constrained = ConstraintRegistry.apply(nx, ny, feature, {
        dielineWidth,
        dielineHeight,
      });

      return {
        x: minX + constrained.x * geometry.width,
        y: minY + constrained.y * geometry.height,
      };
    }

    if (feature && feature.placement === "internal") {
       // Constrain to bounds
       // geometry.x/y is center
       const minX = geometry.x - geometry.width / 2;
       const maxX = geometry.x + geometry.width / 2;
       const minY = geometry.y - geometry.height / 2;
       const maxY = geometry.y + geometry.height / 2;
       
       return {
         x: Math.max(minX, Math.min(maxX, p.x)),
         y: Math.max(minY, Math.min(maxY, p.y))
       };
    }

    // Use geometry helper to find nearest point on Base Shape
    // geometry object matches GeometryOptions structure required by getNearestPointOnDieline
    // except for 'features' which we don't need for base shape snapping
    const nearest = getNearestPointOnDieline({ x: p.x, y: p.y }, {
      ...geometry,
      features: [],
    } as any);

    // Calculate vector from nearest point to current point
    const dx = p.x - nearest.x;
    const dy = p.y - nearest.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // If within limit, allow current position (offset from edge)
    if (dist <= limit) {
      return { x: p.x, y: p.y };
    }

    // Otherwise, clamp to limit
    const scale = limit / dist;
    return {
      x: nearest.x + dx * scale,
      y: nearest.y + dy * scale,
    };
  }

  private syncFeatureFromCanvas(target: any) {
    if (!this.currentGeometry || !this.context) return;

    const index = target.data?.index;
    if (index === undefined || index < 0 || index >= this.features.length)
      return;

    const feature = this.features[index];
    const geometry = this.getGeometryForFeature(this.currentGeometry, feature);
    const { width, height, x, y } = geometry;

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

    const scale = geometry.scale || 1;
    const finalScale = scale;

    // Group features by groupId
    const groups: { [key: string]: { feature: DielineFeature; index: number }[] } =
      {};
    const singles: { feature: DielineFeature; index: number }[] = [];

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
      feature: DielineFeature,
      pos: { x: number; y: number },
    ) => {
      const featureScale = scale;

      const visualWidth = (feature.width || 10) * featureScale;
      const visualHeight = (feature.height || 10) * featureScale;
      const visualRadius = (feature.radius || 0) * featureScale;
      const color =
        feature.color ||
        (feature.operation === "add" ? "#00FF00" : "#FF0000");
      const strokeDash =
        feature.strokeDash ||
        (feature.operation === "subtract" ? [4, 4] : undefined);

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
      const geometry = this.getGeometryForFeature(
        this.currentGeometry!,
        feature,
      );
      const pos = resolveFeaturePosition(feature, geometry);
      const marker = createMarkerShape(feature, pos);

      marker.set({
        visible: this.isToolActive,
        selectable: this.isToolActive,
        evented: this.isToolActive,
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
        const geometry = this.getGeometryForFeature(
          this.currentGeometry!,
          feature,
        );
        const pos = resolveFeaturePosition(feature, geometry);
        return createMarkerShape(feature, pos);
      });

      const groupObj = new Group(shapes, {
        visible: this.isToolActive,
        selectable: this.isToolActive,
        evented: this.isToolActive,
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
      // Find associated feature
      let feature: DielineFeature | undefined;
      if (marker.data?.isGroup) {
        const indices = marker.data?.indices as number[];
        if (indices && indices.length > 0) {
          feature = this.features[indices[0]];
        }
      } else {
        const index = marker.data?.index;
        if (index !== undefined) {
          feature = this.features[index];
        }
      }

      const geometry = this.getGeometryForFeature(
        this.currentGeometry!,
        feature,
      );

      const markerStrokeWidth = (marker.strokeWidth || 2) * (marker.scaleX || 1);
      const minDim = Math.min(marker.getScaledWidth(), marker.getScaledHeight());
      const limit = Math.max(0, minDim / 2 - markerStrokeWidth);
      
      const snapped = this.constrainPosition(
        new Point(marker.left, marker.top),
        geometry,
        limit,
        feature
      );
      marker.set({ left: snapped.x, top: snapped.y });
      marker.setCoords();
    });
    canvas.requestRenderAll();
  }
}
