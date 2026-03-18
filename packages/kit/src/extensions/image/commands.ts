import type { CommandContribution } from "@pooder/core";
import type { ImageOperation } from "./imageOperations";

export function createImageCommands(tool: any): CommandContribution[] {
  return [
    {
      command: "addImage",
      id: "addImage",
      title: "Add Image",
      handler: async (url: string, options?: Record<string, any>) => {
        const result = await tool.upsertImageEntry(url, {
          mode: "add",
          addOptions: options,
        });
        return result.id;
      },
    },
    {
      command: "upsertImage",
      id: "upsertImage",
      title: "Upsert Image",
      handler: async (url: string, options: Record<string, any> = {}) => {
        return await tool.upsertImageEntry(url, options);
      },
    },
    {
      command: "applyImageOperation",
      id: "applyImageOperation",
      title: "Apply Image Operation",
      handler: async (
        id: string,
        operation: ImageOperation,
        options: Record<string, any> = {},
      ) => {
        await tool.applyImageOperation(id, operation, options);
      },
    },
    {
      command: "getWorkingImages",
      id: "getWorkingImages",
      title: "Get Working Images",
      handler: () => {
        return tool.cloneItems(tool.workingItems);
      },
    },
    {
      command: "setWorkingImage",
      id: "setWorkingImage",
      title: "Set Working Image",
      handler: (id: string, updates: Record<string, any>) => {
        tool.updateImageInWorking(id, updates);
      },
    },
    {
      command: "resetWorkingImages",
      id: "resetWorkingImages",
      title: "Reset Working Images",
      handler: () => {
        tool.workingItems = tool.cloneItems(tool.items);
        tool.hasWorkingChanges = false;
        tool.updateImages();
        tool.emitWorkingChange();
      },
    },
    {
      command: "completeImages",
      id: "completeImages",
      title: "Complete Images",
      handler: async () => {
        return await tool.commitWorkingImagesAsCropped();
      },
    },
    {
      command: "exportUserCroppedImage",
      id: "exportUserCroppedImage",
      title: "Export User Cropped Image",
      handler: async (options: Record<string, any> = {}) => {
        return await tool.exportUserCroppedImage(options);
      },
    },
    {
      command: "focusImage",
      id: "focusImage",
      title: "Focus Image",
      handler: (
        id: string | null,
        options: { syncCanvasSelection?: boolean } = {},
      ) => {
        return tool.setImageFocus(id, options);
      },
    },
    {
      command: "removeImage",
      id: "removeImage",
      title: "Remove Image",
      handler: (id: string) => {
        const removed = tool.items.find((item: any) => item.id === id);
        const next = tool.items.filter((item: any) => item.id !== id);
        if (next.length !== tool.items.length) {
          tool.purgeSourceSizeCacheForItem(removed);
          if (tool.focusedImageId === id) {
            tool.setImageFocus(null, {
              syncCanvasSelection: true,
              skipRender: true,
            });
          }
          tool.updateConfig(next);
        }
      },
    },
    {
      command: "updateImage",
      id: "updateImage",
      title: "Update Image",
      handler: async (
        id: string,
        updates: Record<string, any>,
        options: Record<string, any> = {},
      ) => {
        await tool.updateImage(id, updates, options);
      },
    },
    {
      command: "clearImages",
      id: "clearImages",
      title: "Clear Images",
      handler: () => {
        tool.sourceSizeCache.clear();
        tool.setImageFocus(null, {
          syncCanvasSelection: true,
          skipRender: true,
        });
        tool.updateConfig([]);
      },
    },
    {
      command: "bringToFront",
      id: "bringToFront",
      title: "Bring Image to Front",
      handler: (id: string) => {
        const index = tool.items.findIndex((item: any) => item.id === id);
        if (index !== -1 && index < tool.items.length - 1) {
          const next = [...tool.items];
          const [item] = next.splice(index, 1);
          next.push(item);
          tool.updateConfig(next);
        }
      },
    },
    {
      command: "sendToBack",
      id: "sendToBack",
      title: "Send Image to Back",
      handler: (id: string) => {
        const index = tool.items.findIndex((item: any) => item.id === id);
        if (index > 0) {
          const next = [...tool.items];
          const [item] = next.splice(index, 1);
          next.unshift(item);
          tool.updateConfig(next);
        }
      },
    },
  ];
}
