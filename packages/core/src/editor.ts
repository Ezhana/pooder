import {Command, Editor, EditorState, EventHandler, Extension} from "./types";
import {EventBus} from "./event";
import {CommandManager, CommandMap, DefaultCommandManager} from "./command";
import {DefaultExtensionManager, ExtensionManager, ExtensionMap} from "./extension";
import {PooderCanvas} from "./canvas";
import {PooderObject} from "./obj";
import {PooderLayer} from "./layer";

export class PooderEditor implements Editor {
    public state: EditorState;
    public canvas: PooderCanvas;
    public extensions: ExtensionMap = new Map()
    public commands: CommandMap = new Map()

    private eventBus: EventBus;
    private commandManager: CommandManager;
    private extensionManager: ExtensionManager;

    private destroyed: boolean = false;

    constructor(el:HTMLCanvasElement, options:{
        width?: number,
        height?: number,
        extensions?: Extension[],
    }={}) {
        this.state = {
            width: options.width || 800,
            height: options.height || 600,
        };
        this.canvas = new PooderCanvas(el, {
            width: this.state.width, 
            height: this.state.height,
            preserveObjectStacking: true
        });
        this.eventBus=new EventBus()
        this.commandManager = new DefaultCommandManager(this);

        this.extensionManager = new DefaultExtensionManager(this);
        if(options.extensions && options.extensions.length>0){
            options.extensions.forEach(this.extensionManager.register)
        }
        this.extensionManager.mount();

        console.log('Editor initialized with', this.extensionManager.count(), 'plugins');
    }

    use(extension: Extension){
        if(this.destroyed){
            throw new Error('Cannot register plugin: Editor is destroyed');
        }

        this.extensionManager.register(extension)

        this.emit('update', this.state);
    }
    unuse(name: string) {
        return this.extensionManager.unregister(name)
    }
    getExtension(name: string): Extension | undefined {
        return this.extensionManager.get(name)
    }
    getExtensions():Extension[]{
        return this.extensionManager.list()
    }
    enableExtension(name: string) {
        this.extensionManager.enable(name);
        this.emit('update', this.state);
    }
    disableExtension(name: string) {
        this.extensionManager.disable(name);
        this.emit('update', this.state);
    }

    registerCommand(name: string, command: Command) {
        this.commandManager.register(name, command)
    }
    unregisterCommand(name: string) {
        this.commandManager.unregister(name)
    }
    executeCommand(name: string, ...args:any[]) {
        if(this.destroyed){
            console.warn('Cannot execute command: Editor is destroyed');
            return false;
        }

        this.emit('beforeCommand', name, ...args)

        const result = this.commandManager.execute(name, ...args)

        this.emit('afterCommand', name, args,result)

        return result
    }


    on(event:string, handler:EventHandler,priority?:number):void{
        this.eventBus.on(event, handler, priority)
    }
    off(event:string, handler:EventHandler):void{
        this.eventBus.off(event, handler)
    }
    emit(event:string, ...args:any[]):void{
        this.eventBus.emit(event, ...args)
    }

    getObjects():PooderObject[] {
        if(this.destroyed){
            throw new Error('Cannot get objects: Editor is destroyed');
        }

        return this.canvas.getObjects()
    }
    getObject(id:string,layerId?:string):PooderObject | undefined {
        let objs;
        if(layerId){
            objs=this.getLayer(layerId)?.getObjects()
        }else {
            objs=this.getObjects()
        }
        return objs?.find(obj => obj?.data?.id === id)
    }
    getLayers():PooderLayer[] {
        return this.getObjects().filter(obj => obj.type==="group") as PooderLayer[]
    }
    getLayer(id:string):PooderLayer | undefined {
        return this.getLayers().find(obj => obj?.data?.id === id)
    }

    updateState(updater:(state:EditorState)=>EditorState) {
        if(this.destroyed){
            console.warn('Cannot update state: Editor is destroyed');
            return;
        }

        this.state = updater(this.state)

        this.extensionManager.update()
        this.emit('update', this.state)
    }

    toJSON() {
        const extensions: Record<string, any> = {};
        this.extensionManager.list().forEach(ext => {
            if (ext.toJSON) {
                extensions[ext.name] = ext.toJSON();
            } else if (ext.options) {
                extensions[ext.name] = ext.options;
            }
        });

        return {
            width: this.state.width,
            height: this.state.height,
            metadata: this.state.metadata,
            extensions
        }
    }

    async loadFromJSON(json: any) {
        if (!json) return;

        this.extensionManager.unmount();

        this.canvas.clear();

        this.extensionManager.mount();

        if (json.extensions) {
            for (const [name, data] of Object.entries(json.extensions)) {
                const ext = this.extensionManager.get(name);
                if (ext) {
                    if (ext.loadFromJSON) {
                        await ext.loadFromJSON(data);
                    } else if (data) {
                        // Fallback: restore options if loadFromJSON is missing
                        ext.options = data;
                    }
                }
            }
        }
    }
    getState(): EditorState {
        return { ...this.state }
    }

    destroy():void{
        if(this.destroyed)return

        this.emit('beforeDestroy')

        this.canvas.dispose()

        this.extensionManager.destroy()

        this.eventBus.clear()

        this.commandManager.clear()

        this.destroyed=true

        console.log('Editor destroyed');
    }

    isDestroyed():boolean{
        return this.destroyed
    }
}
