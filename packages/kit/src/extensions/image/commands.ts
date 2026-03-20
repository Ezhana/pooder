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
      command: "getImageViewState",
      id: "getImageViewState",
      title: "Get Image View State",
      handler: () => {
        return tool.getImageViewState();
      },
    },
    {
      command: "setImageTransform",
      id: "setImageTransform",
      title: "Set Image Transform",
      handler: async (
        id: string,
        updates: Record<string, any>,
        options: Record<string, any> = {},
      ) => {
        await tool.setImageTransform(id, updates, options);
      },
    },
    {
      command: "imageSessionReset",
      id: "imageSessionReset",
      title: "Reset Image Session",
      handler: () => {
        tool.resetImageSession();
      },
    },
    {
      command: "validateImageSession",
      id: "validateImageSession",
      title: "Validate Image Session",
      handler: async () => {
        return await tool.validateImageSession();
      },
    },
    {
      command: "completeImages",
      id: "completeImages",
      title: "Complete Images",
      handler: async () => {
        return await tool.completeImageSession();
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
        const sourceItems = tool.isToolActive ? tool.workingItems : tool.items;
        const removed = sourceItems.find((item: any) => item.id === id);
        const next = sourceItems.filter((item: any) => item.id !== id);
        if (next.length !== sourceItems.length) {
          tool.purgeSourceSizeCacheForItem(removed);
          if (tool.focusedImageId === id) {
            tool.setImageFocus(null, {
              syncCanvasSelection: true,
              skipRender: true,
            });
          }
          if (tool.isToolActive) {
            tool.workingItems = tool.cloneItems(next);
            tool.hasWorkingChanges = true;
            tool.updateImages();
            tool.emitWorkingChange(id);
            return;
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
        if (tool.isToolActive) {
          tool.workingItems = [];
          tool.hasWorkingChanges = true;
          tool.updateImages();
          tool.emitWorkingChange();
          return;
        }
        tool.updateConfig([]);
      },
    },
    {
      command: "bringToFront",
      id: "bringToFront",
      title: "Bring Image to Front",
      handler: (id: string) => {
        const sourceItems = tool.isToolActive ? tool.workingItems : tool.items;
        const index = sourceItems.findIndex((item: any) => item.id === id);
        if (index !== -1 && index < sourceItems.length - 1) {
          const next = [...sourceItems];
          const [item] = next.splice(index, 1);
          next.push(item);
          if (tool.isToolActive) {
            tool.workingItems = tool.cloneItems(next);
            tool.hasWorkingChanges = true;
            tool.updateImages();
            tool.emitWorkingChange(id);
            return;
          }
          tool.updateConfig(next);
        }
      },
    },
    {
      command: "sendToBack",
      id: "sendToBack",
      title: "Send Image to Back",
      handler: (id: string) => {
        const sourceItems = tool.isToolActive ? tool.workingItems : tool.items;
        const index = sourceItems.findIndex((item: any) => item.id === id);
        if (index > 0) {
          const next = [...sourceItems];
          const [item] = next.splice(index, 1);
          next.unshift(item);
          if (tool.isToolActive) {
            tool.workingItems = tool.cloneItems(next);
            tool.hasWorkingChanges = true;
            tool.updateImages();
            tool.emitWorkingChange(id);
            return;
          }
          tool.updateConfig(next);
        }
      },
    },
  ];
}
