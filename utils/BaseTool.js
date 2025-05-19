'use strict';

const { GObject } = imports.gi;

var BaseTool = GObject.registerClass(
class BaseTool extends GObject.Object {
    _init(config) {
        super._init();
        this.name = config.name;
        this.description = config.description;
        this.category = config.category;
        this.parameters = config.parameters;
        this._memoryService = null;
    }

    setMemoryService(memoryService) {
        this._memoryService = memoryService;
    }

    getMemoryService() {
        return this._memoryService;
    }

    async execute(params = {}) {
        throw new Error('execute() must be implemented by subclass');
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