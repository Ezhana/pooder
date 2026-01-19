import { Command, Editor, EditorState, Extension } from "@pooder/core";

export class MirrorTool implements Extension {
  public name = "MirrorTool";
  enabled = false;

  toJSON() {
    return {
      enabled: this.enabled,
    };
  }

  loadFromJSON(json: any) {
    this.enabled = json.enabled;
  }

  onEnable(editor: Editor) {
    this.applyMirror(editor, true);
  }

  onDisable(editor: Editor) {
    this.applyMirror(editor, false);
  }

  onUpdate(editor: Editor, state: EditorState) {
    this.applyMirror(editor, this.enabled);
  }

  onUnmount(editor: Editor) {
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
    setMirror: {
      execute: (editor: Editor, enabled: boolean) => {
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
