export const MIN_CHARGE_CURRENT = 6;
export const MAX_CHARGE_CURRENT = 16;
export const START_CHARGE_CURRENT = 10;
export const SHUTDOWN_DELAY_CYCLES = 12;
export const DEFAULT_RESERVE_POWER = 100;
export const DEFAULT_MAXIMUM_BATTERY_BONUS = 2000;

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
	/** Current home battery state of charge */
	batterySoc: number;
	/** Minimum home battery state of charge */
	minBatterySoc: number;
	/** Power kept as a grid reserve in watts */
	reservePower: number;
	/** Maximum power released by the priority battery curve in watts */
	maximumBatteryBonus: number;
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
 * Calculates the optimal charging current and keeps the internal controller
 * target within its valid range. A target of 0 A means that charging should be
 * disabled; it must never be sent to the charger as a current setting.
 *
 * @param input Current energy-management inputs
 * @returns A target between 0 and 16 A, or `null` if an input is invalid
 */
export function calculateOptimalChargeCurrent(input: ChargeCalculationInput): number | null {
	const numericInputs = [
		input.solarPower,
		input.houseConsumption,
		input.chargerPower,
		input.batterySoc,
		input.minBatterySoc,
		input.reservePower,
		input.maximumBatteryBonus,
		input.phases,
	];
	if (!numericInputs.every(value => Number.isFinite(value))) {
		return null;
	}
	if (
		(input.phases !== 1 && input.phases !== 3) ||
		input.batterySoc < 0 ||
		input.batterySoc > 100 ||
		input.minBatterySoc < 0 ||
		input.minBatterySoc > 100 ||
		input.reservePower < 0 ||
		input.maximumBatteryBonus < 0
	) {
		return null;
	}

	const batteryOffset = input.minBatterySoc < 100 ? (input.maximumBatteryBonus / (100 - input.minBatterySoc)) * (input.batterySoc - input.minBatterySoc) : 0;
	const availablePower =
		input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - input.reservePower + batteryOffset;
	const calculatedCurrent = Math.floor(availablePower / 230 / input.phases);

	return Math.max(0, Math.min(calculatedCurrent, MAX_CHARGE_CURRENT));
}

/**
 * Moves the internal target current by at most one ampere per control cycle.
 *
 * @param current Previous internal target
 * @param target Newly calculated target
 * @returns A finite target between 0 and 16 A
 */
export function stepChargeCurrent(current: number, target: number): number {
	const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(Math.trunc(current), MAX_CHARGE_CURRENT)) : 0;
	const safeTarget = Number.isFinite(target) ? Math.max(0, Math.min(Math.trunc(target), MAX_CHARGE_CURRENT)) : 0;

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
	if (optimalCurrent === null) {
		return {
			action: "disable",
			reason: "invalid-input",
			optimalCurrent: null,
			nextState: { currentAmp: 0, shutdownDelay: 0 },
		};
	}

	const currentAmp = stepChargeCurrent(input.state.currentAmp, optimalCurrent);
	let shutdownDelay = updateShutdownDelay(currentAmp, MIN_CHARGE_CURRENT, input.state.shutdownDelay);

	if (currentAmp >= START_CHARGE_CURRENT) {
		return {
			action: "enable",
			reason: "charging-current",
			optimalCurrent,
			nextState: { currentAmp, shutdownDelay },
		};
	}

	if (currentAmp < MIN_CHARGE_CURRENT) {
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
