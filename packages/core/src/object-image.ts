import type { AffinePlacement, CoordinateRect } from "./coordinate";
import type { SceneExportFormat } from "./scene-export";
import type { Service } from "./service";

export type ObjectImageRepresentation =
  | "committed-visual"
  | "original-resource";

export interface ResolveObjectImageOptions {
  objectId: string;
  representation?: ObjectImageRepresentation;
  format?: SceneExportFormat;
  multiplier?: number;
}

export interface ResolvedObjectImage {
  objectId: string;
  representation: ObjectImageRepresentation;
  url: string;
  width: number;
  height: number;
  format: SceneExportFormat;
  sceneBounds: CoordinateRect<"scene">;
  placement: AffinePlacement;
  revision: number;
  derived: boolean;
}

export interface ObjectImageResolverService extends Service {
  resolve(options: ResolveObjectImageOptions): Promise<ResolvedObjectImage>;
}
