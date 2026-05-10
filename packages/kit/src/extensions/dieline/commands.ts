import type { CommandContribution } from "@pooder/core";

export function createDielineCommands(tool: any, state: any): CommandContribution[] {
  return [
    {
      command: "updateFeaturePosition",
      id: "updateFeaturePosition",
      title: "Update Feature Position",
      handler: (groupId: string, x: number, y: number) => {
        tool.updateFeaturePosition(groupId, x, y);
      },
    },
    {
      command: "detectEdge",
      id: "detectEdge",
      title: "Detect Edge from Image",
      handler: async (
        imageUrl: string,
        options?: {
          expand?: number;
          smoothing?: boolean;
          simplifyTolerance?: number;
          threshold?: number;
          maxTraceDimension?: number;
          maskMode?: "auto" | "alpha" | "whitebg";
          debug?: boolean;
        },
      ) => {
        try {
          const detectOptions = options || {};
          const debug = detectOptions.debug === true;
          const tracerOptions = {
            expand: detectOptions.expand ?? 0,
            smoothing: detectOptions.smoothing ?? true,
            simplifyTolerance: detectOptions.simplifyTolerance ?? 2,
            threshold: detectOptions.threshold,
            maxTraceDimension: detectOptions.maxTraceDimension,
            maskMode: detectOptions.maskMode,
            debug,
          };

          const loadImage = (url: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
              const img = new Image();
              img.crossOrigin = "Anonymous";
              img.onload = () => resolve(img);
              img.onerror = (e) => reject(e);
              img.src = url;
            });
          };

          const [img, traced] = await Promise.all([
            loadImage(imageUrl),
            import("../tracer").then(({ ImageTracer }) =>
              ImageTracer.traceWithBounds(imageUrl, tracerOptions),
            ),
          ]);
          const { pathData, baseBounds, bounds } = traced;

          if (debug) {
            console.info("[DielineTool] detectEdge", {
              imageWidth: img.width,
              imageHeight: img.height,
              baseBounds,
              expandedBounds: bounds,
              currentDielineWidth: state.width,
              currentDielineHeight: state.height,
              options: tracerOptions,
              strategy: "single-connected-silhouette",
            });
          }

          return {
            pathData,
            rawBounds: bounds,
            baseBounds,
            imageWidth: img.width,
            imageHeight: img.height,
          };
        } catch (e) {
          console.error("Edge detection failed", e);
          throw e;
        }
      },
    },
  ];
}
