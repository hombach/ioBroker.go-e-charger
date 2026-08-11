export const MIN_CHARGE_CURRENT = 6;
export const MAX_CHARGE_CURRENT = 32;
export const START_CHARGE_CURRENT = 10;
export const SHUTDOWN_DELAY_CYCLES = 12;
export const DEFAULT_RESERVE_POWER = 100;
export const DEFAULT_MAXIMUM_BATTERY_BONUS = 2000;

/** Supported ways of incorporating a home battery into surplus charging. */
export type BatteryMode = "disabled" | "minimumSoc" | "priority";

/** Input used to decide whether the configured battery permits EV charging. */
export interface BatteryAvailabilityInput {
	/** Configured home-battery mode */
	mode: BatteryMode;
	/** Untrusted SOC state value */
	batterySoc: unknown;
	/** Untrusted minimum SOC state value */
	minimumBatterySoc: unknown;
	/** Age of the SOC state in milliseconds */
	batterySocAgeMs: number | null;
	/** Maximum accepted SOC age in seconds; zero disables the age check */
	maximumAgeSeconds: number;
	/** Configured SOC stop hysteresis */
	hysteresis: number;
	/** Whether the battery permitted charging in the previous cycle */
	wasReady: boolean;
}

/** Stable explanation for a battery availability decision. */
export type BatteryAvailabilityReason = "available" | "below-minimum" | "disabled" | "invalid" | "stale";

/** Validated battery state used by the ChargeManager. */
export interface BatteryAvailabilityDecision {
	/** Whether surplus charging may continue */
	ready: boolean;
	/** Explanation for the battery decision */
	reason: BatteryAvailabilityReason;
	/** Validated SOC, or null when unavailable or disabled */
	batterySoc: number | null;
}

/** Inputs used by the current surplus calculation. */
export interface ChargeCalculationInput {
	/** Current PV generation in watts */
	solarPower: number;
	/** Current household consumption in watts */
	houseConsumption: number;
	/** Current charger consumption in watts */
	chargerPower: number;
	/** Whether charger consumption is already part of household consumption */
	subtractChargerPower: boolean;
	/** Current home battery state of charge, or null when battery handling is disabled */
	batterySoc: number | null;
	/** Minimum home battery state of charge */
	minBatterySoc: number;
	/** Home-battery handling strategy */
	batteryMode: BatteryMode;
	/** Power kept as a grid reserve in watts */
	reservePower: number;
	/** Maximum power released by the priority battery curve in watts */
	maximumBatteryBonus: number;
	/** Highest current the ChargeManager may assign */
	maximumChargeCurrent: number;
	/** Number of active charging phases */
	phases: number;
}

/** Internal state carried between ChargeManager control cycles. */
export interface ChargeManagerState {
	/** Current ramped charging-current target */
	currentAmp: number;
	/** Number of consecutive cycles below the minimum charging current */
	shutdownDelay: number;
}

/** Inputs required for one deterministic ChargeManager control decision. */
export interface ChargeManagerControllerInput extends ChargeCalculationInput {
	/** Current below which the shutdown delay advances */
	minimumChargeCurrent: number;
	/** Internal state from the previous control cycle */
	state: ChargeManagerState;
}

/** Transport action requested by the ChargeManager controller. */
export type ChargeManagerAction = "enable" | "disable" | "hold";

/** Stable explanation for a ChargeManager control decision. */
export type ChargeManagerReason = "charging-current" | "hysteresis" | "insufficient-surplus" | "invalid-input" | "shutdown-delay";

/** Result of one deterministic ChargeManager control cycle. */
export interface ChargeManagerDecision {
	/** Charger transport action; `hold` sends no command */
	action: ChargeManagerAction;
	/** Explanation for the selected action */
	reason: ChargeManagerReason;
	/** Newly calculated current before applying the one-ampere ramp */
	optimalCurrent: number | null;
	/** Internal state to retain for the next control cycle */
	nextState: ChargeManagerState;
}

/** One validated go-e API command. */
export interface ChargerCommand {
	/** go-e API parameter */
	parameter: "alw" | "amp" | "amx";
	/** Numeric go-e API parameter value */
	value: number;
}

/**
 * Validates battery data and applies the configured minimum-SOC hysteresis.
 *
 * The hysteresis only widens the range in which an already running controller
 * keeps charging, so a battery hovering around its minimum SOC does not toggle
 * the charge release every cycle.
 *
 * @param input Battery configuration, measurement, and previous readiness
 * @returns Whether EV surplus charging may proceed
 */
export function evaluateBatteryAvailability(input: BatteryAvailabilityInput): BatteryAvailabilityDecision {
	if (input.mode === "disabled") {
		return { ready: true, reason: "disabled", batterySoc: null };
	}
	if (
		typeof input.batterySoc !== "number" ||
		!Number.isFinite(input.batterySoc) ||
		input.batterySoc < 0 ||
		input.batterySoc > 100 ||
		typeof input.minimumBatterySoc !== "number" ||
		!Number.isFinite(input.minimumBatterySoc) ||
		input.minimumBatterySoc < 0 ||
		input.minimumBatterySoc > 100
	) {
		return { ready: false, reason: "invalid", batterySoc: null };
	}
	if (
		input.maximumAgeSeconds > 0 &&
		(input.batterySocAgeMs === null ||
			!Number.isFinite(input.batterySocAgeMs) ||
			input.batterySocAgeMs < 0 ||
			input.batterySocAgeMs > input.maximumAgeSeconds * 1000)
	) {
		return { ready: false, reason: "stale", batterySoc: input.batterySoc };
	}

	const stopThreshold = Math.max(0, input.minimumBatterySoc - input.hysteresis);
	const ready = input.wasReady ? input.batterySoc >= stopThreshold : input.batterySoc >= input.minimumBatterySoc;
	return {
		ready,
		reason: ready ? "available" : "below-minimum",
		batterySoc: input.batterySoc,
	};
}

/**
 * Calculates the optimal charging current and keeps the internal controller
 * target within its valid range. A target of 0 A means that charging should be
 * disabled; it must never be sent to the charger as a current setting.
 *
 * @param input Current energy-management inputs
 * @returns A target between 0 and the configured maximum, or `null` if an input is invalid
 */
export function calculateOptimalChargeCurrent(input: ChargeCalculationInput): number | null {
	const numericInputs = [
		input.solarPower,
		input.houseConsumption,
		input.chargerPower,
		input.reservePower,
		input.maximumBatteryBonus,
		input.maximumChargeCurrent,
		input.phases,
	];
	if (!numericInputs.every(value => Number.isFinite(value))) {
		return null;
	}
	if (
		(input.phases !== 1 && input.phases !== 3) ||
		input.reservePower < 0 ||
		input.maximumBatteryBonus < 0 ||
		!Number.isInteger(input.maximumChargeCurrent) ||
		input.maximumChargeCurrent < START_CHARGE_CURRENT ||
		input.maximumChargeCurrent > MAX_CHARGE_CURRENT
	) {
		return null;
	}
	// a disabled home battery contributes nothing, so its SOC is allowed to be absent
	if (
		input.batteryMode !== "disabled" &&
		(input.batterySoc === null ||
			!Number.isFinite(input.batterySoc) ||
			input.batterySoc < 0 ||
			input.batterySoc > 100 ||
			!Number.isFinite(input.minBatterySoc) ||
			input.minBatterySoc < 0 ||
			input.minBatterySoc > 100)
	) {
		return null;
	}

	// only the priority mode releases battery power to the EV; the bonus never turns negative
	// below the minimum SOC, that range is handled by evaluateBatteryAvailability instead
	const batteryOffset =
		input.batteryMode === "priority" && input.batterySoc !== null && input.minBatterySoc < 100
			? Math.max(0, (input.maximumBatteryBonus / (100 - input.minBatterySoc)) * (input.batterySoc - input.minBatterySoc))
			: 0;
	const availablePower =
		input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - input.reservePower + batteryOffset;
	const calculatedCurrent = Math.floor(availablePower / 230 / input.phases);

	return Math.max(0, Math.min(calculatedCurrent, input.maximumChargeCurrent));
}

/**
 * Moves the internal target current by at most one ampere per control cycle.
 *
 * @param current Previous internal target
 * @param target Newly calculated target
 * @param maximum Maximum current allowed by the ChargeManager
 * @returns A finite target between 0 and the configured maximum
 */
export function stepChargeCurrent(current: number, target: number, maximum = MAX_CHARGE_CURRENT): number {
	const safeMaximum = Number.isInteger(maximum) && maximum >= MIN_CHARGE_CURRENT && maximum <= MAX_CHARGE_CURRENT ? maximum : MAX_CHARGE_CURRENT;
	const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(Math.trunc(current), safeMaximum)) : 0;
	const safeTarget = Number.isFinite(target) ? Math.max(0, Math.min(Math.trunc(target), safeMaximum)) : 0;

	if (safeCurrent < safeTarget) {
		return safeCurrent + 1;
	}
	if (safeCurrent > safeTarget) {
		return safeCurrent - 1;
	}
	return safeCurrent;
}

/**
 * Advances the consecutive insufficient-surplus counter and resets it as soon
 * as the minimum charging current is available again.
 *
 * @param current Current internal charging target
 * @param minimum Minimum charger current
 * @param previousDelay Previous insufficient-surplus cycle count
 * @returns Updated consecutive insufficient-surplus cycle count
 */
export function updateShutdownDelay(current: number, minimum: number, previousDelay: number): number {
	if (!Number.isFinite(current) || !Number.isFinite(minimum) || current >= minimum) {
		return 0;
	}
	const safePreviousDelay = Number.isFinite(previousDelay) ? Math.max(0, Math.trunc(previousDelay)) : 0;
	return safePreviousDelay + 1;
}

/**
 * Produces the complete ChargeManager decision for one control cycle without
 * reading ioBroker states or sending charger commands.
 *
 * The function intentionally preserves the existing controller behavior:
 * current changes by at most 1 A per cycle, charging starts at 10 A, and an
 * insufficient-surplus shutdown happens after 12 completed delay cycles.
 *
 * @param input Current measurements and previous controller state
 * @returns Requested transport action and state for the next cycle
 */
export function decideChargeManager(input: ChargeManagerControllerInput): ChargeManagerDecision {
	const optimalCurrent = calculateOptimalChargeCurrent(input);
	if (
		optimalCurrent === null ||
		!Number.isInteger(input.minimumChargeCurrent) ||
		input.minimumChargeCurrent < MIN_CHARGE_CURRENT ||
		input.minimumChargeCurrent > input.maximumChargeCurrent
	) {
		return {
			action: "disable",
			reason: "invalid-input",
			optimalCurrent: null,
			nextState: { currentAmp: 0, shutdownDelay: 0 },
		};
	}

	const currentAmp = stepChargeCurrent(input.state.currentAmp, optimalCurrent, input.maximumChargeCurrent);
	const startChargeCurrent = Math.max(START_CHARGE_CURRENT, input.minimumChargeCurrent);
	// while ramping up to a raised minimum current the target is briefly below the minimum;
	// do not count that as an insufficient-surplus cycle
	const isRampingToRaisedMinimum =
		input.minimumChargeCurrent > START_CHARGE_CURRENT && optimalCurrent >= input.minimumChargeCurrent && currentAmp < input.minimumChargeCurrent;
	let shutdownDelay = isRampingToRaisedMinimum ? 0 : updateShutdownDelay(currentAmp, input.minimumChargeCurrent, input.state.shutdownDelay);

	if (currentAmp >= startChargeCurrent) {
		return {
			action: "enable",
			reason: "charging-current",
			optimalCurrent,
			nextState: { currentAmp, shutdownDelay },
		};
	}

	if (currentAmp < input.minimumChargeCurrent) {
		if (shutdownDelay > SHUTDOWN_DELAY_CYCLES) {
			shutdownDelay = 0;
			return {
				action: "disable",
				reason: "insufficient-surplus",
				optimalCurrent,
				nextState: { currentAmp, shutdownDelay },
			};
		}

		return {
			action: "hold",
			reason: "shutdown-delay",
			optimalCurrent,
			nextState: { currentAmp, shutdownDelay },
		};
	}

	return {
		action: "hold",
		reason: "hysteresis",
		optimalCurrent,
		nextState: { currentAmp, shutdownDelay },
	};
}

/**
 * Builds a safe sequence of commands for the go-e Charger.
 *
 * When charging is enabled, the current is configured before the charge
 * release. Disabling only revokes the release and never sends an invalid
 * sub-minimum current.
 *
 * @param allow Whether charging should be enabled
 * @param ampere Requested charging current
 * @param firmware Charger firmware version
 * @returns Ordered charger commands, or `null` for an invalid request
 */
export function buildChargerCommands(allow: boolean, ampere: number, firmware: string): ChargerCommand[] | null {
	if (!allow) {
		return [{ parameter: "alw", value: 0 }];
	}
	if (!Number.isInteger(ampere) || ampere < MIN_CHARGE_CURRENT || ampere > MAX_CHARGE_CURRENT) {
		return null;
	}

	return [
		{ parameter: firmware === "033" ? "amp" : "amx", value: ampere },
		{ parameter: "alw", value: 1 },
	];
}
