import { strict as assert } from "node:assert";
import {
	buildChargerCommands,
	calculateOptimalChargeCurrent,
	type ChargeManagerControllerInput,
	decideChargeManager,
	decideChargeManagerFleet,
	evaluateBatteryAvailability,
	type FleetParticipant,
	MAX_CHARGE_CURRENT,
	MIN_CHARGE_CURRENT,
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
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumChargeCurrent: START_CHARGE_CURRENT - 1 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumChargeCurrent: MAX_CHARGE_CURRENT + 1 }), null);
			assert.equal(calculateOptimalChargeCurrent({ ...validInput, maximumChargeCurrent: 12.5 }), null);
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
			assert.deepEqual(decideChargeManagerFleet(shared, [single]), [expected]);
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
});
