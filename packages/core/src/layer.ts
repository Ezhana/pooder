import { Group } from "fabric";
declare module "fabric" {
    interface Group {
        data?: any;
    }
    interface GroupProps {
        data?: any;
    }
    interface SerializedGroupProps {
        data?: any;
    }
}
export { Group as PooderLayer }