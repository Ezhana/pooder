import {Command, Editor, EditorState, Extension, Image, OptionSchema, PooderLayer} from '@pooder/core';

interface ImageToolOptions {
    url: string;
    opacity: number;
    width?: number;
    height?: number;
    angle?: number;
    left?: number;
    top?: number;
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
        },
        width: {
            type: 'number',
            label: 'Width',
            min: 0,
            max: 5000,
        },
        height: {
            type: 'number',
            label: 'Height',
            min: 0,
            max: 5000,
        },
        angle: {
            type: 'number',
            label: 'Rotation',
            min: 0,
            max: 360
        },
        left: {
            type: 'number',
            label: 'Left',
            min: 0,
            max: 1000,
        },
        top: {
            type: 'number',
            label: 'Top',
            min: 0,
            max: 1000,
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
        let { url, opacity, width, height, angle, left, top } = opts;

        const layer = editor.getLayer("user");
        if (!layer) {
            console.warn('[ImageTool] User layer not found');
            return;
        }

        const userImage = editor.getObject("user-image","user") as any;

        if (userImage) {
            const currentSrc = userImage.getSrc?.() || userImage._element?.src;

            if (currentSrc !== url) {
                 this.loadImage(editor, layer, opts, userImage);
            } else {
                const updates: any = {};
                if (userImage.opacity !== opacity) updates.opacity = opacity;
                if (angle !== undefined && userImage.angle !== angle) updates.angle = angle;
                if (left !== undefined && userImage.left !== left) updates.left = left;
                if (top !== undefined && userImage.top !== top) updates.top = top;
                
                if (width !== undefined && userImage.width) updates.scaleX = width / userImage.width;
                if (height !== undefined && userImage.height) updates.scaleY = height / userImage.height;

                if (Object.keys(updates).length > 0) {
                    userImage.set(updates);
                    editor.canvas.requestRenderAll();
                }
            }
        } else {
            this.loadImage(editor, layer, opts);
        }
    }

    private loadImage(editor: Editor, layer: PooderLayer, opts: ImageToolOptions, oldImage?: any) {
        const { url, opacity, width, height, angle, left, top } = opts;
        Image.fromURL(url).then(image => {
            if (oldImage) {
                 const defaultLeft = oldImage.left;
                 const defaultTop = oldImage.top;
                 const defaultAngle = oldImage.angle;
                 const defaultScaleX = oldImage.scaleX;
                 const defaultScaleY = oldImage.scaleY;
                 
                 image.set({
                     left: left !== undefined ? left : defaultLeft,
                     top: top !== undefined ? top : defaultTop,
                     angle: angle !== undefined ? angle : defaultAngle,
                     scaleX: (width !== undefined && image.width) ? width / image.width : defaultScaleX,
                     scaleY: (height !== undefined && image.height) ? height / image.height : defaultScaleY,
                 });
                 
                 layer.remove(oldImage);
            } else {
                 if (width !== undefined && image.width) image.scaleX = width / image.width;
                 if (height !== undefined && image.height) image.scaleY = height / image.height;
                 if (angle !== undefined) image.angle = angle;
                 if (left !== undefined) image.left = left;
                 if (top !== undefined) image.top = top;
            }

            image.set({
                opacity,
                data: {
                    id: 'user-image'
                }
            });
            layer.add(image);
            
            // Bind events to keep options in sync
            image.on('modified', (e) => {
                this.options.left = e.target.oCoords.tl.x
                this.options.top = e.target.oCoords.tl.y;
                this.options.angle = e.target.angle;

                if (image.width) this.options.width = e.target.width * e.target.scaleX;
                if (image.height) this.options.height = e.target.height * e.target.scaleY;

                editor.emit('update');
            });
            
            editor.canvas.requestRenderAll();
        }).catch(err => {
            console.error("Failed to load image", url, err);
        });
    }

    commands:Record<string, Command>={
        setUserImage:{
            execute:(editor: Editor, url: string, opacity: number, width?: number, height?: number, angle?: number, left?: number, top?: number)=>{
                if (this.options.url === url && 
                    this.options.opacity === opacity &&
                    this.options.width === width &&
                    this.options.height === height &&
                    this.options.angle === angle &&
                    this.options.left === left &&
                    this.options.top === top
                   ) return true;
                
                this.options = { url, opacity, width, height, angle, left, top };
                
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
                },
                width: { type: 'number', label: 'Width' },
                height: { type: 'number', label: 'Height' },
                angle: { type: 'number', label: 'Angle' },
                left: { type: 'number', label: 'Left' },
                top: { type: 'number', label: 'Top' }
            }
        }
    }
}
