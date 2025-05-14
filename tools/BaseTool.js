'use strict';

const { GObject } = imports.gi;

var BaseTool = GObject.registerClass(
class BaseTool extends GObject.Object {
    _init(params) {
        super._init();
        this.name = params.name;
        this.description = params.description;
        this.category = params.category;
        this.parameters = params.parameters;
    }

    execute(params = {}) {
        throw new Error('execute() method must be implemented by tool class');
    }

    toJSON() {
        return {
            name: this.name,
            description: this.description,
            category: this.category,
            parameters: this.parameters
        };
    }
}); 