import {Command, Editor, EditorState, Extension, Image, OptionSchema, PooderLayer, Rect} from '@pooder/core';

interface BackgroundToolOptions {
    color: string;
    url: string;
}
export class BackgroundTool implements Extension<BackgroundToolOptions> {
    public name = 'BackgroundTool';
    public options: BackgroundToolOptions = {
        color: '',
        url: ''
    };
    public schema: Record<keyof BackgroundToolOptions, OptionSchema> = {
        color: {
            type: 'color',
            label: 'Background Color'
        },
        url: {
            type: 'string',
            label: 'Image URL'
        }
    };

    private initLayer(editor: Editor) {
        let backgroundLayer=editor.getLayer('background')
        if(!backgroundLayer){
            backgroundLayer=new PooderLayer([], {
                width: editor.canvas.width,
                height: editor.canvas.height,
                selectable: false,
                evented: false,
                data: {
                    id: 'background'
                },
            })

            editor.canvas.add(backgroundLayer)
            editor.canvas.sendObjectToBack(backgroundLayer)
        }
    }
    onMount(editor: Editor) {
        this.initLayer(editor);
        this.updateBackground(editor, this.options);
    }

    onUnmount(editor: Editor) {
        const layer = editor.getLayer('background');
        if (layer) {
            editor.canvas.remove(layer);
        }
    }

    onUpdate(editor: Editor, state: EditorState) {
        this.updateBackground(editor, this.options);
    }

    private async updateBackground(editor: Editor,options: BackgroundToolOptions) {
        const layer = editor.getLayer('background');
        if (!layer) {
            console.warn('[BackgroundTool] Background layer not found');
            return;
        }

        const { color, url } = options;
        const width = editor.state.width;
        const height = editor.state.height;

        let rect=editor.getObject('background-color-rect',"background")
        if (rect) {
            rect.set({
                fill: color
            })
        } else {
            rect = new Rect({
                width,
                height,
                fill: color,
                selectable: false,
                evented: false,
                data: {
                    id: 'background-color-rect'
                }
            });
            layer.add(rect);
            layer.sendObjectToBack(rect);
        }

        let img=editor.getObject('background-image',"background") as Image;
        try {
            if(img){
                if(img.getSrc() !== url){
                    if(url){
                        await img.setSrc(url);
                    }else {
                        layer.remove(img)
                    }
                }
            }else {
                if (url) {
                    img = await Image.fromURL(url, { crossOrigin: 'anonymous' });
                    img.set({
                        originX: 'left',
                        originY: 'top',
                        left: 0,
                        top: 0,
                        selectable: false,
                        evented: false,
                        data:{
                            id: 'background-image'
                        }
                    })
                    img.scaleToWidth(width)
                    if (img.getScaledHeight() < height)
                        img.scaleToHeight(height);
                    layer.add(img);
                }
            }
            editor.canvas.requestRenderAll();
        } catch (e) {
            console.error('[BackgroundTool] Failed to load image', e);
        }
    }

    commands: Record<string, Command> = {
        reset: {
            execute: (editor: Editor) => {
                this.updateBackground(editor, this.options);
                return true;
            }
        },
        clear: {
            execute: (editor: Editor) => {
                this.options = {
                    color: 'transparent',
                    url: ''
                };
                this.updateBackground(editor, this.options);
                return true;
            }
        },
        setBackgroundColor: {
             execute: (editor: Editor, color: string) => {
                 if (this.options.color === color) return true;
                 this.options.color = color;
                 this.updateBackground(editor, this.options);
                 return true;
             },
             schema: {
                 color: {
                     type: 'string', // Should be 'color' if supported by CommandArgSchema, but using 'string' for now as per previous plan
                     label: 'Background Color',
                     required: true
                 }
             }
        },
        setBackgroundImage: {
             execute: (editor: Editor, url: string) => {
                 if (this.options.url === url) return true;
                 this.options.url = url;
                 this.updateBackground(editor, this.options);
                 return true;
             },
             schema: {
                 url: {
                     type: 'string',
                     label: 'Image URL',
                     required: true
                 }
             }
        }
    };
}
