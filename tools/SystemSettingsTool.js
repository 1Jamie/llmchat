'use strict';

const { GObject, Gio } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.tools.BaseTool;

var Tool = GObject.registerClass(
class SystemSettingsTool extends BaseTool {
    _init() {
        super._init({
            name: 'system_settings',
            description: 'Manage system settings like night light, brightness, and volume',
            category: 'system',
            parameters: {
                action: {
                    type: 'string',
                    enum: ['toggle_night_light', 'set_brightness', 'set_volume'],
                    description: 'Action to perform'
                },
                value: {
                    type: 'number',
                    description: 'Value for brightness (0-100) or volume (0-100)'
                }
            }
        });
    }

    execute(params = {}) {
        const { action, value } = params;

        switch (action) {
            case 'toggle_night_light':
                return this._toggleNightLight();
            case 'set_brightness':
                if (typeof value !== 'number' || value < 0 || value > 100) {
                    return { error: 'Brightness value must be between 0 and 100' };
                }
                return this._setBrightness(value);
            case 'set_volume':
                if (typeof value !== 'number' || value < 0 || value > 100) {
                    return { error: 'Volume value must be between 0 and 100' };
                }
                return this._setVolume(value);
            default:
                return { error: 'Invalid action' };
        }
    }

    _toggleNightLight() {
        try {
            const settings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
            const currentState = settings.get_boolean('night-light-enabled');
            settings.set_boolean('night-light-enabled', !currentState);
            
            return {
                success: true,
                night_light_enabled: !currentState
            };
        } catch (error) {
            return { error: `Failed to toggle night light: ${error.message}` };
        }
    }

    _setBrightness(value) {
        try {
            const settings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.power' });
            const percentage = Math.round(value);
            settings.set_int('brightness', percentage);
            
            return {
                success: true,
                brightness: percentage
            };
        } catch (error) {
            return { error: `Failed to set brightness: ${error.message}` };
        }
    }

    _setVolume(value) {
        try {
            const settings = new Gio.Settings({ schema_id: 'org.gnome.desktop.sound' });
            const percentage = Math.round(value);
            settings.set_int('volume', percentage);
            
            return {
                success: true,
                volume: percentage
            };
        } catch (error) {
            return { error: `Failed to set volume: ${error.message}` };
        }
    }
}); 