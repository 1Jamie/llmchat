'use strict';

const { GObject } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class DisplayManagementTool extends BaseTool {
    _init() {
        super._init({
            name: 'display_management',
            description: 'Get display information and manage display settings',
            category: 'system',
            parameters: {
                action: {
                    type: 'string',
                    enum: ['get_display_info', 'get_primary_display'],
                    description: 'Action to perform'
                }
            }
        });
    }

    execute(params = {}) {
        const { action } = params;

        switch (action) {
            case 'get_display_info':
                return this._getDisplayInfo();
            case 'get_primary_display':
                return this._getPrimaryDisplay();
            default:
                return { error: 'Invalid action' };
        }
    }

    _getDisplayInfo() {
        try {
            const screen = global.screen;
            const displays = [];

            for (let i = 0; i < screen.get_n_monitors(); i++) {
                const display = {
                    index: i,
                    is_primary: screen.get_primary_monitor() === i,
                    geometry: {
                        x: screen.get_monitor_geometry(i).x,
                        y: screen.get_monitor_geometry(i).y,
                        width: screen.get_monitor_geometry(i).width,
                        height: screen.get_monitor_geometry(i).height
                    },
                    work_area: {
                        x: screen.get_monitor_work_area(i).x,
                        y: screen.get_monitor_work_area(i).y,
                        width: screen.get_monitor_work_area(i).width,
                        height: screen.get_monitor_work_area(i).height
                    }
                };
                displays.push(display);
            }

            return {
                success: true,
                displays: displays
            };
        } catch (error) {
            return { error: `Failed to get display info: ${error.message}` };
        }
    }

    _getPrimaryDisplay() {
        try {
            const screen = global.screen;
            const primaryIndex = screen.get_primary_monitor();

            if (primaryIndex === -1) {
                return { error: 'No primary display found' };
            }

            const display = {
                index: primaryIndex,
                geometry: {
                    x: screen.get_monitor_geometry(primaryIndex).x,
                    y: screen.get_monitor_geometry(primaryIndex).y,
                    width: screen.get_monitor_geometry(primaryIndex).width,
                    height: screen.get_monitor_geometry(primaryIndex).height
                },
                work_area: {
                    x: screen.get_monitor_work_area(primaryIndex).x,
                    y: screen.get_monitor_work_area(primaryIndex).y,
                    width: screen.get_monitor_work_area(primaryIndex).width,
                    height: screen.get_monitor_work_area(primaryIndex).height
                }
            };

            return {
                success: true,
                display: display
            };
        } catch (error) {
            return { error: `Failed to get primary display: ${error.message}` };
        }
    }
}); 