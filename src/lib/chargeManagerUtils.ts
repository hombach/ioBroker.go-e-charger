export const MIN_CHARGE_CURRENT = 6;
export const MAX_CHARGE_CURRENT = 32;
export const START_CHARGE_CURRENT = 10;
export const SHUTDOWN_DELAY_CYCLES = 12;
export const DEFAULT_RESERVE_POWER = 100;
export const DEFAULT_MAXIMUM_BATTERY_BONUS = 2000;
/** Nominal voltage per phase used to convert between charging current and power */
export const PHASE_VOLTAGE = 230;
/** Number of consecutive cycles a phase-switch condition must hold before the phase is actually switched */
export const PHASE_SWITCH_DELAY_CYCLES = 12;

/** Per-wallbox configuration and optional hardware caps used to resolve its current limits. */
export interface WallboxLimitInput {
	/** Installation-wide maximum current (maxChargeCurrent); caps every wallbox */
	installationMaxCurrent: number;
	/** User-configured maximum current for this wallbox; 0 (or invalid) means no per-box limit */
	configuredMaxCurrent: number;
	/** User-configured minimum current for this wallbox; 0 (or invalid) means the technical floor */
	configuredMinCurrent: number;
	/** Maximum current the charger hardware accepts, or null when unknown */
	hardwareMaxCurrent: number | null;
	/** Minimum current the charger hardware accepts, or null when unknown */
	hardwareMinCurrent: number | null;
}

/** Effective per-wallbox current limits, both integers within [MIN_CHARGE_CURRENT, MAX_CHARGE_CURRENT]. */
export interface WallboxCurrentLimits {
	/** Lowest current that may be assigned to this wallbox */
	minCurrent: number;
	/** Highest current that may be assigned to this wallbox */
	maxCurrent: number;
}

/**
 * Resolves the effective minimum and maximum charging current for a single wallbox.
 *
 * The maximum is the tightest of the installation limit, the user-configured per-box
 * maximum and the hardware capability; the minimum is the highest of the technical floor,
 * the user-configured per-box minimum and the hardware minimum. A value of 0 (or any
 * non-positive / non-finite value) for a configured or hardware bound means "not set" and
 * is ignored. The minimum can never exceed the resolved maximum, and both results are
 * clamped to the globally supported [MIN_CHARGE_CURRENT, MAX_CHARGE_CURRENT] range.
 *
 * @param input Installation limit, user configuration and optional hardware caps
 * @returns The effective per-wallbox current limits
 */
export function resolveWallboxCurrentLimits(input: WallboxLimitInput): WallboxCurrentLimits {
	const isUsable = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

	const installationMax =
		Number.isFinite(input.installationMaxCurrent) && input.installationMaxCurrent > 0 ? Math.floor(input.installationMaxCurrent) : MAX_CHARGE_CURRENT;

	const maxCandidates = [installationMax];
	if (isUsable(input.configuredMaxCurrent)) {
		maxCandidates.push(Math.floor(input.configuredMaxCurrent));
	}
	if (isUsable(input.hardwareMaxCurrent)) {
		maxCandidates.push(Math.floor(input.hardwareMaxCurrent));
	}
	const maxCurrent = Math.min(MAX_CHARGE_CURRENT, Math.max(MIN_CHARGE_CURRENT, Math.min(...maxCandidates)));

	const minCandidates = [MIN_CHARGE_CURRENT];
	if (isUsable(input.configuredMinCurrent)) {
		minCandidates.push(Math.floor(input.configuredMinCurrent));
	}
	if (isUsable(input.hardwareMinCurrent)) {
		minCandidates.push(Math.floor(input.hardwareMinCurrent));
	}
	// the minimum can never exceed the resolved maximum
	const minCurrent = Math.min(maxCurrent, Math.max(...minCandidates));

	return { minCurrent, maxCurrent };
}

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
 * Calculates the PV surplus power in watts that may be used for charging, independent of the
 * phase count. This is the numerator behind {@link calculateOptimalChargeCurrent} and is also
 * used to decide one-/three-phase switching, where the power - not the current - is the signal.
 *
 * @param input Current energy-management inputs without the per-wallbox current and phase count
 * @returns The available surplus power in watts, or `null` if an input is invalid
 */
export function calculateAvailableSurplusPower(input: FleetSurplusInput): number | null {
	const numericInputs = [input.solarPower, input.houseConsumption, input.chargerPower, input.reservePower, input.maximumBatteryBonus];
	if (!numericInputs.every(value => Number.isFinite(value)) || input.reservePower < 0 || input.maximumBatteryBonus < 0) {
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
	return input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - input.reservePower + batteryOffset;
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
	if (
		!Number.isFinite(input.phases) ||
		!Number.isFinite(input.maximumChargeCurrent) ||
		(input.phases !== 1 && input.phases !== 3) ||
		!Number.isInteger(input.maximumChargeCurrent) ||
		// a per-wallbox limit may legitimately sit below the 10 A start current, e.g. an 8 A
		// coded cable, so only the technical floor makes a maximum invalid
		input.maximumChargeCurrent < MIN_CHARGE_CURRENT ||
		input.maximumChargeCurrent > MAX_CHARGE_CURRENT
	) {
		return null;
	}
	const availablePower = calculateAvailableSurplusPower(input);
	if (availablePower === null) {
		return null;
	}
	const calculatedCurrent = Math.floor(availablePower / PHASE_VOLTAGE / input.phases);

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
	// charging starts at 10 A to keep the release from flapping around the 6 A minimum, but a
	// wallbox that is capped below that can never reach 10 A - it starts at its own maximum
	const startChargeCurrent = Math.min(Math.max(START_CHARGE_CURRENT, input.minimumChargeCurrent), input.maximumChargeCurrent);
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

/** One wallbox taking part in the shared surplus allocation. */
export interface FleetParticipant {
	/** Number of active charging phases */
	phases: number;
	/** Lowest current the ChargeManager may assign to this wallbox */
	minimumChargeCurrent: number;
	/** Highest current the ChargeManager may assign to this wallbox */
	maximumChargeCurrent: number;
	/** Internal controller state from the previous cycle */
	state: ChargeManagerState;
	/**
	 * Whether this wallbox can actually consume power right now (a vehicle is connected).
	 * A wallbox without a vehicle still gets its regular decision but reserves nothing,
	 * so it never starves a wallbox that has a car waiting.
	 */
	claimsPower: boolean;
}

/** Shared measurements for one fleet-wide ChargeManager cycle; the per-wallbox parts live in {@link FleetParticipant}. */
export type FleetSurplusInput = Omit<ChargeCalculationInput, "maximumChargeCurrent" | "phases">;

/** A per-wallbox {@link ChargeManagerDecision} plus the raw surplus power it was offered, for the phase-switch decision. */
export interface FleetChargeDecision extends ChargeManagerDecision {
	/** PV surplus power in watts available to this wallbox at its current phase count (0 when the inputs are invalid) */
	availablePower: number;
}

/**
 * Splits the available PV surplus across several wallboxes and returns one control
 * decision per wallbox.
 *
 * The surplus is a single shared resource: without coordination every wallbox would
 * calculate its target from the full surplus and they would collectively draw far more
 * than is available. Wallboxes are served in list order, so the first entry has the
 * highest priority and later ones only see what is left over. The power a wallbox is
 * entitled to is reserved even while it is still ramping up, otherwise the next wallbox
 * would claim the same watts for one cycle and both would overshoot.
 *
 * `chargerPower` in `shared` must be the summed consumption of all coordinated wallboxes,
 * so that `subtractChargerPower` adds the whole fleet back to the household consumption.
 *
 * A single participant receives exactly the result of {@link decideChargeManager}.
 *
 * @param shared Measurements and configuration common to every wallbox
 * @param participants Wallboxes to serve, highest priority first
 * @returns One decision per participant, in the same order
 */
export function decideChargeManagerFleet(shared: FleetSurplusInput, participants: FleetParticipant[]): FleetChargeDecision[] {
	let claimedPower = 0;

	return participants.map(participant => {
		// later wallboxes only see the surplus the earlier ones did not claim
		const surplus: FleetSurplusInput = { ...shared, solarPower: shared.solarPower - claimedPower };
		const decision = decideChargeManager({
			...surplus,
			maximumChargeCurrent: participant.maximumChargeCurrent,
			minimumChargeCurrent: participant.minimumChargeCurrent,
			phases: participant.phases,
			state: participant.state,
		});
		// the raw surplus power offered to this wallbox drives its one-/three-phase decision
		const availablePower = calculateAvailableSurplusPower(surplus) ?? 0;

		if (participant.claimsPower) {
			// reserve the larger of what this wallbox wants and what it still draws while ramping down
			const reservedCurrent = Math.max(decision.optimalCurrent ?? 0, decision.nextState.currentAmp);
			claimedPower += reservedCurrent * PHASE_VOLTAGE * participant.phases;
		}

		return { ...decision, availablePower };
	});
}

/** Input for the automatic one-/three-phase switching decision of a single wallbox. */
export interface PhaseSwitchInput {
	/** Number of phases the wallbox is charging with right now (1 or 3) */
	currentPhases: number;
	/** PV surplus power available to this wallbox in watts, independent of the phase count */
	availablePower: number;
	/** Lowest current the ChargeManager may assign to this wallbox */
	minimumChargeCurrent: number;
	/** Highest current the ChargeManager may assign to this wallbox */
	maximumChargeCurrent: number;
	/** Consecutive cycles the pending switch condition has already held */
	switchDelay: number;
}

/** Result of the automatic phase-switching decision. */
export interface PhaseSwitchDecision {
	/** Phase count the wallbox should charge with (1 or 3); equals the current count until the dwell time elapsed */
	targetPhases: number;
	/** Updated consecutive-cycle counter for the pending switch (0 when no switch is pending) */
	switchDelay: number;
}

/**
 * Decides whether a wallbox should switch between one-phase and three-phase charging.
 *
 * Three-phase charging raises both the floor (it needs at least `minimumChargeCurrent`
 * on every phase) and the ceiling, so the decision is driven by the surplus power:
 * switch up to three phases once one-phase charging is saturated, and back down once the
 * surplus can no longer sustain the three-phase minimum. The gap between those two
 * thresholds plus a dwell time of {@link PHASE_SWITCH_DELAY_CYCLES} cycles keeps a wallbox
 * from flapping between phase modes, which would interrupt charging each time.
 *
 * The up threshold is floored at the three-phase minimum, so a wallbox whose one-phase
 * maximum is already below that minimum still has a stable (non-overlapping) hysteresis band.
 *
 * @param input Current phase count, available surplus power and the pending-switch counter
 * @returns The phase count to use next cycle and the updated dwell counter
 */
export function decidePhaseSwitch(input: PhaseSwitchInput): PhaseSwitchDecision {
	if (
		(input.currentPhases !== 1 && input.currentPhases !== 3) ||
		!Number.isFinite(input.availablePower) ||
		!Number.isFinite(input.minimumChargeCurrent) ||
		!Number.isFinite(input.maximumChargeCurrent)
	) {
		return { targetPhases: input.currentPhases, switchDelay: 0 };
	}

	const threePhaseMinPower = input.minimumChargeCurrent * 3 * PHASE_VOLTAGE;
	// the up threshold can never be below the three-phase minimum, so the band never inverts
	const upThreshold = Math.max(input.maximumChargeCurrent * PHASE_VOLTAGE, threePhaseMinPower);

	let targetPhases = input.currentPhases;
	if (input.currentPhases === 1 && input.availablePower >= upThreshold) {
		targetPhases = 3;
	} else if (input.currentPhases === 3 && input.availablePower < threePhaseMinPower) {
		targetPhases = 1;
	}

	if (targetPhases === input.currentPhases) {
		return { targetPhases: input.currentPhases, switchDelay: 0 };
	}

	const switchDelay = input.switchDelay + 1;
	if (switchDelay > PHASE_SWITCH_DELAY_CYCLES) {
		return { targetPhases, switchDelay: 0 };
	}
	// condition holds but the dwell time has not elapsed yet - keep the current phase count
	return { targetPhases: input.currentPhases, switchDelay };
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
