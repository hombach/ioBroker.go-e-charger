"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_CHARGE_CURRENT = exports.MIN_CHARGE_CURRENT = void 0;
exports.calculateOptimalChargeCurrent = calculateOptimalChargeCurrent;
exports.stepChargeCurrent = stepChargeCurrent;
exports.updateShutdownDelay = updateShutdownDelay;
exports.buildChargerCommands = buildChargerCommands;
exports.MIN_CHARGE_CURRENT = 6;
exports.MAX_CHARGE_CURRENT = 16;
function calculateOptimalChargeCurrent(input) {
    const numericInputs = [input.solarPower, input.houseConsumption, input.chargerPower, input.batterySoc, input.minBatterySoc, input.phases];
    if (!numericInputs.every(value => Number.isFinite(value))) {
        return null;
    }
    if ((input.phases !== 1 && input.phases !== 3) || input.batterySoc < 0 || input.batterySoc > 100 || input.minBatterySoc < 0 || input.minBatterySoc > 100) {
        return null;
    }
    const batteryOffset = input.minBatterySoc < 100 ? (2000 / (100 - input.minBatterySoc)) * (input.batterySoc - input.minBatterySoc) : 0;
    const availablePower = input.solarPower - input.houseConsumption + (input.subtractChargerPower ? input.chargerPower : 0) - 100 + batteryOffset;
    const calculatedCurrent = Math.floor(availablePower / 230 / input.phases);
    return Math.max(0, Math.min(calculatedCurrent, exports.MAX_CHARGE_CURRENT));
}
function stepChargeCurrent(current, target) {
    const safeCurrent = Number.isFinite(current) ? Math.max(0, Math.min(Math.trunc(current), exports.MAX_CHARGE_CURRENT)) : 0;
    const safeTarget = Number.isFinite(target) ? Math.max(0, Math.min(Math.trunc(target), exports.MAX_CHARGE_CURRENT)) : 0;
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