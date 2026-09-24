import { strict as assert } from "node:assert";
import {
	buildChargerCommands,
	calculateOptimalChargeCurrent,
	type ChargeManagerControllerInput,
	decideChargeManager,
	decideChargeManagerFleet,
	decidePhaseSwitch,
	effectiveCurrentDemand,
	evaluateBatteryAvailability,
	type FleetParticipant,
	limitTotalCurrent,
	MAX_CHARGE_CURRENT,
	MIN_CHARGE_CURRENT,
	RECLAIM_DELAY_CYCLES,
	type TotalCurrentParticipant,
	PHASE_SWITCH_DELAY_CYCLES,
	PHASE_VOLTAGE,
	resolveWallboxCurrentLimits,
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
			batteryMode: "priority" as const,
			reservePower: 100,
			maximumBatteryBonus: 2000,
			maximumChargeCurrent: MAX_CHARGE_CURRENT,
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
			// 6000 - 1000 - 100 W reserve = 4900 W -> floor(4900 / 230) = 21 A (below the 32 A ceiling)
			assert.equal(
				calculateOptimalChargeCurrent({
					...validInput,
					batterySoc: 100,
					minBatterySoc: 100,
				}),
				21,
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

		it("applies the battery bonus only in priority mode", () => {
			const base = { ...validInput, solarPower: 100, houseConsumption: 0, batterySoc: 100, reservePower: 100 };
			// priority releases the full 2000 W bonus at 100 % SOC -> 8 A
			assert.equal(calculateOptimalChargeCurrent({ ...base, batteryMode: "priority" }), 8);
			// minimumSoc keeps the battery power for the house -> no surplus
			assert.equal(calculateOptimalChargeCurrent({ ...base, batteryMode: "minimumSoc" }), 0);
			// disabled needs no SOC at all
			assert.equal(calculateOptimalChargeCurrent({ ...base, batteryMode: "disabled", batterySoc: null }), 0);
		});

		it("rejects a missing SOC only in the battery-aware modes", () => {
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, batterySoc: null }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, batteryMode: "minimumSoc", batterySoc: null }), null);
			assert.notEqual(calculateOptimalChargeCurrent({ ...validInput, batteryMode: "disabled", batterySoc: null }), null);
		});

		it("never turns the battery bonus into a penalty below the minimum SOC", () => {
			// 40 % SOC against a 70 % minimum would give a negative offset without the clamp
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: 2400, houseConsumption: 0, reservePower: 0, batterySoc: 40 }), 10);
		});

		it("rejects a negative grid reserve or battery bonus", () => {
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, reservePower: -1 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumBatteryBonus: -1 }), null);
		});

		it("clamps to the configurable maximum charging current", () => {
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: 20_000, maximumChargeCurrent: 10 }), 10);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: 20_000, maximumChargeCurrent: 32 }), 32);
		});

		it("rejects an invalid maximum charging current", () => {
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumChargeCurrent: MIN_CHARGE_CURRENT - 1 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumChargeCurrent: MAX_CHARGE_CURRENT + 1 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumChargeCurrent: 12.5 }), null);
		});

		it("accepts a per-wallbox maximum below the start current", () => {
			// an 8 A coded cable or a per-box maximum of 8 A is a valid limit, not invalid input
			for (let maximum = MIN_CHARGE_CURRENT; maximum < START_CHARGE_CURRENT; maximum++) {
				assert.equal(calculateOptimalChargeCurrent({ ...validInput, solarPower: 20_000, maximumChargeCurrent: maximum }), maximum);
			}
		});
	});

	describe("evaluateBatteryAvailability", () => {
		const validInput = {
			mode: "priority" as const,
			batterySoc: 70,
			minimumBatterySoc: 70,
			batterySocAgeMs: 0,
			maximumAgeSeconds: 300,
			hysteresis: 2,
			wasReady: false,
		};

		it("does not require a battery state in disabled mode", () => {
			assert.deepEqual(
				evaluateBatteryAvailability({
					...validInput,
					mode: "disabled",
					batterySoc: null,
					minimumBatterySoc: Number.NaN,
					batterySocAgeMs: null,
				}),
				{ ready: true, reason: "disabled", batterySoc: null },
			);
		});

		it("fails safe for missing and stale battery data", () => {
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySoc: null }).reason, "invalid");
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySocAgeMs: 300_001 }).reason, "stale");
		});

		it("retains readiness within the configured SOC hysteresis", () => {
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySoc: 69 }).ready, false);
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySoc: 70 }).ready, true);
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySoc: 68, wasReady: true }).ready, true);
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySoc: 67.9, wasReady: true }).ready, false);
		});

		it("allows disabling the age limit without accepting invalid SOC values", () => {
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySocAgeMs: null, maximumAgeSeconds: 0 }).ready, true);
			assert.equal(evaluateBatteryAvailability({ ...validInput, batterySoc: 101, maximumAgeSeconds: 0 }).reason, "invalid");
		});
	});

	describe("resolveWallboxCurrentLimits", () => {
		const base = {
			installationMaxCurrent: 32,
			configuredMaxCurrent: 0,
			configuredMinCurrent: 0,
			hardwareMaxCurrent: null,
			hardwareMinCurrent: null,
		};

		it("falls back to the installation limit and the technical floor when nothing else is set", () => {
			assert.deepEqual(resolveWallboxCurrentLimits(base), { minCurrent: MIN_CHARGE_CURRENT, maxCurrent: 32 });
		});

		it("lets the user throttle a single box below the installation limit", () => {
			assert.deepEqual(resolveWallboxCurrentLimits({ ...base, configuredMaxCurrent: 10 }), { minCurrent: MIN_CHARGE_CURRENT, maxCurrent: 10 });
		});

		it("never lets a per-box maximum exceed the installation limit", () => {
			assert.equal(resolveWallboxCurrentLimits({ ...base, installationMaxCurrent: 16, configuredMaxCurrent: 32 }).maxCurrent, 16);
		});

		it("takes the tightest of installation, user and hardware maxima", () => {
			assert.equal(resolveWallboxCurrentLimits({ ...base, installationMaxCurrent: 32, configuredMaxCurrent: 20, hardwareMaxCurrent: 16 }).maxCurrent, 16);
		});

		it("raises the minimum to the highest of user and hardware minima", () => {
			assert.equal(resolveWallboxCurrentLimits({ ...base, configuredMinCurrent: 8 }).minCurrent, 8);
			assert.equal(resolveWallboxCurrentLimits({ ...base, hardwareMinCurrent: 10 }).minCurrent, 10);
			assert.equal(resolveWallboxCurrentLimits({ ...base, configuredMinCurrent: 8, hardwareMinCurrent: 10 }).minCurrent, 10);
		});

		it("never lets the minimum exceed the resolved maximum", () => {
			assert.deepEqual(resolveWallboxCurrentLimits({ ...base, configuredMaxCurrent: 10, configuredMinCurrent: 16 }), { minCurrent: 10, maxCurrent: 10 });
		});

		it("treats 0 and invalid bounds as not set", () => {
			assert.deepEqual(resolveWallboxCurrentLimits({ ...base, configuredMaxCurrent: 0, configuredMinCurrent: 0 }), {
				minCurrent: MIN_CHARGE_CURRENT,
				maxCurrent: 32,
			});
			assert.deepEqual(resolveWallboxCurrentLimits({ ...base, hardwareMaxCurrent: 0, hardwareMinCurrent: -5 }), {
				minCurrent: MIN_CHARGE_CURRENT,
				maxCurrent: 32,
			});
		});

		it("clamps an out-of-range installation limit to the supported maximum", () => {
			assert.equal(resolveWallboxCurrentLimits({ ...base, installationMaxCurrent: 99 }).maxCurrent, MAX_CHARGE_CURRENT);
			assert.equal(resolveWallboxCurrentLimits({ ...base, installationMaxCurrent: 0 }).maxCurrent, MAX_CHARGE_CURRENT);
		});
	});

	describe("resolveWallboxCurrentLimits across multiple wallboxes", () => {
		// Models several boxes on one shared power supply. The same installation limit and hardware
		// cap must be respected by every box regardless of its own configuration. This is the basis
		// for the future total-installation-current management.

		// helper: resolve the effective max for each box against a shared installation limit / hardware cap
		function resolveMaxima(
			installationMaxCurrent: number,
			configuredMaxima: number[],
			hardwareMaxCurrent: number | null = null,
			hardwareMinCurrent: number | null = null,
		): number[] {
			return configuredMaxima.map(
				configuredMaxCurrent =>
					resolveWallboxCurrentLimits({
						installationMaxCurrent,
						configuredMaxCurrent,
						configuredMinCurrent: 0,
						hardwareMaxCurrent,
						hardwareMinCurrent,
					}).maxCurrent,
			);
		}

		it("caps every box at the shared installation limit and hardware cap (10/16/20, hw 16, system 15)", () => {
			// box 1: own 10 A wins; boxes 2 & 3: clamped to the 15 A installation limit (below the 16 A hardware cap)
			assert.deepEqual(resolveMaxima(15, [10, 16, 20], 16), [10, 15, 15]);
		});

		it("lets the hardware cap tighten boxes below a generous installation limit (system 32, hw 16)", () => {
			// installation allows 32 A, but every box only reports 16 A hardware -> all capped at 16
			assert.deepEqual(resolveMaxima(32, [10, 16, 20], 16), [10, 16, 16]);
		});

		it("respects the installation limit even when both config and hardware are higher (system 11)", () => {
			// a 11 A supply (e.g. a shared breaker) caps all boxes, whatever they request
			assert.deepEqual(resolveMaxima(11, [16, 20, 32], 32), [11, 11, 11]);
		});

		it("mixes hardware caps per box under a shared installation limit (system 20, hw 16/32/11)", () => {
			// box A hw 16, box B hw 32, box C hw 11; all under a 20 A installation limit, no user max
			assert.deepEqual(
				[
					resolveWallboxCurrentLimits({
						installationMaxCurrent: 20,
						configuredMaxCurrent: 0,
						configuredMinCurrent: 0,
						hardwareMaxCurrent: 16,
						hardwareMinCurrent: null,
					}).maxCurrent,
					resolveWallboxCurrentLimits({
						installationMaxCurrent: 20,
						configuredMaxCurrent: 0,
						configuredMinCurrent: 0,
						hardwareMaxCurrent: 32,
						hardwareMinCurrent: null,
					}).maxCurrent,
					resolveWallboxCurrentLimits({
						installationMaxCurrent: 20,
						configuredMaxCurrent: 0,
						configuredMinCurrent: 0,
						hardwareMaxCurrent: 11,
						hardwareMinCurrent: null,
					}).maxCurrent,
				],
				[16, 20, 11],
			);
		});

		it("applies independent per-box minima while sharing the installation maximum (system 20)", () => {
			// box A: user min 8; box B: hardware min 10 (mca); box C: no min -> technical floor
			assert.deepEqual(
				resolveWallboxCurrentLimits({
					installationMaxCurrent: 20,
					configuredMaxCurrent: 0,
					configuredMinCurrent: 8,
					hardwareMaxCurrent: null,
					hardwareMinCurrent: null,
				}),
				{ minCurrent: 8, maxCurrent: 20 },
			);
			assert.deepEqual(
				resolveWallboxCurrentLimits({
					installationMaxCurrent: 20,
					configuredMaxCurrent: 0,
					configuredMinCurrent: 0,
					hardwareMaxCurrent: null,
					hardwareMinCurrent: 10,
				}),
				{ minCurrent: 10, maxCurrent: 20 },
			);
			assert.deepEqual(
				resolveWallboxCurrentLimits({
					installationMaxCurrent: 20,
					configuredMaxCurrent: 0,
					configuredMinCurrent: 0,
					hardwareMaxCurrent: null,
					hardwareMinCurrent: null,
				}),
				{ minCurrent: MIN_CHARGE_CURRENT, maxCurrent: 20 },
			);
		});

		it("clamps a per-box minimum down when the shared supply is very tight (system 8)", () => {
			// a tight 8 A supply: a box asking for min 10 A cannot exceed the 8 A cap
			assert.deepEqual(
				resolveWallboxCurrentLimits({
					installationMaxCurrent: 8,
					configuredMaxCurrent: 0,
					configuredMinCurrent: 10,
					hardwareMaxCurrent: 16,
					hardwareMinCurrent: null,
				}),
				{ minCurrent: 8, maxCurrent: 8 },
			);
		});

		it("keeps a mix of user throttling and hardware caps consistent (system 25)", () => {
			// box A throttled to 12 by user; box B capped to 16 by hardware; box C free -> installation 25
			assert.deepEqual(resolveMaxima(25, [12, 0, 0], null), [12, 25, 25]);
			assert.equal(
				resolveWallboxCurrentLimits({
					installationMaxCurrent: 25,
					configuredMaxCurrent: 0,
					configuredMinCurrent: 0,
					hardwareMaxCurrent: 16,
					hardwareMinCurrent: null,
				}).maxCurrent,
				16,
			);
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
				batteryMode: "priority",
				reservePower: 100,
				maximumBatteryBonus: 2000,
				maximumChargeCurrent: MAX_CHARGE_CURRENT,
				minimumChargeCurrent: MIN_CHARGE_CURRENT,
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
			const decision = decideChargeManager(inputForTarget(MAX_CHARGE_CURRENT, START_CHARGE_CURRENT - 1));

			assert.equal(decision.action, "enable");
			assert.equal(decision.reason, "charging-current");
			assert.equal(decision.optimalCurrent, MAX_CHARGE_CURRENT);
			assert.equal(decision.nextState.currentAmp, START_CHARGE_CURRENT);
		});

		it("starts a wallbox capped below 10 A at its own maximum", () => {
			// a box limited to 8 A can never reach the 10 A start current
			const decision = decideChargeManager({ ...inputForTarget(MAX_CHARGE_CURRENT, 7), maximumChargeCurrent: 8 });

			assert.equal(decision.action, "enable");
			assert.equal(decision.reason, "charging-current");
			assert.equal(decision.nextState.currentAmp, 8);
		});

		it("ramps a wallbox capped below 10 A up to charging instead of stalling", () => {
			// regression: such a box used to hold forever and never enable the charge release
			let state = { currentAmp: 0, shutdownDelay: 0 };
			let enabledAt: number | null = null;

			for (let cycle = 0; cycle < SHUTDOWN_DELAY_CYCLES + 5; cycle++) {
				const decision = decideChargeManager({ ...inputForTarget(MAX_CHARGE_CURRENT), maximumChargeCurrent: 8, state });
				assert.notEqual(decision.action, "disable");
				state = decision.nextState;
				if (enabledAt === null && decision.action === "enable") {
					enabledAt = cycle;
				}
			}

			assert.equal(enabledAt, 7); // one ampere per cycle from 0 A to the 8 A maximum
			assert.equal(state.currentAmp, 8);
			assert.equal(state.shutdownDelay, 0);
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

		it("does not count ramp-up to a raised minimum current as insufficient surplus", () => {
			// minimum 12 A, target 12 A, still ramping through 10 A - must not advance the shutdown delay
			const decision = decideChargeManager({ ...inputForTarget(12, 9, 8), minimumChargeCurrent: 12 });

			assert.equal(decision.action, "hold");
			assert.equal(decision.nextState.currentAmp, 10);
			assert.equal(decision.nextState.shutdownDelay, 0);
		});

		it("enables once the ramp reaches a raised minimum start current", () => {
			const decision = decideChargeManager({ ...inputForTarget(12, 11, 0), minimumChargeCurrent: 12 });

			assert.equal(decision.nextState.currentAmp, 12);
			assert.equal(decision.action, "enable");
		});

		it("rejects a minimum current above the maximum", () => {
			const decision = decideChargeManager({ ...inputForTarget(12, 12, 0), minimumChargeCurrent: 20, maximumChargeCurrent: 16 });

			assert.equal(decision.action, "disable");
			assert.equal(decision.reason, "invalid-input");
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

		it("respects the configurable maximum", () => {
			assert.equal(stepChargeCurrent(31, 40, 32), 32); // ramps up, capped at the configured maximum
			assert.equal(stepChargeCurrent(32, 40, 32), 32); // already at the maximum, stays
			assert.equal(stepChargeCurrent(10, 40, 20), 11); // steps toward the target bounded by the maximum
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
			assert.equal(buildChargerCommands(true, 33, "60.2"), null);
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

	describe("decideChargeManagerFleet", () => {
		const shared = {
			solarPower: 11000,
			houseConsumption: 1000,
			chargerPower: 0,
			subtractChargerPower: false,
			batterySoc: null,
			minBatterySoc: 70,
			batteryMode: "disabled" as const,
			reservePower: 100,
			maximumBatteryBonus: 2000,
		};
		const box = (overrides: Partial<FleetParticipant> = {}): FleetParticipant => ({
			phases: 3,
			minimumChargeCurrent: MIN_CHARGE_CURRENT,
			maximumChargeCurrent: 16,
			state: { currentAmp: 0, shutdownDelay: 0 },
			claimsPower: true,
			...overrides,
		});

		it("matches the single-wallbox controller exactly", () => {
			const single = box({ state: { currentAmp: 11, shutdownDelay: 0 } });
			const expected = decideChargeManager({
				...shared,
				maximumChargeCurrent: single.maximumChargeCurrent,
				minimumChargeCurrent: single.minimumChargeCurrent,
				phases: single.phases,
				state: single.state,
			});
			// the fleet result carries the extra availablePower; the decision itself is identical
			const { availablePower, ...decision } = decideChargeManagerFleet(shared, [single])[0];
			assert.deepEqual(decision, expected);
			// 11000 - 1000 house - 100 reserve = 9900 W offered to the only wallbox
			assert.equal(availablePower, 9900);
		});

		it("does not hand the same surplus to two wallboxes", () => {
			// 9900 W surplus covers ~14 A on three phases - only once, not twice
			const [first, second] = decideChargeManagerFleet(shared, [
				box({ state: { currentAmp: 14, shutdownDelay: 0 } }),
				box({ state: { currentAmp: 14, shutdownDelay: 0 } }),
			]);
			assert.equal(first.optimalCurrent, 14);
			assert.equal(second.optimalCurrent, 0);
		});

		it("passes the leftover surplus on to the next wallbox", () => {
			// 13900 W surplus, the first box is capped at 10 A (6900 W), leaving 7000 W for the second
			const plenty = { ...shared, solarPower: 15000 };
			const [first, second] = decideChargeManagerFleet(plenty, [box({ maximumChargeCurrent: 10 }), box()]);
			assert.equal(first.optimalCurrent, 10);
			assert.equal(second.optimalCurrent, 10);
		});

		it("serves wallboxes in list order, so the first one has priority", () => {
			// 4900 W surplus is enough for one box only - whoever comes first takes it
			const tight = { ...shared, solarPower: 6000 };
			const [singlePhaseFirst, threePhaseSecond] = decideChargeManagerFleet(tight, [box({ phases: 1 }), box()]);
			assert.equal(singlePhaseFirst.optimalCurrent, 16);
			assert.equal(threePhaseSecond.optimalCurrent, 1);
			// the same two wallboxes in the opposite order hand the surplus to the other one
			const [threePhaseFirst, singlePhaseSecond] = decideChargeManagerFleet(tight, [box(), box({ phases: 1 })]);
			assert.equal(threePhaseFirst.optimalCurrent, 7);
			assert.equal(singlePhaseSecond.optimalCurrent, 0);
		});

		it("reserves nothing for a wallbox without a connected vehicle", () => {
			const [idle, waiting] = decideChargeManagerFleet(shared, [box({ claimsPower: false }), box()]);
			// the empty box still gets its regular decision, but must not starve its neighbour
			assert.equal(idle.optimalCurrent, 14);
			assert.equal(waiting.optimalCurrent, 14);
		});

		it("reserves the target of a wallbox that is still ramping up", () => {
			// a box at 1 A already claims its full 14 A target, so the second box sees nothing
			const [, second] = decideChargeManagerFleet(shared, [box({ state: { currentAmp: 1, shutdownDelay: 0 } }), box()]);
			assert.equal(second.optimalCurrent, 0);
		});

		it("keeps reserving for a wallbox that is ramping down", () => {
			// surplus is gone, but the first box still physically draws 10 A while ramping down
			const gone = { ...shared, solarPower: 1000 };
			const [first, second] = decideChargeManagerFleet(gone, [box({ state: { currentAmp: 10, shutdownDelay: 0 } }), box()]);
			assert.equal(first.nextState.currentAmp, 9);
			assert.equal(second.optimalCurrent, 0);
		});

		it("splits across different phase counts by power, not by current", () => {
			// 9900 W: the single-phase box takes 16 A (3680 W), leaving 6220 W = 9 A on three phases
			const [singlePhase, threePhase] = decideChargeManagerFleet(shared, [box({ phases: 1 }), box()]);
			assert.equal(singlePhase.optimalCurrent, 16);
			assert.equal(threePhase.optimalCurrent, 9);
		});

		it("adds the whole fleet back when the chargers are part of the household consumption", () => {
			// house includes both chargers drawing 5000 W in total; without adding them back
			// the fleet would see no surplus at all
			const included = { ...shared, solarPower: 11000, houseConsumption: 6000, chargerPower: 5000, subtractChargerPower: true };
			const [first] = decideChargeManagerFleet(included, [box(), box()]);
			assert.equal(first.optimalCurrent, 14);
		});

		it("returns one decision per participant and none for an empty fleet", () => {
			assert.deepEqual(decideChargeManagerFleet(shared, []), []);
			assert.equal(decideChargeManagerFleet(shared, [box(), box(), box()]).length, 3);
		});

		it("disables every wallbox when the shared inputs are invalid", () => {
			const broken = { ...shared, solarPower: Number.NaN };
			for (const decision of decideChargeManagerFleet(broken, [box(), box()])) {
				assert.equal(decision.action, "disable");
				assert.equal(decision.reason, "invalid-input");
				assert.equal(decision.optimalCurrent, null);
			}
		});
	});

	describe("decidePhaseSwitch", () => {
		const threePhaseMinPower = MIN_CHARGE_CURRENT * 3 * PHASE_VOLTAGE; // 4140 W - three phases at the 6 A minimum
		const onePhaseMaxPower = 32 * PHASE_VOLTAGE; // 7360 W - up threshold for a 32 A box
		const input = (overrides: Partial<Parameters<typeof decidePhaseSwitch>[0]> = {}): Parameters<typeof decidePhaseSwitch>[0] => ({
			currentPhases: 1,
			availablePower: 0,
			minimumChargeCurrent: MIN_CHARGE_CURRENT,
			maximumChargeCurrent: 32,
			switchDelay: 0,
			...overrides,
		});

		it("stays in the hysteresis band without switching", () => {
			// between the three-phase minimum and the one-phase maximum neither direction switches
			const mid = (threePhaseMinPower + onePhaseMaxPower) / 2;
			assert.deepEqual(decidePhaseSwitch(input({ currentPhases: 1, availablePower: mid })), { targetPhases: 1, switchDelay: 0 });
			assert.deepEqual(decidePhaseSwitch(input({ currentPhases: 3, availablePower: mid })), { targetPhases: 3, switchDelay: 0 });
		});

		it("switches up to three phases only after the dwell time", () => {
			let state = input({ currentPhases: 1, availablePower: onePhaseMaxPower });
			for (let cycle = 0; cycle < PHASE_SWITCH_DELAY_CYCLES; cycle++) {
				const decision = decidePhaseSwitch(state);
				assert.equal(decision.targetPhases, 1); // still waiting out the dwell
				assert.equal(decision.switchDelay, cycle + 1);
				state = { ...state, switchDelay: decision.switchDelay };
			}
			const final = decidePhaseSwitch(state);
			assert.equal(final.targetPhases, 3);
			assert.equal(final.switchDelay, 0);
		});

		it("switches down to one phase when the surplus can no longer sustain three phases", () => {
			let state = input({ currentPhases: 3, availablePower: threePhaseMinPower - 1 });
			for (let cycle = 0; cycle < PHASE_SWITCH_DELAY_CYCLES; cycle++) {
				state = { ...state, switchDelay: decidePhaseSwitch(state).switchDelay };
			}
			assert.equal(decidePhaseSwitch(state).targetPhases, 1);
		});

		it("resets the dwell counter when the condition disappears", () => {
			const pending = decidePhaseSwitch(input({ currentPhases: 1, availablePower: onePhaseMaxPower, switchDelay: 5 }));
			assert.equal(pending.switchDelay, 6);
			// surplus falls back into the band before the dwell elapsed
			assert.deepEqual(decidePhaseSwitch(input({ currentPhases: 1, availablePower: threePhaseMinPower + 1, switchDelay: 6 })), {
				targetPhases: 1,
				switchDelay: 0,
			});
		});

		it("never inverts the band when the one-phase maximum is below the three-phase minimum", () => {
			// a 16 A box: one-phase max 3680 W < three-phase min 4140 W -> up threshold floored at 4140 W
			const smallBox = { minimumChargeCurrent: MIN_CHARGE_CURRENT, maximumChargeCurrent: 16 };
			// just below the three-phase minimum: no up-switch even with the dwell already elapsed
			assert.equal(
				decidePhaseSwitch(input({ ...smallBox, currentPhases: 1, availablePower: threePhaseMinPower - 1, switchDelay: PHASE_SWITCH_DELAY_CYCLES }))
					.targetPhases,
				1,
			);
			// at the three-phase minimum: the up-switch fires
			assert.equal(
				decidePhaseSwitch(input({ ...smallBox, currentPhases: 1, availablePower: threePhaseMinPower, switchDelay: PHASE_SWITCH_DELAY_CYCLES }))
					.targetPhases,
				3,
			);
		});

		it("leaves invalid inputs untouched", () => {
			assert.deepEqual(decidePhaseSwitch(input({ currentPhases: 2, availablePower: 10000 })), { targetPhases: 2, switchDelay: 0 });
			assert.equal(decidePhaseSwitch(input({ currentPhases: 1, availablePower: Number.NaN, switchDelay: 3 })).targetPhases, 1);
		});
	});

	describe("limitTotalCurrent", () => {
		const box = (requestedAmp: number, minAmp = MIN_CHARGE_CURRENT, chargeNow = false): TotalCurrentParticipant => ({
			requestedAmp,
			minAmp,
			chargeNow,
		});

		it("passes every request through when the budget is disabled", () => {
			for (const budget of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
				assert.deepEqual(limitTotalCurrent([box(16), box(10)], budget), [
					{ allow: true, ampere: 16 },
					{ allow: true, ampere: 10 },
				]);
			}
		});

		it("keeps a single wallbox unchanged when it fits the budget", () => {
			assert.deepEqual(limitTotalCurrent([box(16)], 20), [{ allow: true, ampere: 16 }]);
		});

		it("caps a single wallbox that alone exceeds the whole budget", () => {
			assert.deepEqual(limitTotalCurrent([box(32)], 16), [{ allow: true, ampere: 16 }]);
		});

		it("throttles the wallbox that no longer fits and switches off the one below its minimum", () => {
			// three boxes want 16 A each against a 25 A budget: 16 fits, 9 throttled, nothing left for the third
			assert.deepEqual(limitTotalCurrent([box(16), box(16), box(16)], 25), [
				{ allow: true, ampere: 16 },
				{ allow: true, ampere: 9 },
				{ allow: false, ampere: 0 },
			]);
		});

		it("respects the per-box minimum when throttling", () => {
			// 20 A budget, first takes 16, only 4 A left which is below the 6 A minimum -> second off
			assert.deepEqual(limitTotalCurrent([box(16), box(10)], 20), [
				{ allow: true, ampere: 16 },
				{ allow: false, ampere: 0 },
			]);
		});

		it("serves ChargeNOW before ChargeManager regardless of list order", () => {
			// list order is manager-first, but the ChargeNOW box is served first and claims the budget;
			// only 4 A remain for the manager box, below its 6 A minimum, so it is switched off
			const result = limitTotalCurrent([box(16, MIN_CHARGE_CURRENT, false), box(16, MIN_CHARGE_CURRENT, true)], 20);
			assert.deepEqual(result, [
				{ allow: false, ampere: 0 },
				{ allow: true, ampere: 16 },
			]);
		});

		it("keeps the fuse safe when several idle ChargeNOW boxes are plugged in at once (cold start)", () => {
			// three ChargeNOW boxes each requesting 16 A against a 20 A feed: total draw must never exceed 20 A
			const result = limitTotalCurrent([box(16, 6, true), box(16, 6, true), box(16, 6, true)], 20);
			const totalDraw = result.reduce((sum, r) => sum + r.ampere, 0);
			assert.ok(totalDraw <= 20, `total draw ${totalDraw} A must stay within the 20 A budget`);
			assert.deepEqual(result, [
				{ allow: true, ampere: 16 },
				{ allow: false, ampere: 0 },
				{ allow: false, ampere: 0 },
			]);
		});

		it("skips wallboxes that are not charging without consuming budget", () => {
			assert.deepEqual(limitTotalCurrent([box(0), box(16)], 16), [
				{ allow: false, ampere: 0 },
				{ allow: true, ampere: 16 },
			]);
		});

		it("handles the prepared 10/16/20 A example under a 15 A installation budget", () => {
			// per-box maxima already resolved to 10/16/20; here they request those, capped to a 15 A total
			const result = limitTotalCurrent([box(10), box(16), box(20)], 15);
			assert.deepEqual(result, [
				{ allow: true, ampere: 10 },
				{ allow: false, ampere: 0 },
				{ allow: false, ampere: 0 },
			]);
			assert.ok(result.reduce((sum, r) => sum + r.ampere, 0) <= 15);
		});
	});

	describe("effectiveCurrentDemand", () => {
		const base = { commandedAmp: 16, measuredAmp: 16, wishAmp: 16, minAmp: 6, maxAmp: 16, reclaimDelay: 0 };

		it("reserves the wish while the vehicle is not drawing yet (cold start)", () => {
			// measured below the technical minimum = not really charging -> keep the full reservation
			assert.deepEqual(effectiveCurrentDemand({ ...base, commandedAmp: 10, measuredAmp: 0, wishAmp: 16 }), { demand: 16, reclaimDelay: 0 });
			assert.deepEqual(effectiveCurrentDemand({ ...base, commandedAmp: 10, measuredAmp: 3, wishAmp: 16 }), { demand: 16, reclaimDelay: 0 });
		});

		it("offers one step more when the vehicle draws everything it is allowed", () => {
			// drawing 9 at a 9 A command, wants 16 -> offer 10, no reclaim pending
			assert.deepEqual(effectiveCurrentDemand({ ...base, commandedAmp: 9, measuredAmp: 9, wishAmp: 16 }), { demand: 10, reclaimDelay: 0 });
		});

		it("never offers more than the wish or the maximum", () => {
			assert.deepEqual(effectiveCurrentDemand({ ...base, commandedAmp: 16, measuredAmp: 16, wishAmp: 16, maxAmp: 16 }), { demand: 16, reclaimDelay: 0 });
			assert.deepEqual(effectiveCurrentDemand({ ...base, commandedAmp: 10, measuredAmp: 10, wishAmp: 10 }), { demand: 10, reclaimDelay: 0 });
		});

		it("holds inside the deadband and resets the dwell counter", () => {
			// measured one amp below the command = satisfied/stable -> hold, no reclaim
			assert.deepEqual(effectiveCurrentDemand({ ...base, commandedAmp: 10, measuredAmp: 9, wishAmp: 16, reclaimDelay: 2 }), {
				demand: 10,
				reclaimDelay: 0,
			});
		});

		it("holds the reservation while confirming a sustained under-draw", () => {
			// commanded 16, only drawing 8: count up but keep reserving 16 until the dwell elapses
			let delay = 0;
			for (let cycle = 1; cycle <= RECLAIM_DELAY_CYCLES; cycle++) {
				const r = effectiveCurrentDemand({ ...base, commandedAmp: 16, measuredAmp: 8, wishAmp: 16, reclaimDelay: delay });
				assert.equal(r.demand, 16, `cycle ${cycle} should still reserve the full command`);
				assert.equal(r.reclaimDelay, cycle);
				delay = r.reclaimDelay;
			}
		});

		it("reclaims to measured + headroom once the under-draw is sustained", () => {
			// after the dwell, reserve only 8 + 1 = 9 and free the rest
			const r = effectiveCurrentDemand({ ...base, commandedAmp: 16, measuredAmp: 8, wishAmp: 16, reclaimDelay: RECLAIM_DELAY_CYCLES });
			assert.equal(r.demand, 9);
			assert.ok(r.reclaimDelay > RECLAIM_DELAY_CYCLES);
		});

		it("parks stably at the vehicle limit without flapping", () => {
			// after reclaiming to 9, the vehicle keeps drawing 8 -> hold at 9 (measured within the deadband), no re-reclaim
			const r = effectiveCurrentDemand({ ...base, commandedAmp: 9, measuredAmp: 8, wishAmp: 16, reclaimDelay: 0 });
			assert.deepEqual(r, { demand: 9, reclaimDelay: 0 });
		});

		it("never reclaims below the per-box minimum", () => {
			// drawing 4 A (abnormally low) against a 6 A minimum -> floor the demand at the minimum
			const r = effectiveCurrentDemand({ ...base, commandedAmp: 16, measuredAmp: 4, wishAmp: 16, minAmp: 6, reclaimDelay: RECLAIM_DELAY_CYCLES });
			// measured 4 is below MIN_CHARGE_CURRENT -> treated as "not drawing", reserves the wish
			assert.equal(r.demand, 16);
		});

		it("falls back to the wish on invalid input", () => {
			assert.deepEqual(effectiveCurrentDemand({ ...base, measuredAmp: Number.NaN, wishAmp: 12 }), { demand: 12, reclaimDelay: 0 });
		});
	});
});
