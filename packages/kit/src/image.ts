import {Command, Editor, EditorState, Extension, Image, OptionSchema, PooderLayer} from '@pooder/core';

interface ImageToolOptions {
    url: string;
    opacity: number;
}
export class ImageTool implements Extension<ImageToolOptions> {
    name = 'ImageTool';
    options: ImageToolOptions = {
        url: '',
        opacity: 1
    };

    public schema: Record<keyof ImageToolOptions, OptionSchema> = {
        url: {
            type: 'string',
            label: 'Image URL'
        },
        opacity: {
            type: 'number',
            min: 0,
            max: 1,
            step: 0.1,
            label: 'Opacity'
        }
    };

    onMount(editor: Editor) {
        this.ensureLayer(editor);
        this.updateImage(editor, this.options);
    }

    onUnmount(editor: Editor) {
        const layer = editor.getLayer("user");
        if (layer) {
            const userImage = editor.getObject("user-image", "user");
            if (userImage) {
                layer.remove(userImage);
                editor.canvas.requestRenderAll();
            }
        }
    }

    onUpdate(editor: Editor, state: EditorState) {
        this.updateImage(editor, this.options);
    }

    private ensureLayer(editor: Editor) {
        let userLayer = editor.getLayer("user")
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
            editor.canvas.add(userLayer)
        }
    }

    private updateImage(editor: Editor, opts: ImageToolOptions) {
        let { url, opacity } = opts;

        const layer = editor.getLayer("user");
        if (!layer) {
            console.warn('[ImageTool] User layer not found');
            return;
        }

        const userImage = editor.getObject("user-image","user") as any;

        if (userImage) {
            const currentSrc = userImage.getSrc?.() || userImage._element?.src;

            if (currentSrc !== url) {
                 this.loadImage(editor, layer, url, opacity, userImage);
            } else {
                if (userImage.opacity !== opacity) {
                    userImage.set({ opacity });
                    editor.canvas.requestRenderAll();
                }
            }
        } else {
            this.loadImage(editor, layer, url, opacity);
        }
    }

    private loadImage(editor: Editor, layer: PooderLayer, url: string, opacity: number, oldImage?: any) {
        Image.fromURL(url).then(image => {
            if (oldImage) {
                 const { left, top, scaleX, scaleY, angle } = oldImage;
                 image.set({ left, top, scaleX, scaleY, angle });
                 layer.remove(oldImage);
            }

            image.set({
                opacity,
                data: {
                    id: 'user-image'
                }
            });
            layer.add(image);
            editor.canvas.requestRenderAll();
        }).catch(err => {
            console.error("Failed to load image", url, err);
        });
    }

    commands:Record<string, Command>={
        setUserImage:{
            execute:(editor: Editor, url: string, opacity: number)=>{
                if (this.options.url === url && this.options.opacity === opacity) return true;
                
                this.options.url = url;
                this.options.opacity = opacity;
                
                // Direct update
                this.updateImage(editor, this.options);
                
                return true
            },
            schema: {
                url: {
                    type: 'string',
                    label: 'Image URL',
                    required: true
                },
                opacity: {
                    type: 'number',
                    label: 'Opacity',
                    min: 0,
                    max: 1,
                    required: true
                }
            }
        }
    }
}
