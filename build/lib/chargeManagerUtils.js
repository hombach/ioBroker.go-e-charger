"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_SWITCH_DELAY_CYCLES = exports.PHASE_VOLTAGE = exports.DEFAULT_MAXIMUM_BATTERY_BONUS = exports.DEFAULT_RESERVE_POWER = exports.SHUTDOWN_DELAY_CYCLES = exports.START_CHARGE_CURRENT = exports.MAX_CHARGE_CURRENT = exports.MIN_CHARGE_CURRENT = void 0;
exports.resolveWallboxCurrentLimits = resolveWallboxCurrentLimits;
exports.evaluateBatteryAvailability = evaluateBatteryAvailability;
exports.calculateAvailableSurplusPower = calculateAvailableSurplusPower;
exports.calculateOptimalChargeCurrent = calculateOptimalChargeCurrent;
exports.stepChargeCurrent = stepChargeCurrent;
exports.updateShutdownDelay = updateShutdownDelay;
exports.decideChargeManager = decideChargeManager;
exports.decideChargeManagerFleet = decideChargeManagerFleet;
exports.decidePhaseSwitch = decidePhaseSwitch;
exports.buildChargerCommands = buildChargerCommands;
exports.MIN_CHARGE_CURRENT = 6;
exports.MAX_CHARGE_CURRENT = 32;
exports.START_CHARGE_CURRENT = 10;
exports.SHUTDOWN_DELAY_CYCLES = 12;
exports.DEFAULT_RESERVE_POWER = 100;
exports.DEFAULT_MAXIMUM_BATTERY_BONUS = 2000;
exports.PHASE_VOLTAGE = 230;
exports.PHASE_SWITCH_DELAY_CYCLES = 12;
function resolveWallboxCurrentLimits(input) {
    const isUsable = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
    const installationMax = Number.isFinite(input.installationMaxCurrent) && input.installationMaxCurrent > 0 ? Math.floor(input.installationMaxCurrent) : exports.MAX_CHARGE_CURRENT;
    const maxCandidates = [installationMax];
    if (isUsable(input.configuredMaxCurrent)) {
        maxCandidates.push(Math.floor(input.configuredMaxCurrent));
    }
    if (isUsable(input.hardwareMaxCurrent)) {
        maxCandidates.push(Math.floor(input.hardwareMaxCurrent));
    }
    const maxCurrent = Math.min(exports.MAX_CHARGE_CURRENT, Math.max(exports.MIN_CHARGE_CURRENT, Math.min(...maxCandidates)));
    const minCandidates = [exports.MIN_CHARGE_CURRENT];
    if (isUsable(input.configuredMinCurrent)) {
        minCandidates.push(Math.floor(input.configuredMinCurrent));
    }
    if (isUsable(input.hardwareMinCurrent)) {
        minCandidates.push(Math.floor(input.hardwareMinCurrent));
    }
    const minCurrent = Math.min(maxCurrent, Math.max(...minCandidates));
    return { minCurrent, maxCurrent };
}
function evaluateBatteryAvailability(input) {
    if (input.mode === "disabled") {
        return { ready: true, reason: "disabled", batterySoc: null };
    }
    if (typeof input.batterySoc !== "number" ||
        !Number.isFinite(input.batterySoc) ||
        input.batterySoc < 0 ||
        input.batterySoc > 100 ||
        typeof input.minimumBatterySoc !== "number" ||
        !Number.isFinite(input.minimumBatterySoc) ||
        input.minimumBatterySoc < 0 ||
        input.minimumBatterySoc > 100) {
        return { ready: false, reason: "invalid", batterySoc: null };
    }
    if (input.maximumAgeSeconds > 0 &&
        (input.batterySocAgeMs === null ||
            !Number.isFinite(input.batterySocAgeMs) ||
            input.batterySocAgeMs < 0 ||
            input.batterySocAgeMs > input.maximumAgeSeconds * 1000)) {
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
function calculateAvailableSurplusPower(input) {
    const numericInputs = [input.solarPower, input.houseConsumption, input.chargerPower, input.reservePower, input.maximumBatteryBonus];
    if (!numericInputs.every(value => Number.isFinite(value)) || input.reservePower < 0 || input.maximumBatteryBonus < 0) {
        return null;
    }
    if (input.batteryMode !== "disabled" &&
        (input.batterySoc === null ||
            !Number.isFinite(input.batterySoc) ||
            input.batterySoc < 0 ||
            input.batterySoc > 100 ||
            !Number.isFinite(input.minBatterySoc) ||
            input.minBatterySoc < 0 ||
            input.minBatterySoc > 100)) {
        return null;
    }
    const batteryOffset = input.batteryMode === "priority" && input.batterySoc !== null && input.minBatterySoc < 100
        ? Math.max(0, (input.maximumBatteryBonus / (100 - input.minBatterySoc)) * (input.batterySoc - input.minBatterySoc))
        : 0;
    return input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - input.reservePower + batteryOffset;
}
function calculateOptimalChargeCurrent(input) {
    if (!Number.isFinite(input.phases) ||
        !Number.isFinite(input.maximumChargeCurrent) ||
        (input.phases !== 1 && input.phases !== 3) ||
        !Number.isInteger(input.maximumChargeCurrent) ||
        input.maximumChargeCurrent < exports.MIN_CHARGE_CURRENT ||
        input.maximumChargeCurrent > exports.MAX_CHARGE_CURRENT) {
        return null;
    }
    const availablePower = calculateAvailableSurplusPower(input);
    if (availablePower === null) {
        return null;
    }
    const calculatedCurrent = Math.floor(availablePower / exports.PHASE_VOLTAGE / input.phases);
    return Math.max(0, Math.min(calculatedCurrent, input.maximumChargeCurrent));
}
function stepChargeCurrent(current, target, maximum = exports.MAX_CHARGE_CURRENT) {
    const safeMaximum = Number.isInteger(maximum) && maximum >= exports.MIN_CHARGE_CURRENT && maximum <= exports.MAX_CHARGE_CURRENT ? maximum : exports.MAX_CHARGE_CURRENT;
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
function updateShutdownDelay(current, minimum, previousDelay) {
    if (!Number.isFinite(current) || !Number.isFinite(minimum) || current >= minimum) {
        return 0;
    }
    const safePreviousDelay = Number.isFinite(previousDelay) ? Math.max(0, Math.trunc(previousDelay)) : 0;
    return safePreviousDelay + 1;
}
function decideChargeManager(input) {
    const optimalCurrent = calculateOptimalChargeCurrent(input);
    if (optimalCurrent === null ||
        !Number.isInteger(input.minimumChargeCurrent) ||
        input.minimumChargeCurrent < exports.MIN_CHARGE_CURRENT ||
        input.minimumChargeCurrent > input.maximumChargeCurrent) {
        return {
            action: "disable",
            reason: "invalid-input",
            optimalCurrent: null,
            nextState: { currentAmp: 0, shutdownDelay: 0 },
        };
    }
    const currentAmp = stepChargeCurrent(input.state.currentAmp, optimalCurrent, input.maximumChargeCurrent);
    const startChargeCurrent = Math.min(Math.max(exports.START_CHARGE_CURRENT, input.minimumChargeCurrent), input.maximumChargeCurrent);
    const isRampingToRaisedMinimum = input.minimumChargeCurrent > exports.START_CHARGE_CURRENT && optimalCurrent >= input.minimumChargeCurrent && currentAmp < input.minimumChargeCurrent;
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
        if (shutdownDelay > exports.SHUTDOWN_DELAY_CYCLES) {
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
function decideChargeManagerFleet(shared, participants) {
    let claimedPower = 0;
    return participants.map(participant => {
        const surplus = { ...shared, solarPower: shared.solarPower - claimedPower };
        const decision = decideChargeManager({
            ...surplus,
            maximumChargeCurrent: participant.maximumChargeCurrent,
            minimumChargeCurrent: participant.minimumChargeCurrent,
            phases: participant.phases,
            state: participant.state,
        });
        const availablePower = calculateAvailableSurplusPower(surplus) ?? 0;
        if (participant.claimsPower) {
            const reservedCurrent = Math.max(decision.optimalCurrent ?? 0, decision.nextState.currentAmp);
            claimedPower += reservedCurrent * exports.PHASE_VOLTAGE * participant.phases;
        }
        return { ...decision, availablePower };
    });
}
function decidePhaseSwitch(input) {
    if ((input.currentPhases !== 1 && input.currentPhases !== 3) ||
        !Number.isFinite(input.availablePower) ||
        !Number.isFinite(input.minimumChargeCurrent) ||
        !Number.isFinite(input.maximumChargeCurrent)) {
        return { targetPhases: input.currentPhases, switchDelay: 0 };
    }
    const threePhaseMinPower = input.minimumChargeCurrent * 3 * exports.PHASE_VOLTAGE;
    const upThreshold = Math.max(input.maximumChargeCurrent * exports.PHASE_VOLTAGE, threePhaseMinPower);
    let targetPhases = input.currentPhases;
    if (input.currentPhases === 1 && input.availablePower >= upThreshold) {
        targetPhases = 3;
    }
    else if (input.currentPhases === 3 && input.availablePower < threePhaseMinPower) {
        targetPhases = 1;
    }
    if (targetPhases === input.currentPhases) {
        return { targetPhases: input.currentPhases, switchDelay: 0 };
    }
    const switchDelay = input.switchDelay + 1;
    if (switchDelay > exports.PHASE_SWITCH_DELAY_CYCLES) {
        return { targetPhases, switchDelay: 0 };
    }
    return { targetPhases: input.currentPhases, switchDelay };
}
function buildChargerCommands(allow, ampere, firmware) {
    if (!allow) {
        return [{ parameter: "alw", value: 0 }];
    }
    if (!Number.isInteger(ampere) || ampere < exports.MIN_CHARGE_CURRENT || ampere > exports.MAX_CHARGE_CURRENT) {
        return null;
    }
    return [
        { parameter: firmware === "033" ? "amp" : "amx", value: ampere },
        { parameter: "alw", value: 1 },
    ];
}
//# sourceMappingURL=chargeManagerUtils.js.map