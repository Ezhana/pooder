import { FabricObject } from "fabric";
declare module "fabric" {
  interface FabricObject {
    data?: any;
  }
}
export { FabricObject as PooderObject };
