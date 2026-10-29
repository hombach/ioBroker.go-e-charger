import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// On a fresh install js-controller creates the instance config (native) from io-package.json, and on
// upgrades it adds every native key that is missing in the stored instance config. So io-package.json
// native has to use exactly the config keys the code reads, with the same defaults as the admin UI.

const rootDir = join(__dirname, "..");
const readJson = (file: string): any => JSON.parse(readFileSync(join(rootDir, file), "utf8"));

/**
 * Collect all config attributes (and their defaults) from a jsonConfig schema, ignoring tabs/panels and accordion sub-items
 *
 * @param items - jsonConfig items object
 * @param result - map to collect attribute name -> default value
 * @returns the collected attributes
 */
function collectJsonConfigAttributes(items: Record<string, any>, result: Map<string, unknown> = new Map()): Map<string, unknown> {
	for (const [name, item] of Object.entries(items)) {
		if (item.type === "panel" || item.type === "tabs") {
			collectJsonConfigAttributes(item.items, result);
		} else if (!name.startsWith("_")) {
			result.set(name, item.default);
		}
	}
	return result;
}

/** Top-level keys of ioBroker.AdapterConfig in src/lib/adapter-config.d.ts */
function adapterConfigKeys(): string[] {
	const source = readFileSync(join(rootDir, "src", "lib", "adapter-config.d.ts"), "utf8");
	const body = source.slice(source.indexOf("interface AdapterConfig"));
	return [...body.matchAll(/^\t{3}(\w+)\??:/gm)].map(match => match[1]);
}

describe("io-package.json native defaults", () => {
	const native: Record<string, unknown> = readJson("io-package.json").native;
	const jsonConfigAttributes = collectJsonConfigAttributes(readJson("admin/jsonConfig.json").items);

	it("contains exactly the keys of AdapterConfig", () => {
		assert.deepEqual(Object.keys(native).sort(), adapterConfigKeys().sort());
	});

	it("contains exactly the attributes of admin/jsonConfig.json", () => {
		assert.deepEqual(Object.keys(native).sort(), [...jsonConfigAttributes.keys()].sort());
	});

	it("uses the same defaults as admin/jsonConfig.json", () => {
		for (const [name, jsonDefault] of jsonConfigAttributes) {
			if (jsonDefault !== undefined) {
				assert.deepEqual(native[name], jsonDefault, `default of ${name}`);
			}
		}
	});

	it("provides safe defaults for keys without a jsonConfig default", () => {
		assert.equal(native.cycleTime, 10000);
		assert.equal(native.subtractSelfConsumption, true);
		assert.deepEqual(native.wallBoxList, []);
	});
});
