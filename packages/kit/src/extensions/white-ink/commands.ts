import type { CommandContribution } from "@pooder/core";

const WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY = "whiteInk.previewImageVisible";
const WHITE_INK_DEFAULT_OPACITY = 0.85;

export function createWhiteInkCommands(tool: any): CommandContribution[] {
  return [
    {
      command: "addWhiteInk",
      id: "addWhiteInk",
      title: "Add White Ink",
      handler: async (url: string, options?: Record<string, any>) => {
        return await tool.addWhiteInkEntry(url, options);
      },
    },
    {
      command: "upsertWhiteInk",
      id: "upsertWhiteInk",
      title: "Upsert White Ink",
      handler: async (url: string, options: Record<string, any> = {}) => {
        return await tool.upsertWhiteInkEntry(url, options);
      },
    },
    {
      command: "getWhiteInks",
      id: "getWhiteInks",
      title: "Get White Inks",
      handler: () => tool.cloneItems(tool.items),
    },
    {
      command: "getWhiteInkSettings",
      id: "getWhiteInkSettings",
      title: "Get White Ink Settings",
      handler: () => {
        const first = tool.getEffectiveWhiteInkItem(tool.items);
        const primarySource = tool.getPrimaryImageSource();
        const sourceUrl = tool.resolveSourceUrl(first) || primarySource;

        return {
          id: first?.id || null,
          url: sourceUrl,
          sourceUrl,
          opacity: WHITE_INK_DEFAULT_OPACITY,
          printWithWhiteInk: tool.printWithWhiteInk,
          previewImageVisible: tool.previewImageVisible,
        };
      },
    },
    {
      command: "setWhiteInkPrintEnabled",
      id: "setWhiteInkPrintEnabled",
      title: "Set White Ink Preview Enabled",
      handler: (enabled: boolean) => {
        tool.printWithWhiteInk = !!enabled;
        const configService = tool.context?.services.get("ConfigurationService");
        configService?.update("whiteInk.printWithWhiteInk", tool.printWithWhiteInk);
        tool.updateWhiteInks();
        return { ok: true };
      },
    },
    {
      command: "setWhiteInkPreviewImageVisible",
      id: "setWhiteInkPreviewImageVisible",
      title: "Set White Ink Cover Visible",
      handler: (visible: boolean) => {
        tool.previewImageVisible = !!visible;
        const configService = tool.context?.services.get("ConfigurationService");
        configService?.update(
          WHITE_INK_PREVIEW_IMAGE_VISIBLE_KEY,
          tool.previewImageVisible,
        );
        tool.updateWhiteInks();
        return { ok: true };
      },
    },
    {
      command: "getWorkingWhiteInks",
      id: "getWorkingWhiteInks",
      title: "Get Working White Inks",
      handler: () => tool.cloneItems(tool.workingItems),
    },
    {
      command: "setWorkingWhiteInk",
      id: "setWorkingWhiteInk",
      title: "Set Working White Ink",
      handler: (id: string, updates: Record<string, any>) => {
        tool.updateWhiteInkInWorking(id, updates);
      },
    },
    {
      command: "updateWhiteInk",
      id: "updateWhiteInk",
      title: "Update White Ink",
      handler: async (
        id: string,
        updates: Record<string, any>,
        options: Record<string, any> = {},
      ) => {
        await tool.updateWhiteInkItem(id, updates, options);
      },
    },
    {
      command: "removeWhiteInk",
      id: "removeWhiteInk",
      title: "Remove White Ink",
      handler: (id: string) => {
        tool.removeWhiteInk(id);
      },
    },
    {
      command: "clearWhiteInks",
      id: "clearWhiteInks",
      title: "Clear White Inks",
      handler: () => {
        tool.clearWhiteInks();
      },
    },
    {
      command: "resetWorkingWhiteInks",
      id: "resetWorkingWhiteInks",
      title: "Reset Working White Inks",
      handler: () => {
        tool.workingItems = tool.cloneItems(tool.items);
        tool.hasWorkingChanges = false;
        tool.updateWhiteInks();
      },
    },
    {
      command: "completeWhiteInks",
      id: "completeWhiteInks",
      title: "Complete White Inks",
      handler: async () => {
        return await tool.completeWhiteInks();
      },
    },
    {
      command: "setWhiteInkImage",
      id: "setWhiteInkImage",
      title: "Set White Ink Image",
      handler: async (url: string) => {
        if (!url) {
          tool.clearWhiteInks();
          return { ok: true };
        }

        const targetId = tool.resolveReplaceTargetId(null);
        const upsertResult = await tool.upsertWhiteInkEntry(url, {
          id: targetId || undefined,
          mode: targetId ? "replace" : "add",
          createIfMissing: true,
          addOptions: {},
        });
        return { ok: true, id: upsertResult.id };
      },
    },
  ];
}
