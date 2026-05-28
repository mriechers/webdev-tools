// formatter/tests/helpers.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { DOMParser } from 'linkedom';

globalThis.DOMParser = DOMParser;

export { test, assert };
