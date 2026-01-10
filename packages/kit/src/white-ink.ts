import {
    Command,
    Editor,
    EditorState,
    EventHandler,
    Extension,
    OptionSchema,
    Image,
    filters,
    PooderObject,
    PooderLayer
} from '@pooder/core';

interface WhiteInkToolOptions {
    customMask: string;
    opacity: number;
    enableClip: boolean;
}
export class WhiteInkTool implements Extension<WhiteInkToolOptions> {
    public name = 'WhiteInkTool';
    public options: WhiteInkToolOptions = {
        customMask: '',
        opacity: 1,
        enableClip: false
    };

    public schema: Record<keyof WhiteInkToolOptions, OptionSchema> = {
        customMask: { type: 'string', label: 'Custom Mask URL' },
        opacity: { type: 'number', min: 0, max: 1, step: 0.01, label: 'Opacity' },
        enableClip: { type: 'boolean', label: 'Enable Clip' }
    };

    private syncHandler: EventHandler | undefined;

    onMount(editor: Editor) {
        this.setup(editor);
        this.updateWhiteInk(editor, this.options);
    }

    onUnmount(editor: Editor) {
        this.teardown(editor);
    }

    onDestroy(editor: Editor) {
        this.teardown(editor);
    }

    private setup(editor: Editor) {
        let userLayer = editor.getLayer("user");
        if (!userLayer) {
            userLayer = new PooderLayer([], {
                width: editor.state.width,
                height: editor.state.height,
                left: 0,
                top: 0,
                originX: 'left',
                originY: 'top',
                selectable: false,
                evented: true,
                subTargetCheck: true,
                interactive: true,
                data: {
                    id: 'user'
                }
            });
            editor.canvas.add(userLayer);
        }

        if (!this.syncHandler) {
            this.syncHandler = (e: any) => {
                const target = e.target;
                if (target && target.data?.id === 'user-image') {
                    this.syncWithUserImage(editor);
                }
            };

            editor.canvas.on('object:moving', this.syncHandler);
            editor.canvas.on('object:scaling', this.syncHandler);
            editor.canvas.on('object:rotating', this.syncHandler);
            editor.canvas.on('object:modified', this.syncHandler);
        }
    }

    private teardown(editor: Editor) {
        if (this.syncHandler) {
            editor.canvas.off('object:moving', this.syncHandler);
            editor.canvas.off('object:scaling', this.syncHandler);
            editor.canvas.off('object:rotating', this.syncHandler);
            editor.canvas.off('object:modified', this.syncHandler);
            this.syncHandler = undefined;
        }

        const layer = editor.getLayer("user");
        if (layer) {
            const whiteInk = editor.getObject("white-ink", "user");
            if (whiteInk) {
                layer.remove(whiteInk);
            }
        }

        const userImage = editor.getObject("user-image", "user") as any;
        if (userImage && userImage.clipPath) {
            userImage.set({ clipPath: undefined });
        }
        
        editor.canvas.requestRenderAll();
    }

    onUpdate(editor: Editor, state: EditorState) {
        this.updateWhiteInk(editor, this.options);
    }

    commands: Record<string, Command> = {
        setWhiteInkImage: {
            execute: (editor: Editor, customMask: string, opacity: number, enableClip: boolean = true) => {
                if (this.options.customMask === customMask && 
                    this.options.opacity === opacity && 
                    this.options.enableClip === enableClip) return true;

                this.options.customMask = customMask;
                this.options.opacity = opacity;
                this.options.enableClip = enableClip;

                this.updateWhiteInk(editor, this.options);

                return true;
            },
            schema: {
                customMask: {
                    type: 'string',
                    label: 'Custom Mask URL',
                    required: true
                },
                opacity: {
                    type: 'number',
                    label: 'Opacity',
                    min: 0,
                    max: 1,
                    required: true
                },
                enableClip: {
                    type: 'boolean',
                    label: 'Enable Clip',
                    default: true,
                    required: false
                }
            }
        }
    };

    private updateWhiteInk(editor: Editor, opts: WhiteInkToolOptions) {
        const { customMask, opacity, enableClip } = opts;

        const layer = editor.getLayer("user");
        if (!layer) {
            console.warn('[WhiteInkTool] User layer not found');
            return;
        }

        const whiteInk = editor.getObject("white-ink", "user") as any;
        const userImage = editor.getObject("user-image", "user") as any;

        if (!customMask) {
            if (whiteInk) {
                layer.remove(whiteInk);
            }
            if (userImage && userImage.clipPath) {
                userImage.set({ clipPath: undefined });
            }
            editor.canvas.requestRenderAll();
            return;
        }

        // Check if we need to load/reload white ink backing
        if (whiteInk) {
            const currentSrc = whiteInk.getSrc?.() || whiteInk._element?.src;
            if (currentSrc !== customMask) {
                this.loadWhiteInk(editor, layer, customMask, opacity, enableClip, whiteInk);
            } else {
                if (whiteInk.opacity !== opacity) {
                    whiteInk.set({ opacity });
                    editor.canvas.requestRenderAll();
                }
            }
        } else {
            this.loadWhiteInk(editor, layer, customMask, opacity, enableClip);
        }

        // Handle Clip Path Toggle
        if (userImage) {
            if (enableClip) {
                // If enabled but missing, or mask changed (handled by re-load above, but good to ensure), apply it
                // We check if clipPath is present. Ideally we should check if it matches current mask, 
                // but re-applying is safe.
                if (!userImage.clipPath) {
                    this.applyClipPath(editor, customMask);
                }
            } else {
                // If disabled but present, remove it
                if (userImage.clipPath) {
                    userImage.set({ clipPath: undefined });
                    editor.canvas.requestRenderAll();
                }
            }
        }
    }

    private loadWhiteInk(editor: Editor, layer: PooderLayer, url: string, opacity: number, enableClip: boolean, oldImage?: any) {
        Image.fromURL(url, { crossOrigin: 'anonymous' }).then(image => {
            if (oldImage) {
                // Remove old image but don't copy properties yet, we'll sync with user-image
                layer.remove(oldImage);
            }

            image.filters?.push(new filters.BlendColor({
                color: '#FFFFFF',
                mode: 'add'
            }));
            image.applyFilters();

            image.set({
                opacity,
                selectable: false,
                evented: false,
                data: {
                    id: 'white-ink'
                }
            });
            
            // Add to layer
            layer.add(image);
            
            // Ensure white-ink is behind user-image
            const userImage = editor.getObject("user-image", "user");
            if (userImage) {
                 // Re-adding moves it to the top of the stack
                 layer.remove(userImage);
                 layer.add(userImage);
            }

            // Apply clip path to user-image if enabled
            if (enableClip) {
                this.applyClipPath(editor, url);
            } else if (userImage) {
                 userImage.set({ clipPath: undefined });
            }

            // Sync position immediately
            this.syncWithUserImage(editor);
            
            editor.canvas.requestRenderAll();
        }).catch(err => {
            console.error("Failed to load white ink mask", url, err);
        });
    }

    private applyClipPath(editor: Editor, url: string) {
        const userImage = editor.getObject("user-image", "user") as any;
        if (!userImage) return;

        Image.fromURL(url, { crossOrigin: 'anonymous' }).then(maskImage => {
            // Configure clipPath
            // It needs to be relative to the object center
            maskImage.set({
                originX: 'center',
                originY: 'center',
                left: 0,
                top: 0,
                // Scale to fit userImage if dimensions differ
                scaleX: userImage.width / maskImage.width,
                scaleY: userImage.height / maskImage.height
            });

            userImage.set({ clipPath: maskImage });
            editor.canvas.requestRenderAll();
        }).catch(err => {
            console.error("Failed to load clip path", url, err);
        });
    }

    private syncWithUserImage(editor: Editor) {
        const userImage = editor.getObject("user-image", "user");
        const whiteInk = editor.getObject("white-ink", "user");

        if (userImage && whiteInk) {
            whiteInk.set({
                left: userImage.left,
                top: userImage.top,
                scaleX: userImage.scaleX,
                scaleY: userImage.scaleY,
                angle: userImage.angle,
                skewX: userImage.skewX,
                skewY: userImage.skewY,
                flipX: userImage.flipX,
                flipY: userImage.flipY,
                originX: userImage.originX,
                originY: userImage.originY
            });
        }
    }
}
