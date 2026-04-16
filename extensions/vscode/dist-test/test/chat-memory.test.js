"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const chat_memory_1 = require("../chat-memory");
class FakeGlobalState {
    data = new Map();
    get(key) {
        return this.data.get(key);
    }
    async update(key, value) {
        if (typeof value === 'undefined') {
            this.data.delete(key);
            return;
        }
        this.data.set(key, value);
    }
}
suite('ChatMemory', () => {
    test('persists messages per instance', async () => {
        const context = { globalState: new FakeGlobalState() };
        const memory = new chat_memory_1.ChatMemory(context);
        await memory.save('instance-a', [
            { role: 'user', content: 'hello', timestamp: '2026-04-10T00:00:00.000Z' },
        ]);
        await memory.save('instance-b', [
            { role: 'assistant', content: 'world', timestamp: '2026-04-10T00:00:01.000Z' },
        ]);
        assert.deepStrictEqual(await memory.load('instance-a'), [
            { role: 'user', content: 'hello', timestamp: '2026-04-10T00:00:00.000Z' },
        ]);
        assert.deepStrictEqual(await memory.load('instance-b'), [
            { role: 'assistant', content: 'world', timestamp: '2026-04-10T00:00:01.000Z' },
        ]);
    });
    test('clears a single instance history', async () => {
        const context = { globalState: new FakeGlobalState() };
        const memory = new chat_memory_1.ChatMemory(context);
        await memory.save('instance-a', [
            { role: 'user', content: 'keep?', timestamp: '2026-04-10T00:00:00.000Z' },
        ]);
        await memory.clear('instance-a');
        assert.deepStrictEqual(await memory.load('instance-a'), []);
    });
});
//# sourceMappingURL=chat-memory.test.js.map