'use strict';

const { GObject, Meta, Shell } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class WindowManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'window_management',
            description: 'Manage windows including minimizing, maximizing (single or all), moving, resizing, arranging in grid layouts, and closing',
            category: 'window',
            parameters: {
                action: {
                    type: 'string',
                    enum: ['minimize_all', 'maximize_current', 'maximize_all', 'arrange_grid', 'move', 'resize', 'close_current'],
                    description: 'Window action to perform'
                },
                rows: {
                    type: 'integer',
                    description: 'Number of rows for grid arrangement (default: 2)'
                },
                cols: {
                    type: 'integer',
                    description: 'Number of columns for grid arrangement (default: 2)'
                },
                x: {
                    type: 'integer',
                    description: 'X coordinate for window position'
                },
                y: {
                    type: 'integer',
                    description: 'Y coordinate for window position'
                },
                width: {
                    type: 'integer',
                    description: 'Width for window resizing'
                },
                height: {
                    type: 'integer',
                    description: 'Height for window resizing'
                }
            }
        });
        
        this._workspaceManager = global.workspace_manager;
        this._windowTracker = Shell.WindowTracker.get_default();
        this._displayManager = global.display;
        
        // Initialize with information about capabilities and recent changes
        log('WindowManagementTool initialized with the following capabilities:');
        log('1. Minimize all windows simultaneously');
        log('2. Maximize current focused window');
        log('3. NEW: Maximize all windows simultaneously using global.get_window_actors()');
        log('4. Arrange windows in a customizable grid layout (rows x columns)');
        log('5. Move focused window to specific coordinates');
        log('6. Resize focused window to specific dimensions');
        log('7. Close current focused window');
        log('8. All operations use the modern GNOME Shell window management APIs');
    }

    execute(params = {}) {
        const { action, rows = 2, cols = 2, x, y, width, height } = params;

        switch (action) {
            case 'minimize_all':
                return this._minimizeAllWindows();
            case 'maximize_current':
                return this._maximizeCurrentWindow();
            case 'maximize_all':
                return this._maximizeAllWindows();
            case 'arrange_grid':
                return this._arrangeWindowsInGrid(rows, cols);
            case 'move':
                if (typeof x !== 'number' || typeof y !== 'number') {
                    return { error: 'X and Y coordinates are required for move action' };
                }
                return this._moveWindow(x, y);
            case 'resize':
                if (typeof width !== 'number' || typeof height !== 'number') {
                    return { error: 'Width and height are required for resize action' };
                }
                return this._resizeWindow(width, height);
            case 'close_current':
                return this._closeCurrentWindow();
            default:
                return { error: 'Invalid window management action' };
        }
    }

    _minimizeAllWindows() {
        try {
            log('Attempting to minimize all windows');
            const windows = global.get_window_actors();
            let minimizedCount = 0;
            
            windows.forEach(actor => {
                const window = actor.get_meta_window();
                if (window && !window.is_skip_taskbar()) {
                    window.minimize();
                    minimizedCount++;
                }
            });
            
            log(`Successfully minimized ${minimizedCount} windows`);
            return {
                success: true,
                count: minimizedCount,
                message: `Minimized ${minimizedCount} windows`
            };
        } catch (error) {
            log(`Error minimizing windows: ${error.message}`);
            return { error: `Failed to minimize windows: ${error.message}` };
        }
    }

    _maximizeAllWindows() {
        try {
            log('Attempting to maximize all windows');
            const windows = global.get_window_actors();
            let maximizedCount = 0;
            
            windows.forEach(actor => {
                const window = actor.get_meta_window();
                if (window && !window.is_skip_taskbar()) {
                    window.maximize(Meta.MaximizeFlags.BOTH);
                    maximizedCount++;
                }
            });
            
            log(`Successfully maximized ${maximizedCount} windows`);
            return {
                success: true,
                count: maximizedCount,
                message: `Maximized ${maximizedCount} windows`
            };
        } catch (error) {
            log(`Error maximizing windows: ${error.message}`);
            return { error: `Failed to maximize windows: ${error.message}` };
        }
    }

    _maximizeCurrentWindow() {
        try {
            log('Attempting to maximize current window');
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            log(`Maximizing window: ${focusWindow.title}`);
            focusWindow.maximize(Meta.MaximizeFlags.BOTH);
            
            log('Window maximized successfully');
            return {
                success: true,
                window_title: focusWindow.title,
                message: `Maximized window: ${focusWindow.title}`
            };
        } catch (error) {
            log(`Error maximizing window: ${error.message}`);
            return { error: `Failed to maximize window: ${error.message}` };
        }
    }

    _arrangeWindowsInGrid(rows = 2, cols = 2) {
        try {
            log(`Attempting to arrange windows in ${rows}x${cols} grid`);
            
            const workspace = this._workspaceManager.get_active_workspace();
            const windows = global.get_window_actors()
                .map(actor => actor.get_meta_window())
                .filter(window => window && !window.is_skip_taskbar() && window.get_workspace() === workspace);

            log(`Found ${windows.length} windows to arrange`);

            if (windows.length === 0) {
                return { error: 'No windows found to arrange' };
            }

            const workArea = workspace.get_work_area_for_monitor(this._displayManager.get_primary_monitor());
            const cellWidth = workArea.width / cols;
            const cellHeight = workArea.height / rows;

            let arrangedCount = 0;
            windows.forEach((window, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
                
                if (row < rows) {
                    log(`Arranging window ${window.title} at position (${row}, ${col})`);
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    window.move_resize_frame(
                        true,
                        workArea.x + (col * cellWidth),
                        workArea.y + (row * cellHeight),
                        cellWidth,
                        cellHeight
                    );
                    arrangedCount++;
                }
            });
            
            log('Window arrangement completed');
            return {
                success: true,
                count: arrangedCount,
                grid: `${rows}x${cols}`,
                message: `Arranged ${arrangedCount} windows in a ${rows}x${cols} grid`
            };
        } catch (error) {
            log(`Error arranging windows: ${error.message}`);
            return { error: `Failed to arrange windows: ${error.message}` };
        }
    }

    _moveWindow(x, y) {
        try {
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            focusWindow.move_frame(true, x, y);
            
            return {
                success: true,
                window_title: focusWindow.title,
                position: { x, y },
                message: `Moved window '${focusWindow.title}' to position (${x}, ${y})`
            };
        } catch (error) {
            log(`Error moving window: ${error.message}`);
            return { error: `Failed to move window: ${error.message}` };
        }
    }

    _resizeWindow(width, height) {
        try {
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            const [x, y] = focusWindow.get_frame_rect();
            focusWindow.move_resize_frame(true, x, y, width, height);
            
            return {
                success: true,
                window_title: focusWindow.title,
                size: { width, height },
                message: `Resized window '${focusWindow.title}' to ${width}x${height}`
            };
        } catch (error) {
            log(`Error resizing window: ${error.message}`);
            return { error: `Failed to resize window: ${error.message}` };
        }
    }

    _closeCurrentWindow() {
        try {
            const focusWindow = this._displayManager.focus_window;
            
            if (!focusWindow) {
                return { error: 'No focused window found' };
            }
            
            const title = focusWindow.title;
            focusWindow.delete(global.get_current_time());
            
            return {
                success: true,
                window_title: title,
                message: `Closed window: ${title}`
            };
        } catch (error) {
            log(`Error closing window: ${error.message}`);
            return { error: `Failed to close window: ${error.message}` };
        }
    }
}); 