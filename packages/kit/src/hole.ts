import { Command, Editor, EditorState, Extension, OptionSchema, Circle, Group, Point } from '@pooder/core';
import { DielineTool, DielineGeometry } from './dieline';
import { getNearestPointOnDieline } from './geometry';
import paper from 'paper';

export interface HoleToolOptions {
    innerRadius: number;
    outerRadius: number;
    style: 'solid' | 'dashed';
    holes?: Array<{ x: number, y: number }>;
    constraintTarget?: 'original' | 'bleed';
}

export class HoleTool implements Extension<HoleToolOptions> {
    public name = 'HoleTool';
    public options: HoleToolOptions = {
        innerRadius: 15,
        outerRadius: 25,
        style: 'solid',
        holes: [],
        constraintTarget: 'bleed'
    };

    public schema: Record<keyof HoleToolOptions, OptionSchema> = {
        innerRadius: {
            type: 'number',
            min: 1,
            max: 100,
            label: 'Inner Radius'
        },
        outerRadius: {
            type: 'number',
            min: 1,
            max: 100,
            label: 'Outer Radius'
        },
        style: {
            type: 'select',
            options: ['solid', 'dashed'],
            label: 'Line Style'
        },
        constraintTarget: {
            type: 'select',
            options: ['original', 'bleed'],
            label: 'Constraint Target'
        },
        holes: {
            type: 'json',
            label: 'Holes'
        } as any
    };

    private handleMoving: ((e: any) => void) | null = null;
    private handleModified: ((e: any) => void) | null = null;

    onMount(editor: Editor) {
        this.setup(editor);
    }

    onUnmount(editor: Editor) {
        this.teardown(editor);
    }

    onDestroy(editor: Editor) {
        this.teardown(editor);
    }

    private getDielineGeometry(editor: Editor): DielineGeometry | null {
        const dielineTool = editor.getExtension('DielineTool') as DielineTool;
        if (!dielineTool) return null;

        const geometry = dielineTool.getGeometry(editor);
        if (!geometry) return null;

        const offset = (this.options.constraintTarget === 'original') ? 0 : (dielineTool.options.offset || 0);

        // Apply offset to geometry
        return {
            ...geometry,
            width: Math.max(0, geometry.width + offset * 2),
            height: Math.max(0, geometry.height + offset * 2),
            radius: Math.max(0, geometry.radius + offset)
        };
    }

    public enforceConstraints(editor: Editor) {
        const geometry = this.getDielineGeometry(editor);
        if (!geometry) return;

        // Get all hole markers
        const objects = editor.canvas.getObjects().filter((obj: any) => obj.data?.type === 'hole-marker');
        
        let changed = false;
        // Sort objects by index to maintain order in options.holes
        objects.sort((a: any, b: any) => (a.data?.index ?? 0) - (b.data?.index ?? 0));
        
        const newHoles: {x: number, y: number}[] = [];

        objects.forEach((obj: any) => {
            const currentPos = new Point(obj.left, obj.top);
            const newPos = this.calculateConstrainedPosition(currentPos, geometry);
            
            if (currentPos.distanceFrom(newPos) > 0.1) {
                obj.set({
                    left: newPos.x,
                    top: newPos.y
                });
                obj.setCoords();
                changed = true;
            }
            newHoles.push({ x: obj.left, y: obj.top });
        });

        if (changed) {
            this.options.holes = newHoles;
            editor.canvas.requestRenderAll();
        }
    }

    private setup(editor: Editor) {
        if (!this.handleMoving) {
            this.handleMoving = (e: any) => {
                const target = e.target;
                if (!target || target.data?.type !== 'hole-marker') return;

                const geometry = this.getDielineGeometry(editor);
                if (!geometry) return;

                const p = new Point(target.left, target.top);
                const newPos = this.calculateConstrainedPosition(p, geometry);

                target.set({
                    left: newPos.x,
                    top: newPos.y
                });
            };
            editor.canvas.on('object:moving', this.handleMoving);
        }
        
        if (!this.handleModified) {
            this.handleModified = (e: any) => {
                 const target = e.target;
                 if (!target || target.data?.type !== 'hole-marker') return;
                 
                 // Update state when hole is moved
                 this.syncHolesFromCanvas(editor);
            };
            editor.canvas.on('object:modified', this.handleModified);
        }

        const opts = this.options;
        // Default hole if none exist
        if (!opts.holes || opts.holes.length === 0) {
             let defaultPos = { x: editor.canvas.width! / 2, y: 50 };
             
             const g = this.getDielineGeometry(editor);
             if (g) {
                 // Default to Top-Center of Dieline shape
                 const topCenter = { x: g.x, y: g.y - g.height / 2 };
                 // Snap to exact shape edge
                 const snapped = getNearestPointOnDieline(topCenter, { ...g, holes: [] } as any);
                 defaultPos = snapped;
             }
             
             opts.holes = [defaultPos];
        }
        
        this.options = { ...opts };
        this.redraw(editor);

        // Ensure Dieline updates to reflect current holes (fusion effect)
        const dielineTool = editor.getExtension('DielineTool') as DielineTool;
        if (dielineTool && dielineTool.updateDieline) {
            dielineTool.updateDieline(editor);
        }
    }

    private teardown(editor: Editor) {
        if (this.handleMoving) {
            editor.canvas.off('object:moving', this.handleMoving);
            this.handleMoving = null;
        }
        if (this.handleModified) {
            editor.canvas.off('object:modified', this.handleModified);
            this.handleModified = null;
        }
        
        const objects = editor.canvas.getObjects().filter((obj: any) => obj.data?.type === 'hole-marker');
        objects.forEach(obj => editor.canvas.remove(obj));
        
        editor.canvas.requestRenderAll();
    }

    onUpdate(editor: Editor, state: EditorState) {
        this.enforceConstraints(editor);
        this.redraw(editor);

        // Trigger Dieline update
        const dielineTool = editor.getExtension('DielineTool') as any;
        if (dielineTool && dielineTool.updateDieline) {
            dielineTool.updateDieline(editor);
        }
    }

    commands: Record<string, Command> = {
        reset: {
            execute: (editor: Editor) => {
                let defaultPos = { x: editor.canvas.width! / 2, y: 50 };
                
                const g = this.getDielineGeometry(editor);
                if (g) {
                    const topCenter = { x: g.x, y: g.y - g.height / 2 };
                    defaultPos = getNearestPointOnDieline(topCenter, { ...g, holes: [] } as any);
                }

                this.options = {
                    innerRadius: 15,
                    outerRadius: 25,
                    style: 'solid',
                    holes: [defaultPos]
                };
                this.redraw(editor);
                
                // Trigger Dieline update
                const dielineTool = editor.getExtension('DielineTool') as DielineTool;
                if (dielineTool && dielineTool.updateDieline) {
                    dielineTool.updateDieline(editor);
                }
                
                return true;
            }
        },
        addHole: {
            execute: (editor: Editor, x: number, y: number) => {
                if (!this.options.holes) this.options.holes = [];
                this.options.holes.push({ x, y });
                this.redraw(editor);
                
                // Trigger Dieline update
                const dielineTool = editor.getExtension('DielineTool') as any;
                if (dielineTool && dielineTool.updateDieline) {
                    dielineTool.updateDieline(editor);
                }
                
                return true;
            },
            schema: {
                x: {
                    type: 'number',
                    label: 'X Position',
                    required: true
                },
                y: {
                    type: 'number',
                    label: 'Y Position',
                    required: true
                }
            }
        },
        clearHoles: {
            execute: (editor: Editor) => {
                this.options.holes = [];
                this.redraw(editor);
                
                // Trigger Dieline update
                const dielineTool = editor.getExtension('DielineTool') as any;
                if (dielineTool && dielineTool.updateDieline) {
                    dielineTool.updateDieline(editor);
                }
                
                return true;
            }
        }
    };
    
    private syncHolesFromCanvas(editor: Editor) {
        const objects = editor.canvas.getObjects().filter((obj: any) => obj.data?.type === 'hole-marker');
        const holes = objects.map(obj => ({ x: obj.left!, y: obj.top! }));
        this.options.holes = holes;
        
        // Trigger Dieline update for real-time fusion effect
        const dielineTool = editor.getExtension('DielineTool') as any;
        if (dielineTool && dielineTool.updateDieline) {
            dielineTool.updateDieline(editor);
        }
    }

    private redraw(editor: Editor) {
        const canvas = editor.canvas;
        
        // Remove existing holes
        const existing = canvas.getObjects().filter((obj: any) => obj.data?.type === 'hole-marker');
        existing.forEach(obj => canvas.remove(obj));

        const { innerRadius, outerRadius, style, holes } = this.options;
        
        if (!holes || holes.length === 0) {
            canvas.requestRenderAll();
            return;
        }

        holes.forEach((hole, index) => {
            const innerCircle = new Circle({
                radius: innerRadius,
                fill: 'transparent',
                stroke: 'red',
                strokeWidth: 2,
                originX: 'center',
                originY: 'center'
            });

            const outerCircle = new Circle({
                radius: outerRadius,
                fill: 'transparent',
                stroke: '#666',
                strokeWidth: 1,
                strokeDashArray: style === 'dashed' ? [5, 5] : undefined,
                originX: 'center',
                originY: 'center'
            });

            const holeGroup = new Group([outerCircle, innerCircle], {
                left: hole.x,
                top: hole.y,
                originX: 'center',
                originY: 'center',
                selectable: true,
                hasControls: false, // Don't allow resizing/rotating
                hasBorders: false,
                subTargetCheck: false,
                opacity: 0, // Default hidden
                hoverCursor: 'move',
                data: { type: 'hole-marker', index } 
            }as any);
            (holeGroup as any).name = 'hole-marker';

            // Auto-show/hide logic
            holeGroup.on('mouseover', () => {
                holeGroup.set('opacity', 1);
                canvas.requestRenderAll();
            });
            holeGroup.on('mouseout', () => {
                if (canvas.getActiveObject() !== holeGroup) {
                    holeGroup.set('opacity', 0);
                    canvas.requestRenderAll();
                }
            });
            holeGroup.on('selected', () => {
                holeGroup.set('opacity', 1);
                canvas.requestRenderAll();
            });
            holeGroup.on('deselected', () => {
                holeGroup.set('opacity', 0);
                canvas.requestRenderAll();
            });

            canvas.add(holeGroup);
            canvas.bringObjectToFront(holeGroup);
        });
        
        canvas.requestRenderAll();
    }

    private calculateConstrainedPosition(p: Point, g: DielineGeometry): Point {
        // Use Paper.js to get accurate nearest point
        // This handles ellipses, rects, and rounded rects correctly
        
        // Convert to holes format for geometry options
        const options = {
            ...g,
            holes: [] // We don't need holes for boundary calculation
        };
        
        const nearest = getNearestPointOnDieline({x: p.x, y: p.y}, options as any);
        
        // Now constrain distance
        const nearestP = new Point(nearest.x, nearest.y);
        const dist = p.distanceFrom(nearestP);
        
        // Determine if point is inside or outside
        // Simple heuristic: distance from center
        // Or using paper.js contains() if we had the full path object
        // For convex shapes, center distance works mostly, but let's use the vector direction
        
        // Vector from nearest to current point
        const v = p.subtract(nearestP);
        
        // Vector from center to nearest point (approximate normal for convex shapes)
        const center = new Point(g.x, g.y);
        const centerToNearest = nearestP.subtract(center);
        
        // Dot product to see if they align (outside) or oppose (inside)
        // If point is exactly on line, dist is 0.
        
        // However, we want to constrain the point to be within [innerRadius, -outerRadius] distance from the edge.
        // Actually, usually users want to snap to the edge or stay within a reasonable margin.
        // The previous logic clamped the distance.
        
        // Let's implement a simple snap-to-edge if close, otherwise allow free movement but clamp max distance?
        // Or reproduce the previous "slide along edge" behavior.
        // Previous behavior: "clampedDist = Math.min(dist, innerRadius); ... Math.max(dist, -outerRadius)"
        // This implies the hole center can be slightly inside or outside the main shape edge.
        
        // Let's determine sign of distance
        // We can use paper.js Shape.contains(point) to check if inside.
        // But getNearestPointOnDieline returns just coordinates.
        
        // Optimization: Let's assume for Dieline shapes (convex-ish), 
        // if distance from center > distance of nearest from center, it's outside.
        const distToCenter = p.distanceFrom(center);
        const nearestDistToCenter = nearestP.distanceFrom(center);
        
        let signedDist = dist;
        if (distToCenter < nearestDistToCenter) {
            signedDist = -dist; // Inside
        }
        
        // Clamp distance
        let clampedDist = signedDist;
        if (signedDist > 0) {
            clampedDist = Math.min(signedDist, this.options.innerRadius);
        } else {
            clampedDist = Math.max(signedDist, -this.options.outerRadius);
        }
        
        // Reconstruct point
        // If dist is very small, just use nearestP
        if (dist < 0.001) return nearestP;
        
        // Direction vector normalized
        const dir = v.scalarDivide(dist);
        
        // New point = nearest + dir * clampedDist
        // Note: if inside (signedDist < 0), v points towards center (roughly), dist is positive magnitude.
        // Wait, v = p - nearest.
        // If p is inside, p is closer to center. v points Inwards.
        // If we want clampedDist to be negative, we should probably stick to normal vectors.
        
        // Let's simplify:
        // Just place it at nearest point + offset vector.
        // Offset vector is 'v' scaled to clampedDist.
        
        // If p is inside, v points in. length is 'dist'.
        // We want length to be 'clampedDist' (magnitude).
        // Since clampedDist is negative for inside, we need to be careful with signs.
        
        // Actually simpler:
        // We want the result to lie on the line connecting Center -> P -> Nearest? No.
        // We want it on the line Nearest -> P.
        
        // Current distance is 'dist'.
        // Desired distance is abs(clampedDist).
        // If clampedDist sign matches signedDist sign, we just scale v.
        
        const scale = Math.abs(clampedDist) / (dist || 1);
        
        // If we are clamping, we just scale the vector from nearest.
        const offset = v.scalarMultiply(scale);
        
        return nearestP.add(offset);
    }
}
