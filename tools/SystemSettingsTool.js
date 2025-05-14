'use strict';

const { GObject, Gio, GLib } = imports.gi;
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
                    enum: ['toggle_night_light', 'set_brightness', 'get_brightness', 'set_volume', 'get_volume'],
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
        
        // Convert value to number if it's a string that represents a number
        const numericValue = typeof value === 'string' ? parseFloat(value) : value;
        
        log(`SystemSettingsTool executing action: ${action}, value: ${value}, numericValue: ${numericValue}`);

        switch (action) {
            case 'toggle_night_light':
                return this._toggleNightLight();
            case 'set_brightness':
                if (isNaN(numericValue) || numericValue < 0 || numericValue > 100) {
                    return { error: 'Brightness value must be between 0 and 100' };
                }
                return this._setBrightness(numericValue);
            case 'get_brightness':
                return this._getBrightness();
            case 'set_volume':
                if (isNaN(numericValue) || numericValue < 0 || numericValue > 100) {
                    return { error: 'Volume value must be between 0 and 100' };
                }
                return this._setVolume(numericValue);
            case 'get_volume':
                return this._getVolume();
            default:
                return { error: `Invalid action: ${action}` };
        }
    }

    _toggleNightLight() {
        try {
            // Try with GSettings
            try {
                const settings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
                const currentState = settings.get_boolean('night-light-enabled');
                settings.set_boolean('night-light-enabled', !currentState);
                
                return {
                    success: true,
                    night_light_enabled: !currentState,
                    method: 'gsettings'
                };
            } catch (e) {
                log(`Failed to toggle night light with GSettings: ${e.message}`);
            }
            
            // Try using dbus as fallback
            const [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                `gdbus call --session --dest org.gnome.SettingsDaemon.Color --object-path /org/gnome/SettingsDaemon/Color --method org.freedesktop.DBus.Properties.Get org.gnome.SettingsDaemon.Color NightLightActive`
            );
            
            if (exitCode === 0) {
                // Get current state
                const output = imports.byteArray.toString(stdout).trim();
                const currentState = output.includes('true');
                
                // Toggle the state
                const newState = !currentState;
                const setCmd = `gdbus call --session --dest org.gnome.SettingsDaemon.Color --object-path /org/gnome/SettingsDaemon/Color --method org.freedesktop.DBus.Properties.Set org.gnome.SettingsDaemon.Color NightLightActive "<${newState ? 'true' : 'false'}>"`; 
                
                const [setSuccess, setStdout, setStderr, setExitCode] = GLib.spawn_command_line_sync(setCmd);
                
                if (setExitCode === 0) {
                    return {
                        success: true,
                        night_light_enabled: newState,
                        method: 'dbus'
                    };
                }
            }
            
            return {
                success: false,
                error: 'Failed to toggle night light using available methods'
            };
        } catch (error) {
            return { error: `Failed to toggle night light: ${error.message}` };
        }
    }

    _getBrightness() {
        try {
            log('Attempting to get current brightness');
            
            // Method 1: Direct DBus property - no privilege needed
            try {
                const cmd = `gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.freedesktop.DBus.Properties.Get org.gnome.SettingsDaemon.Power.Screen Brightness`;
                const [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(cmd);
                
                if (exitCode === 0) {
                    const brightnessOutput = imports.byteArray.toString(stdout);
                    const match = brightnessOutput.match(/<int32 (\d+)>/);
                    
                    if (match && match[1]) {
                        const brightness = parseInt(match[1], 10);
                        return {
                            success: true,
                            brightness: brightness,
                            method: 'dbus-property'
                        };
                    }
                }
            } catch (e) {
                log(`Failed to get brightness with DBus: ${e.message}`);
            }
            
            // Method 2: Try using native GLib calls
            try {
                const powerSettings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.power' });
                
                // Check if 'brightness' key exists
                let schemaKeys = powerSettings.settings_schema.list_keys();
                if (schemaKeys.indexOf('brightness') !== -1) {
                    const brightness = powerSettings.get_int('brightness');
                    return {
                        success: true,
                        brightness: brightness,
                        method: 'gsettings'
                    };
                }
            } catch (e) {
                log(`Failed to get brightness with GSettings: ${e.message}`);
            }
            
            return {
                success: false,
                error: 'Could not get brightness using available methods'
            };
        } catch (error) {
            return { error: `Failed to get brightness: ${error.message}` };
        }
    }

    _setBrightness(value) {
        try {
            // Make sure value is a number and within range
            const percentage = Math.max(0, Math.min(100, Math.round(value)));
            
            log(`Attempting to set brightness to ${percentage}% using non-privileged methods`);
            
            // Method 1: Direct DBus property setting - no privilege needed
            try {
                // Set the Brightness property directly using DBus
                const cmd = `gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.freedesktop.DBus.Properties.Set org.gnome.SettingsDaemon.Power.Screen Brightness "<int32 ${percentage}>"`;
                log(`Using direct DBus property method: ${cmd}`);
                const [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(cmd);
                
                if (exitCode === 0) {
                    return {
                        success: true,
                        brightness: percentage,
                        method: 'dbus-property'
                    };
                } else {
                    log(`DBus property method failed: ${imports.byteArray.toString(stderr)}`);
                }
            } catch (e) {
                log(`Failed with direct DBus property method: ${e.message}`);
            }
            
            // Method 2: Use StepUp/StepDown methods to adjust brightness incrementally
            try {
                // First get current brightness
                const getCmdBrightness = `gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.freedesktop.DBus.Properties.Get org.gnome.SettingsDaemon.Power.Screen Brightness`;
                const [getSuccess, getStdout, getStderr, getExitCode] = GLib.spawn_command_line_sync(getCmdBrightness);
                
                if (getExitCode === 0) {
                    // Parse current brightness
                    const brightnessOutput = imports.byteArray.toString(getStdout);
                    const match = brightnessOutput.match(/<int32 (\d+)>/);
                    
                    if (match && match[1]) {
                        const currentBrightness = parseInt(match[1], 10);
                        log(`Current brightness is ${currentBrightness}, target is ${percentage}`);
                        
                        if (percentage > currentBrightness) {
                            // Need to increase brightness
                            for (let i = currentBrightness; i < percentage; i += 5) {
                                const stepUpCmd = `gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.gnome.SettingsDaemon.Power.Screen.StepUp`;
                                GLib.spawn_command_line_sync(stepUpCmd);
                            }
                        } else if (percentage < currentBrightness) {
                            // Need to decrease brightness
                            for (let i = currentBrightness; i > percentage; i -= 5) {
                                const stepDownCmd = `gdbus call --session --dest org.gnome.SettingsDaemon.Power --object-path /org/gnome/SettingsDaemon/Power --method org.gnome.SettingsDaemon.Power.Screen.StepDown`;
                                GLib.spawn_command_line_sync(stepDownCmd);
                            }
                        }
                        
                        // Get final brightness
                        const [finalSuccess, finalStdout, finalStderr, finalExitCode] = GLib.spawn_command_line_sync(getCmdBrightness);
                        if (finalExitCode === 0) {
                            const finalOutput = imports.byteArray.toString(finalStdout);
                            const finalMatch = finalOutput.match(/<int32 (\d+)>/);
                            if (finalMatch && finalMatch[1]) {
                                const finalBrightness = parseInt(finalMatch[1], 10);
                                return {
                                    success: true,
                                    brightness: finalBrightness,
                                    method: 'step-adjustment'
                                };
                            }
                        }
                    }
                }
            } catch (e) {
                log(`Failed with stepped adjustment method: ${e.message}`);
            }
            
            // Method 3: Try using native GLib calls directly
            try {
                // Create a GSettings object
                const powerSettings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.power' });
                
                // Check if 'brightness' key exists
                let schemaKeys = powerSettings.settings_schema.list_keys();
                if (schemaKeys.indexOf('brightness') !== -1) {
                    powerSettings.set_int('brightness', percentage);
                    return {
                        success: true,
                        brightness: percentage,
                        method: 'gsettings'
                    };
                }
            } catch (e) {
                log(`Failed with GSettings method: ${e.message}`);
            }
            
            return {
                success: false,
                error: 'Could not adjust brightness using non-privileged methods',
                attempted_methods: ['dbus-property', 'step-adjustment', 'gsettings']
            };
        } catch (error) {
            return { error: `Failed to set brightness: ${error.message}` };
        }
    }

    _getVolume() {
        try {
            log('Attempting to get current volume');
            
            // Use PulseAudio to get the volume (via pactl)
            const [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                `pactl get-sink-volume @DEFAULT_SINK@`
            );
            
            if (exitCode !== 0) {
                return { 
                    error: `Failed to get volume: ${imports.byteArray.toString(stderr)}`
                };
            }
            
            // Parse the output to extract volume percentage
            const output = imports.byteArray.toString(stdout);
            const volumeMatches = output.match(/(\d+)%/g);
            
            if (volumeMatches && volumeMatches.length > 0) {
                // Take the first volume percentage found
                const volumeStr = volumeMatches[0];
                const volume = parseInt(volumeStr, 10);
                
                return {
                    success: true,
                    volume: volume
                };
            } else {
                return {
                    error: 'Could not parse volume information from output'
                };
            }
        } catch (error) {
            return { error: `Failed to get volume: ${error.message}` };
        }
    }

    _setVolume(value) {
        try {
            // Make sure value is a number and within range
            const percentage = Math.max(0, Math.min(100, Math.round(value)));
            
            // Use PulseAudio to set the volume (via pactl)
            const [success, stdout, stderr, exitCode] = GLib.spawn_command_line_sync(
                `pactl set-sink-volume @DEFAULT_SINK@ ${percentage}%`
            );
            
            if (exitCode !== 0) {
                return { 
                    error: `Failed to set volume: ${imports.byteArray.toString(stderr)}`
                };
            }
            
            return {
                success: true,
                volume: percentage
            };
        } catch (error) {
            return { error: `Failed to set volume: ${error.message}` };
        }
    }
}); 