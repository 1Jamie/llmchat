'use strict';

const { GObject } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { BaseTool } = Me.imports.utils.BaseTool;

var Tool = GObject.registerClass(
class TimeDateTool extends BaseTool {
    _init() {
        super._init({
            name: 'time_date',
            description: 'Get current time, date, and timezone information. Use this tool when you need to: check the current time, get today\'s date, verify the timezone, or get time-related information. This tool provides accurate system time information and is useful for time-sensitive operations, scheduling, or when you need to reference the current time or date in your responses.',
            category: 'system',
            keywords: ['time', 'date', 'clock', 'calendar', 'timezone', 'hour', 'minute', 'second', 'day', 'month', 'year', 'current', 'now', 'today', 'schedule', 'timestamp'],
            parameters: {
                action: {
                    type: 'string',
                    enum: ['get_current_time', 'get_current_date', 'get_timezone'],
                    description: 'Action to perform'
                }
            }
        });
    }

    execute(params = {}) {
        const { action } = params;

        switch (action) {
            case 'get_current_time':
                return this._getCurrentTime();
            case 'get_current_date':
                return this._getCurrentDate();
            case 'get_timezone':
                return this._getTimezone();
            default:
                return { error: 'Invalid action' };
        }
    }

    _getCurrentTime() {
        try {
            const now = new Date();
            const timeString = now.toLocaleTimeString();
            const timestamp = now.getTime();

            return {
                success: true,
                time: timeString,
                timestamp: timestamp
            };
        } catch (error) {
            return { error: `Failed to get current time: ${error.message}` };
        }
    }

    _getCurrentDate() {
        try {
            const now = new Date();
            const dateString = now.toLocaleDateString();
            const timestamp = now.getTime();

            return {
                success: true,
                date: dateString,
                timestamp: timestamp
            };
        } catch (error) {
            return { error: `Failed to get current date: ${error.message}` };
        }
    }

    _getTimezone() {
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return {
                success: true,
                timezone: timezone
            };
        } catch (error) {
            return { error: `Failed to get timezone: ${error.message}` };
        }
    }
}); 