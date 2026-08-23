import { strict as assert } from "node:assert";
import {
	buildChargerCommands,
	calculateOptimalChargeCurrent,
	type ChargeManagerControllerInput,
	decideChargeManager,
	MAX_CHARGE_CURRENT,
	MIN_CHARGE_CURRENT,
	SHUTDOWN_DELAY_CYCLES,
	START_CHARGE_CURRENT,
	stepChargeCurrent,
	updateShutdownDelay,
} from "./lib/chargeManagerUtils";

describe("ChargeManager safety helpers", () => {
	describe("calculateOptimalChargeCurrent", () => {
		const validInput = {
			solarPower: 6000,
			houseConsumption: 1000,
			chargerPower: 0,
			subtractChargerPower: false,
			batterySoc: 70,
			minBatterySoc: 70,
			reservePower: 100,
			maximumBatteryBonus: 2000,
			phases: 1,
		};

		it("clamps insufficient surplus to an internal 0 A target", () => {
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					solarPower: 0,
				}),
				0,
			);
		});

		it("clamps high surplus to the maximum charging current", () => {
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					solarPower: 20_000,
				}),
				MAX_CHARGE_CURRENT,
			);
		});

		it("rejects an unknown phase count instead of calculating Infinity", () => {
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					phases: 0,
				}),
				null,
			);
		});

		it("rejects non-finite and out-of-range inputs", () => {
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: Number.NaN }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, batterySoc: 101 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, minBatterySoc: -1 }), null);
		});

		it("handles a 100% minimum battery SOC without division by zero", () => {
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					batterySoc: 100,
					minBatterySoc: 100,
				}),
				16,
			);
		});

		it("adds charger consumption when it is included in household consumption", () => {
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					solarPower: 100,
					houseConsumption: 0,
					chargerPower: 2300,
					subtractChargerPower: true,
				}),
				10,
			);
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					solarPower: 100,
					houseConsumption: 0,
					chargerPower: 2300,
					subtractChargerPower: false,
				}),
				0,
			);
		});

		it("uses the configurable grid reserve", () => {
			// reserve 0 keeps the full 460 W surplus -> 2 A
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: 460, houseConsumption: 0, reservePower: 0 }), 2);
			// a 460 W reserve cancels a 460 W surplus -> 0 A
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: 460, houseConsumption: 0, reservePower: 460 }), 0);
		});

		it("scales the battery bonus with the configurable maximum", () => {
			const base = { ...validInput, solarPower: 0, houseConsumption: 0, batterySoc: 100, minBatterySoc: 50, reservePower: 0 };
			// no bonus -> no battery offset -> 0 A
			assert.equal(calculateOptimalChargeCurrent({ ...base, maximumBatteryBonus: 0 }), 0);
			// a 2300 W bonus is fully released at 100 % SOC -> 10 A
			assert.equal(calculateOptimalChargeCurrent({ ...base, maximumBatteryBonus: 2300 }), 10);
		});

		it("rejects a negative grid reserve or battery bonus", () => {
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, reservePower: -1 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumBatteryBonus: -1 }), null);
		});
	});

	describe("decideChargeManager", () => {
		function inputForTarget(targetCurrent: number, currentAmp = targetCurrent, shutdownDelay = 0, phases = 1): ChargeManagerControllerInput {
			return {
				solarPower: targetCurrent * 230 * phases + 100,
				houseConsumption: 0,
				chargerPower: 0,
				subtractChargerPower: false,
				batterySoc: 70,
				minBatterySoc: 70,
				reservePower: 100,
				maximumBatteryBonus: 2000,
				phases,
				state: { currentAmp, shutdownDelay },
			};
		}

		const boundaryCases = [
			{ current: 5, action: "hold", reason: "shutdown-delay", delay: 1 },
			{ current: 6, action: "hold", reason: "hysteresis", delay: 0 },
			{ current: 9, action: "hold", reason: "hysteresis", delay: 0 },
			{ current: 10, action: "enable", reason: "charging-current", delay: 0 },
			{ current: 16, action: "enable", reason: "charging-current", delay: 0 },
		] as const;

		for (const testCase of boundaryCases) {
			it(`returns ${testCase.action} at ${testCase.current} A`, () => {
				const decision = decideChargeManager(inputForTarget(testCase.current));

				assert.equal(decision.action, testCase.action);
				assert.equal(decision.reason, testCase.reason);
				assert.equal(decision.optimalCurrent, testCase.current);
				assert.deepEqual(decision.nextState, {
					currentAmp: testCase.current,
					shutdownDelay: testCase.delay,
				});
			});
		}

		it("starts charging when the current ramp reaches 10 A", () => {
			const decision = decideChargeManager(inputForTarget(16, START_CHARGE_CURRENT - 1));

			assert.equal(decision.action, "enable");
			assert.equal(decision.reason, "charging-current");
			assert.equal(decision.optimalCurrent, MAX_CHARGE_CURRENT);
			assert.equal(decision.nextState.currentAmp, START_CHARGE_CURRENT);
		});

		it("holds in the hysteresis range while ramping down", () => {
			const decision = decideChargeManager(inputForTarget(0, START_CHARGE_CURRENT, SHUTDOWN_DELAY_CYCLES));

			assert.equal(decision.action, "hold");
			assert.equal(decision.reason, "hysteresis");
			assert.deepEqual(decision.nextState, { currentAmp: START_CHARGE_CURRENT - 1, shutdownDelay: 0 });
		});

		it("disables after the twelfth completed shutdown-delay cycle", () => {
			const beforeLimit = decideChargeManager(inputForTarget(5, 5, SHUTDOWN_DELAY_CYCLES - 1));
			assert.equal(beforeLimit.action, "hold");
			assert.equal(beforeLimit.nextState.shutdownDelay, SHUTDOWN_DELAY_CYCLES);

			const afterLimit = decideChargeManager(inputForTarget(5, 5, SHUTDOWN_DELAY_CYCLES));
			assert.equal(afterLimit.action, "disable");
			assert.equal(afterLimit.reason, "insufficient-surplus");
			assert.equal(afterLimit.nextState.shutdownDelay, 0);
		});

		it("calculates the same start threshold for three-phase charging", () => {
			const decision = decideChargeManager(inputForTarget(START_CHARGE_CURRENT, START_CHARGE_CURRENT, 0, 3));

			assert.equal(decision.optimalCurrent, START_CHARGE_CURRENT);
			assert.equal(decision.action, "enable");
		});

		it("requests a fail-safe stop and resets state for invalid inputs", () => {
			const decision = decideChargeManager({
				...inputForTarget(START_CHARGE_CURRENT, START_CHARGE_CURRENT, 8),
				phases: 0,
			});

			assert.equal(decision.action, "disable");
			assert.equal(decision.reason, "invalid-input");
			assert.equal(decision.optimalCurrent, null);
			assert.deepEqual(decision.nextState, { currentAmp: 0, shutdownDelay: 0 });
		});
	});

	describe("stepChargeCurrent", () => {
		it("never steps below zero during prolonged insufficient surplus", () => {
			let current = MIN_CHARGE_CURRENT;
			for (let cycle = 0; cycle < 1000; cycle++) {
				current = stepChargeCurrent(current, 0);
			}
			assert.equal(current, 0);
		});

		it("recovers invalid internal values and respects the maximum", () => {
			assert.equal(stepChargeCurrent(Number.NaN, 10), 1);
			assert.equal(stepChargeCurrent(-100, 0), 0);
			assert.equal(stepChargeCurrent(100, 100), MAX_CHARGE_CURRENT);
		});
	});

	describe("buildChargerCommands", () => {
		it("sets the volatile current before enabling charging", () => {
			assert.deepEqual(buildChargerCommands(true, 10, "60.2"), [
				{ parameter: "amx", value: 10 },
				{ parameter: "alw", value: 1 },
			]);
		});

		it("uses the persistent current parameter for firmware 033", () => {
			assert.deepEqual(buildChargerCommands(true, 6, "033"), [
				{ parameter: "amp", value: 6 },
				{ parameter: "alw", value: 1 },
			]);
		});

		it("only revokes the charge release when disabling", () => {
			assert.deepEqual(buildChargerCommands(false, -100, "60.2"), [{ parameter: "alw", value: 0 }]);
		});

		it("rejects invalid currents when enabling", () => {
			assert.equal(buildChargerCommands(true, 5, "60.2"), null);
			assert.equal(buildChargerCommands(true, 17, "60.2"), null);
			assert.equal(buildChargerCommands(true, 6.5, "60.2"), null);
			assert.equal(buildChargerCommands(true, Number.NaN, "60.2"), null);
		});
	});

	describe("updateShutdownDelay", () => {
		it("counts consecutive low-current cycles", () => {
			assert.equal(updateShutdownDelay(5, MIN_CHARGE_CURRENT, 4), 5);
		});

		it("resets after sufficient surplus returns", () => {
			assert.equal(updateShutdownDelay(MIN_CHARGE_CURRENT, MIN_CHARGE_CURRENT, 12), 0);
			assert.equal(updateShutdownDelay(10, MIN_CHARGE_CURRENT, 12), 0);
		});
	});
});
