import { Command, Editor, Extension, OptionSchema } from "@pooder/core";

export interface MirrorToolOptions {
  enabled: boolean;
}

export class MirrorTool implements Extension<MirrorToolOptions> {
  public name = "MirrorTool";
  public options: MirrorToolOptions = {
    enabled: false,
  };

  public schema: Record<keyof MirrorToolOptions, OptionSchema> = {
    enabled: {
      type: "boolean",
      label: "Mirror View",
    },
  };

  onMount(editor: Editor) {
    if (this.options.enabled) {
      this.applyMirror(editor, true);
    }
  }

  onUpdate(editor: Editor) {
    this.applyMirror(editor, this.options.enabled);
  }

  onUnmount(editor: Editor) {
    // Force disable on unmount to restore view
    this.applyMirror(editor, false);
  }

  private applyMirror(editor: Editor, enabled: boolean) {
    const canvas = editor.canvas;
    if (!canvas) return;

    const width = canvas.width || 800;

    // Fabric.js v6+ uses viewportTransform property
    let vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    // Create a copy to avoid mutating the reference directly before setting
    vpt = [...vpt];

    // If we are enabling and currently not flipped (scaleX > 0)
    // Or disabling and currently flipped (scaleX < 0)
    const isFlipped = vpt[0] < 0;

    if (enabled && !isFlipped) {
      // Flip scale X
      vpt[0] = -vpt[0]; // Flip scale
      vpt[4] = width - vpt[4]; // Adjust pan X

      canvas.setViewportTransform(vpt as any);
      canvas.requestRenderAll();
    } else if (!enabled && isFlipped) {
      // Restore
      vpt[0] = -vpt[0]; // Unflip scale
      vpt[4] = width - vpt[4]; // Restore pan X

      canvas.setViewportTransform(vpt as any);
      canvas.requestRenderAll();
    }
  }

  commands: Record<string, Command> = {
    toggleMirror: {
      execute: (editor: Editor) => {
        this.options.enabled = !this.options.enabled;
        this.applyMirror(editor, this.options.enabled);
        return true;
      },
    },
    setMirror: {
      execute: (editor: Editor, enabled: boolean) => {
        if (this.options.enabled === enabled) return true;
        this.options.enabled = enabled;
        this.applyMirror(editor, enabled);
        return true;
      },
      schema: {
        enabled: {
          type: "boolean",
          label: "Enabled",
          required: true,
        },
      },
    },
  };
}
