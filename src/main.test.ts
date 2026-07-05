/**
 * This is a dummy TypeScript test file using mocha and the Node.js assert module.
 *
 * It's automatically excluded from npm and its build output is excluded from both git and npm.
 * It is advised to test all your modules with accompanying *.test.ts-files
 */

import { strict as assert } from "node:assert";
// import { functionToTest } from "./moduleToTest";

describe("module to test => function to test", () => {
	// initializing logic
	const expected = 5;

	it(`should return ${expected}`, () => {
		const result = 5;
		// assign result a value from functionToTest
		assert.equal(result, expected);
	});
	// ... more tests => it
});

// ... more test suites => describe
