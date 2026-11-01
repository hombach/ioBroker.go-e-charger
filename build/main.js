"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const utils = __importStar(require("@iobroker/adapter-core"));
const axios_1 = __importDefault(require("axios"));
const chargeManagerUtils_1 = require("./lib/chargeManagerUtils");
const projectUtils_1 = require("./lib/projectUtils");
const axiosInstance = axios_1.default.create({
    timeout: 5000,
});
let minHomeBatVal = 87;
let solarPower = 0;
let houseConsumption = 0;
let totalChargeEnergy = 0;
let totalChargePower = 0;
let chargeManagerReservePower = chargeManagerUtils_1.DEFAULT_RESERVE_POWER;
let chargeManagerMaxBatteryBonus = chargeManagerUtils_1.DEFAULT_MAXIMUM_BATTERY_BONUS;
let chargeManagerMinCurrent = chargeManagerUtils_1.MIN_CHARGE_CURRENT;
let maxChargeCurrent = chargeManagerUtils_1.MAX_CHARGE_CURRENT;
let maxAmpTotal = 0;
let chargeManagerBatteryMode = "priority";
let chargeManagerBatterySocHysteresis = 0;
let chargeManagerBatterySocMaxAgeSeconds = 0;
let chargeManagerGridMode = "pvAndConsumption";
let gridPowerStateId = "";
let gridMeterOptions = { negate: false, ackOnly: false };
let gridPowerMaxAgeSeconds = 0;
class go_e_charger extends utils.Adapter {
    projectUtils = new projectUtils_1.ProjectUtils(this);
    wallboxInfoList = [];
    stateMachineTimeout;
    isUnloading = false;
    gridMeterSample = null;
    gridMeterReason = null;
    constructor(options = {}) {
        super({
            ...options,
            name: "go-e-charger",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.wallboxInfoList = [];
    }
    async onReady() {
        if (!this.config.cycleTime) {
            this.log.warn(`Cycletime not configured or zero - will be set to 10 seconds`);
            this.config.cycleTime = 10000;
        }
        else if (this.config.cycleTime < 3000) {
            this.log.warn(`Cycletime configured too small (${this.config.cycleTime} ms) - will be set to 3 seconds`);
            this.config.cycleTime = 3000;
        }
        else if (this.config.cycleTime > 3600000) {
            this.log.warn(`Cycletime configured too large (${this.config.cycleTime} ms) - will be set to 1 hour`);
            this.config.cycleTime = 3600000;
        }
        this.log.info(`Cycletime set to: ${this.config.cycleTime / 1000} seconds`);
        minHomeBatVal = await this.projectUtils.getStateValue("Settings.Setpoint_HomeBatSoC");
        this.log.debug(`Initial value for Setpoint HomeBatSoC: ${minHomeBatVal}%`);
        chargeManagerReservePower = this.validateNonNegativeConfig(this.config.chargeManagerReservePower, chargeManagerUtils_1.DEFAULT_RESERVE_POWER, "chargeManagerReservePower");
        chargeManagerMaxBatteryBonus = this.validateNonNegativeConfig(this.config.chargeManagerMaxBatteryBonus, chargeManagerUtils_1.DEFAULT_MAXIMUM_BATTERY_BONUS, "chargeManagerMaxBatteryBonus");
        this.log.debug(`ChargeManager reserve: ${chargeManagerReservePower} W, max battery bonus: ${chargeManagerMaxBatteryBonus} W`);
        chargeManagerMinCurrent = this.validateBoundedIntConfig(this.config.chargeManagerMinCurrent, chargeManagerUtils_1.MIN_CHARGE_CURRENT, chargeManagerUtils_1.MIN_CHARGE_CURRENT, chargeManagerUtils_1.MAX_CHARGE_CURRENT, "chargeManagerMinCurrent");
        maxChargeCurrent = this.validateBoundedIntConfig(this.config.maxChargeCurrent, chargeManagerUtils_1.MAX_CHARGE_CURRENT, chargeManagerUtils_1.START_CHARGE_CURRENT, chargeManagerUtils_1.MAX_CHARGE_CURRENT, "maxChargeCurrent");
        if (chargeManagerMinCurrent > maxChargeCurrent) {
            this.log.warn(`chargeManagerMinCurrent (${chargeManagerMinCurrent} A) exceeds maxChargeCurrent (${maxChargeCurrent} A); using ${chargeManagerUtils_1.MIN_CHARGE_CURRENT}/${chargeManagerUtils_1.MAX_CHARGE_CURRENT} A`);
            chargeManagerMinCurrent = chargeManagerUtils_1.MIN_CHARGE_CURRENT;
            maxChargeCurrent = chargeManagerUtils_1.MAX_CHARGE_CURRENT;
        }
        this.log.debug(`ChargeManager current range: ${chargeManagerMinCurrent}-${maxChargeCurrent} A`);
        const maxAmpTotalConfig = (0, chargeManagerUtils_1.validateMaxAmpTotal)(this.config.maxAmpTotal);
        if (!maxAmpTotalConfig.valid) {
            this.log.warn(`Config maxAmpTotal is invalid (${JSON.stringify(this.config.maxAmpTotal)}); allowed is 0 (disabled) or up to ${chargeManagerUtils_1.MAX_AMP_TOTAL} A - total current budget disabled`);
        }
        maxAmpTotal = maxAmpTotalConfig.ampere;
        if (maxAmpTotal > 0) {
            this.log.debug(`Installation total current budget: ${maxAmpTotal} A`);
        }
        chargeManagerBatteryMode = this.validateBatteryModeConfig(this.config.batteryMode);
        chargeManagerBatterySocHysteresis = this.validateNonNegativeConfig(this.config.batterySocHysteresis, 0, "batterySocHysteresis");
        chargeManagerBatterySocMaxAgeSeconds = this.validateBoundedIntConfig(this.config.batterySocMaxAgeSeconds, 0, 0, 86400, "batterySocMaxAgeSeconds");
        this.log.debug(`ChargeManager battery mode: ${chargeManagerBatteryMode}, SoC hysteresis: ${chargeManagerBatterySocHysteresis}%, max SoC age: ${chargeManagerBatterySocMaxAgeSeconds} s`);
        await this.setupGridMeterInput();
        const wallBoxList = Array.isArray(this.config.wallBoxList) ? this.config.wallBoxList : [];
        this.config.wallBoxList = wallBoxList;
        if (!wallBoxList.length) {
            this.log.warn("No wallBoxList configured or wallBoxList is not an array. Charger setup will be skipped.");
        }
        else {
            this.wallboxInfoList = wallBoxList.map((wallboxConfig, index) => ({
                ID: index,
                ipAddress: wallboxConfig.ipAddress,
                readOnlyMode: wallboxConfig.readOnlyMode,
                Online: null,
                Firmware: "0",
                Hardware: "V2",
                HardwareMin3: false,
                AutoPhase: false,
                GridPhases: 0,
                ChargeNOW: false,
                ChargeManager: false,
                ChargeCurrent: 6,
                ChargePower: 0,
                Charge3Phase: false,
                ManagedCharge3Phase: false,
                EnabledPhases: 0,
                MeasuredMaxChargeAmp: 0,
                BatteryReady: false,
                CarState: 0,
                MinAmp: 6,
                MaxAmp: maxChargeCurrent,
                HardwareMaxAmp: 0,
                HardwareMinAmp: 0,
                DelayOff: 0,
                PhaseSwitchDelay: 0,
                ReclaimDelay: 0,
                ChargeState: "",
                Reported: {},
                RequestedAllow: null,
                ReleaseRejects: 0,
                IdleReleaseDelay: 0,
                IdleReleaseLatched: false,
                ChargeNowSawVehicle: false,
                ChargeNowIdleDelay: 0,
                ReleasedByAdapter: false,
                ChargeManagerRunning: false,
                ForceState: Number.NaN,
                CurrentHysteresis: 0,
                SetOptAmp: 5,
                SetOptAllow: false,
                SetAmp: 0,
                SetAllow: false,
            }));
            this.log.info(`WallboxInfoList initialised with ${this.wallboxInfoList.length} entries`);
        }
        this.subscribeStates(`Settings.*`);
        this.subscribeStates(`Wallbox_*.Settings.*`);
        try {
            for (const [iWB, wallBox] of wallBoxList.entries()) {
                this.log.debug(`Setting up Wallbox ${(0, chargeManagerUtils_1.wallboxLabel)(iWB, wallBox.chargerName)} with IP ${wallBox.ipAddress} in config`);
                if (!wallBox.ipAddress) {
                    throw new Error(`Wallbox ${(0, chargeManagerUtils_1.wallboxLabel)(iWB, wallBox.chargerName)} - IP address not set - stopping adapter`);
                }
                const limits = (0, chargeManagerUtils_1.resolveWallboxCurrentLimits)({
                    installationMaxCurrent: maxChargeCurrent,
                    configuredMaxCurrent: wallBox.maxAmp,
                    configuredMinCurrent: wallBox.minAmp,
                    hardwareMaxCurrent: null,
                    hardwareMinCurrent: null,
                });
                this.wallboxInfoList[iWB].MinAmp = limits.minCurrent;
                this.wallboxInfoList[iWB].MaxAmp = limits.maxCurrent;
                if (wallBox.minAmp && wallBox.maxAmp && wallBox.minAmp > wallBox.maxAmp) {
                    this.log.warn(`Wallbox ${(0, chargeManagerUtils_1.wallboxLabel)(iWB, wallBox.chargerName)}: configured minAmp (${wallBox.minAmp} A) exceeds maxAmp (${wallBox.maxAmp} A); using ${limits.minCurrent}/${limits.maxCurrent} A`);
                }
                this.log.debug(`Wallbox ${(0, chargeManagerUtils_1.wallboxLabel)(iWB, wallBox.chargerName)} current limits: ${limits.minCurrent}-${limits.maxCurrent} A`);
                await this.projectUtils.checkAndSetDevice(`Wallbox_${iWB}`, wallBox.chargerName || `Wallbox ${iWB}`, `info.connection`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.info`, `Informations about go-eCharger`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.info.connection`, false, `Device connected`, "indicator.connected");
                await this.projectUtils.checkAndSetValue(`Wallbox_${iWB}.info.ipAddress`, wallBox.ipAddress, `Configured IP address of charger`, "info.ip", false, false, true);
                await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.Power`, `current wallbox power data`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.Settings`, `states to dynamically adjust wallbox settings`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.statistics`, `wallbox statistics data`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.Settings.ChargeNOW`, false, `ChargeNOW enabled`, "switch", true, true);
                await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.Settings.ChargeManager`, false, `Charge Manager enabled`, "switch", true, true);
                await this.projectUtils.checkAndSetValueNumber(`Wallbox_${iWB}.Settings.ChargeCurrent`, this.wallboxInfoList[iWB].MinAmp, `charge current output`, "A", "level.current", true, false, true, this.wallboxInfoList[iWB].MinAmp, this.wallboxInfoList[iWB].MaxAmp, 1);
                this.wallboxInfoList[iWB].Charge3Phase = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.Charge3Phase`);
                await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.Settings.Charge3Phase`, false, `Setting 3-phase charging`, "switch", true, true);
                if (wallBox.ipAddress) {
                    await this.Read_ChargerAPIV1(iWB);
                    if (this.wallboxInfoList[iWB].Online !== false) {
                        await this.Read_ChargerAPIV2(iWB);
                    }
                    this.log.info(`IP address of charger ${this.wallboxLabel(iWB)} found in config: ${wallBox.ipAddress}`);
                    await this.projectUtils.checkAndSetValueNumber(`Wallbox_${iWB}.Settings.ChargeCurrent`, this.wallboxInfoList[iWB].MinAmp, `charge current output`, "A", "level.current", true, true, true, this.wallboxInfoList[iWB].MinAmp, this.wallboxInfoList[iWB].MaxAmp, 1);
                }
                this.wallboxInfoList[iWB].ChargeNOW = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeNOW`);
                this.wallboxInfoList[iWB].ChargeManager = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeManager`);
                if (this.wallboxInfoList[iWB].ChargeNOW) {
                    this.switchOffOtherMode(iWB, "ChargeManager", "ChargeNOW");
                }
                this.wallboxInfoList[iWB].ChargeCurrent = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeCurrent`);
                this.wallboxInfoList[iWB].Charge3Phase = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.Charge3Phase`);
                const phaseModeId = `Wallbox_${iWB}.Settings.PhaseMode`;
                await this.extendObject(phaseModeId, {
                    type: "state",
                    common: {
                        name: "PhaseMode",
                        type: "number",
                        role: "level",
                        desc: `Phase mode: 1 = one phase, 3 = three phases, 0 = automatic switching (if enabled in the instance settings)`,
                        read: true,
                        write: true,
                        states: { 0: "automatic", 1: "1-phase", 3: "3-phase" },
                    },
                    native: {},
                });
                const storedPhaseMode = (await this.getStateAsync(phaseModeId))?.val ?? chargeManagerUtils_1.PHASE_MODE_AUTO;
                const info = this.wallboxInfoList[iWB];
                info.AutoPhase = Boolean(wallBox.autoPhaseSwitch) && storedPhaseMode === chargeManagerUtils_1.PHASE_MODE_AUTO && (0, chargeManagerUtils_1.autoPhaseSupported)(info.HardwareMin3, info.Online);
                info.ManagedCharge3Phase = info.EnabledPhases === 3;
                this.syncPhaseMode(iWB);
            }
        }
        catch (e) {
            this.log.error(e.message);
            void this.setState(`info.connection`, { val: false, ack: true });
            await this.stop?.({ exitCode: 11, reason: `invalid config` });
            return;
        }
        await this.projectUtils.checkAndSetChannel(`statisticsGlobal`, `statistical data sum of all chargers`, `go-eCharger.png`, true);
        await this.projectUtils.checkAndSetValueNumber(`statisticsGlobal.chargedEnergy`, totalChargeEnergy, `Totally charged sum of all go-e in lifetime`, "kWh", "value.energy.consumed", false, true);
        await this.projectUtils.checkAndSetValueNumber(`statisticsGlobal.chargePower`, totalChargePower, `Current charging power sum of all chargers`, "W", "value.power", false, true);
        if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
            const sentryInstance = this.getPluginInstance("sentry");
            if (sentryInstance) {
                const Sentry = sentryInstance.getSentryObject();
                Sentry &&
                    Sentry?.withScope((scope) => {
                        scope.setLevel("info");
                        scope.setTag("Charger", this.config.wallBoxList.map(wb => wb.ipAddress).join(", "));
                        scope.setTag("Firmware", this.wallboxInfoList.map(wb => wb.Firmware).join(", "));
                        scope.setTag("Hardware", this.wallboxInfoList.map(wb => wb.Hardware).join(", "));
                        Sentry.captureMessage("Adapter go-e-Charger started", "info");
                    });
            }
        }
        if (!(await this.firstStart())) {
            return;
        }
        this.log.debug(`Start init done, launching state machine interval`);
        void this.setState(`info.connection`, { val: true, ack: true });
        this.scheduleStateMachine();
    }
    onStateChange(id, state) {
        try {
            if (chargeManagerGridMode === "gridMeter" && id === gridPowerStateId) {
                this.updateGridMeterSample(state, "update");
                return;
            }
            if (state) {
                if (!state.ack) {
                    this.log.debug(`state change detected and parsing for id: ${id} - state: ${state.val}`);
                    if (id.includes(`.Settings.`)) {
                        const statePath = id.split(".");
                        let settingType = "";
                        let chargerNo = -1;
                        switch (statePath[2]) {
                            case "Settings":
                                settingType = statePath[3];
                                switch (settingType) {
                                    case "Setpoint_HomeBatSoC":
                                        if (typeof state.val === "number") {
                                            minHomeBatVal = state.val;
                                            this.log.debug(`settings state changed to Setpoint_HomeBatSoC: ${minHomeBatVal}`);
                                            void this.setState(id, state.val, true);
                                        }
                                        else {
                                            this.log.warn(`Wrong type for Setpoint_HomeBatSoC: ${state.val}`);
                                        }
                                        break;
                                    default:
                                        this.log.debug(`unknown value for setting type: ${settingType}`);
                                }
                                break;
                            default:
                                if (statePath[2].startsWith("Wallbox_") && statePath[3] === "Settings") {
                                    const wallboxIndex = (0, chargeManagerUtils_1.parseWallboxIndex)(statePath[2], this.wallboxInfoList.length);
                                    if (wallboxIndex === null) {
                                        this.log.warn(`state change ignored for unconfigured wallbox: ${id}`);
                                        return;
                                    }
                                    chargerNo = wallboxIndex;
                                    settingType = statePath[4];
                                    switch (settingType) {
                                        case "ChargeNOW":
                                            if (typeof state.val === "boolean") {
                                                this.wallboxInfoList[chargerNo].ChargeNOW = state.val;
                                                this.resetChargeNowSession(chargerNo);
                                                this.log.debug(`settings state changed to ChargeNOW: ${this.wallboxInfoList[chargerNo].ChargeNOW}`);
                                                void this.setState(id, state.val, true);
                                                if (state.val) {
                                                    this.switchOffOtherMode(chargerNo, "ChargeManager", "ChargeNOW");
                                                }
                                            }
                                            else {
                                                this.log.warn(`Wrong type for ChargeNOW: ${state.val}`);
                                            }
                                            break;
                                        case "ChargeManager":
                                            if (typeof state.val === "boolean") {
                                                this.wallboxInfoList[chargerNo].ChargeManager = state.val;
                                                this.log.debug(`settings state changed to ChargeManager: ${this.wallboxInfoList[chargerNo].ChargeManager}`);
                                                void this.setState(id, state.val, true);
                                                if (state.val) {
                                                    this.switchOffOtherMode(chargerNo, "ChargeNOW", "ChargeManager");
                                                }
                                            }
                                            else {
                                                this.log.warn(`Wrong type for ChargeManager: ${state.val}`);
                                            }
                                            break;
                                        case "ChargeCurrent":
                                            if (typeof state.val === "number") {
                                                this.wallboxInfoList[chargerNo].ChargeCurrent = state.val;
                                                this.log.debug(`settings state changed to ChargeCurrent: ${this.wallboxInfoList[chargerNo].ChargeCurrent}`);
                                                void this.setState(id, state.val, true);
                                            }
                                            else {
                                                this.log.warn(`Wrong type for ChargeCurrent: ${state.val}`);
                                            }
                                            break;
                                        case "Charge3Phase":
                                            if (typeof state.val === "boolean") {
                                                this.wallboxInfoList[chargerNo].Charge3Phase = state.val;
                                                this.log.debug(`settings state changed to Charge3Phase: ${this.wallboxInfoList[chargerNo].Charge3Phase}`);
                                                void this.setState(id, state.val, true);
                                                this.syncPhaseMode(chargerNo);
                                            }
                                            else {
                                                this.log.warn(`Wrong type for Charge3Phase: ${state.val}`);
                                            }
                                            break;
                                        case "PhaseMode": {
                                            const info = this.wallboxInfoList[chargerNo];
                                            const mode = (0, chargeManagerUtils_1.resolvePhaseModeWrite)(state.val, Boolean(this.config.wallBoxList[chargerNo].autoPhaseSwitch) && info.HardwareMin3, info.EnabledPhases);
                                            if (mode) {
                                                info.AutoPhase = mode.auto;
                                                info.PhaseSwitchDelay = 0;
                                                if (mode.auto) {
                                                    info.ManagedCharge3Phase = mode.managedCharge3Phase;
                                                }
                                                else {
                                                    info.Charge3Phase = mode.charge3Phase;
                                                    void this.setState(`Wallbox_${chargerNo}.Settings.Charge3Phase`, mode.charge3Phase, true);
                                                }
                                                this.log.debug(`settings state changed to PhaseMode: ${state.val}`);
                                            }
                                            else {
                                                this.log.warn(`Wrong value for PhaseMode: ${state.val} (1 = one phase, 3 = three phases, 0 = automatic if enabled in the instance settings on a gen 3+ charger)`);
                                            }
                                            this.syncPhaseMode(chargerNo);
                                            break;
                                        }
                                        default:
                                            this.log.debug(`unknown value for setting type: ${settingType}`);
                                    }
                                }
                                else {
                                    this.log.debug(`unknown settings value`);
                                }
                        }
                    }
                }
            }
            else {
                this.log.warn(`state ${id} deleted`);
            }
        }
        catch (error) {
            this.log.error(`Unhandled exception processing onStateChange: ${error}`);
        }
    }
    onUnload(callback) {
        try {
            this.isUnloading = true;
            if (this.stateMachineTimeout) {
                this.clearTimeout(this.stateMachineTimeout);
                this.stateMachineTimeout = undefined;
            }
            this.log.info(`Adapter go-eCharger cleaned up everything...`);
            for (const [iWB] of this.config.wallBoxList.entries()) {
                void this.setState(`Wallbox_${iWB}.info.connection`, { val: false, ack: true });
            }
            void this.setState(`info.connection`, false, true);
            callback();
        }
        catch (error) {
            this.log.warn(error.message);
            callback();
        }
    }
    async firstStart() {
        let reachableChargers = 0;
        for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
            this.log.debug(`Initial ReadCharger done, detected charger ${this.wallboxLabel(iWB)} firmware ${this.wallboxInfoList[iWB].Firmware}`);
            switch (this.wallboxInfoList[iWB].Firmware) {
                case "0":
                case "EHostUnreach":
                    this.log.warn(`No charger detected for charger ${this.wallboxLabel(iWB, true)}`);
                    await this.setState(`Wallbox_${iWB}.info.connection`, { val: false, ack: true });
                    break;
                case "033":
                case "040":
                case "040.0":
                case "041.0":
                case "054.7":
                case "054.11":
                case "055.5":
                case "055.7":
                case "055.8":
                case "56.1":
                case "56.2":
                case "56.8":
                case "56.9":
                case "56.11":
                case "57.0":
                case "57.1":
                case "59.4":
                case "60.0":
                case "60.1":
                case "60.2":
                case "60.5":
                case "60.6":
                    this.log.debug(`Init done, launching state machine`);
                    await this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
                    reachableChargers++;
                    break;
                default:
                    this.log.warn(`Not explicitly supported firmware ${this.wallboxInfoList[iWB].Firmware} for charger ${this.wallboxLabel(iWB)} found!!!`);
                    await this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
                    reachableChargers++;
                    if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
                        const sentryInstance = this.getPluginInstance("sentry");
                        if (sentryInstance) {
                            const Sentry = sentryInstance.getSentryObject();
                            Sentry &&
                                Sentry?.withScope((scope) => {
                                    scope.setLevel("warning");
                                    scope.setTag("Firmware", this.wallboxInfoList[iWB].Firmware);
                                    Sentry.captureMessage("Adapter go-e-Charger found unknown firmware", "warning");
                                });
                        }
                    }
            }
        }
        if (reachableChargers === 0) {
            this.log.error(`No charger reachable on any configured IP address - stopping adapter.`);
            await this.stop?.({ exitCode: 11, reason: `no charger detected` });
            return false;
        }
        return true;
    }
    scheduleStateMachine() {
        if (this.isUnloading || this.stateMachineTimeout) {
            return;
        }
        this.stateMachineTimeout = this.setTimeout(() => {
            this.stateMachineTimeout = undefined;
            void this.StateMachine();
        }, Number(this.config.cycleTime));
    }
    async StateMachine() {
        if (this.isUnloading) {
            return;
        }
        try {
            this.log.debug(`StateMachine cycle start`);
            totalChargeEnergy = 0;
            totalChargePower = 0;
            for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
                if (!this.wallboxInfoList[iWB].ChargeManager || this.wallboxInfoList[iWB].ChargeNOW) {
                    this.wallboxInfoList[iWB].BatteryReady = false;
                }
                const wasOnline = this.wallboxInfoList[iWB].Online;
                await this.Read_ChargerAPIV1(iWB);
                if (this.wallboxInfoList[iWB].Online === false) {
                    continue;
                }
                if (this.wallboxInfoList[iWB].HardwareMin3 || wasOnline === false) {
                    await this.Read_ChargerAPIV2(iWB);
                }
                if (this.wallboxInfoList[iWB].AutoPhase && !(0, chargeManagerUtils_1.autoPhaseSupported)(this.wallboxInfoList[iWB].HardwareMin3, this.wallboxInfoList[iWB].Online)) {
                    this.wallboxInfoList[iWB].AutoPhase = false;
                    this.syncPhaseMode(iWB);
                }
                if (this.wallboxInfoList[iWB].ChargeNOW) {
                    await this.endChargeNowWhenDone(iWB);
                }
            }
            const chargePlans = await this.planChargeManagerCycle();
            const budgetActive = maxAmpTotal > 0;
            const budgetAllocations = budgetActive ? this.planTotalCurrentBudget(chargePlans) : [];
            const applyOrder = [...this.config.wallBoxList.keys()];
            if (budgetActive) {
                const targetAmp = (iWB) => {
                    const info = this.wallboxInfoList[iWB];
                    const hasVehicle = info.CarState === 2 || info.CarState === 3;
                    const alloc = budgetAllocations[iWB];
                    return hasVehicle && alloc?.allow ? alloc.ampere : 0;
                };
                applyOrder.sort((a, b) => targetAmp(a) - this.wallboxInfoList[a].SetAmp - (targetAmp(b) - this.wallboxInfoList[b].SetAmp));
            }
            for (const iWB of applyOrder) {
                const info = this.wallboxInfoList[iWB];
                const hasVehicle = info.CarState === 2 || info.CarState === 3;
                if (!info.ChargeManager || info.ChargeNOW) {
                    this.resetIdleRelease(iWB);
                    info.ChargeManagerRunning = false;
                }
                if (info.Online === false) {
                    info.ChargeManagerRunning = false;
                    info.SetAmp = 0;
                    info.DelayOff = 0;
                    this.resetIdleRelease(iWB);
                    await this.setChargeState(iWB, `Charger unreachable`);
                }
                else if (info.ChargeNOW && (0, chargeManagerUtils_1.isVehicleDisconnected)(info.CarState)) {
                    await this.setChargeState(iWB, `ChargeNOW waiting for vehicle`);
                }
                else if (info.ChargeNOW) {
                    if (budgetActive) {
                        const alloc = budgetAllocations[iWB];
                        if (hasVehicle && alloc.allow) {
                            info.SetAmp = alloc.ampere;
                            await this.setChargeState(iWB, `ChargeNOW is charging`);
                            await this.Charge_Config("1", alloc.ampere, `activate go-eCharger for forced charging`, iWB);
                        }
                        else {
                            info.SetAmp = 0;
                            const reason = hasVehicle ? `ChargeNOW off: installation current budget exhausted` : `ChargeNOW waiting for vehicle`;
                            await this.setChargeState(iWB, reason);
                            await this.Charge_Config("0", info.MinAmp, reason, iWB);
                        }
                    }
                    else {
                        await this.setChargeState(iWB, `ChargeNOW is charging`);
                        const chargeNowCurrent = Math.min(Math.max(info.ChargeCurrent, info.MinAmp), info.MaxAmp);
                        info.SetAmp = chargeNowCurrent;
                        await this.Charge_Config("1", chargeNowCurrent, `activate go-eCharger for forced charging`, iWB);
                    }
                    await this.Switch_3Phases(info.Charge3Phase, iWB);
                    if (info.HardwareMin3) {
                        await this.Read_ChargerAPIV2(iWB);
                    }
                }
                else if (info.ChargeManager) {
                    const plan = chargePlans[iWB];
                    if ((0, chargeManagerUtils_1.enforceOffState)(info.ForceState, info.ReleasedByAdapter)) {
                        await this.Charge_Config("0", info.MinAmp, `Charger decides by itself (force state neutral) - holding it off`, iWB);
                    }
                    if ((0, chargeManagerUtils_1.isVehicleDisconnected)(this.wallboxInfoList[iWB].CarState) && plan?.decision && plan.decision.optimalCurrent !== null) {
                        this.wallboxInfoList[iWB].SetOptAmp = plan.decision.optimalCurrent;
                        this.wallboxInfoList[iWB].SetAmp = plan.decision.nextState.currentAmp;
                        this.wallboxInfoList[iWB].DelayOff = plan.decision.nextState.shutdownDelay;
                        this.resetIdleRelease(iWB);
                        await this.setChargeState(iWB, `ChargeManager waiting for vehicle`);
                        if ((await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true || info.ReleasedByAdapter) {
                            await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, `No vehicle connected`, iWB);
                        }
                    }
                    else if (plan?.decision) {
                        const decision = plan.decision;
                        const useAutoPhase = info.AutoPhase && info.HardwareMin3;
                        const targetPhase = useAutoPhase ? info.ManagedCharge3Phase : info.Charge3Phase;
                        await this.Switch_3Phases(targetPhase, iWB);
                        if (budgetActive && !hasVehicle) {
                            await this.stopChargeManager(`No vehicle connected`, iWB);
                        }
                        else if (budgetActive && decision.optimalCurrent !== null && decision.action !== "disable") {
                            const alloc = budgetAllocations[iWB];
                            if (!alloc.allow) {
                                await this.stopChargeManager(`Installation current budget exhausted`, iWB);
                            }
                            else {
                                if (alloc.ampere < decision.nextState.currentAmp) {
                                    decision.nextState.currentAmp = alloc.ampere;
                                    decision.action = "enable";
                                }
                                await this.Charge_Manager(iWB, decision);
                            }
                        }
                        else {
                            await this.Charge_Manager(iWB, decision);
                        }
                    }
                    else if (plan?.batteryReason === "stale") {
                        await this.stopChargeManager(`Battery state of charge is stale`, iWB);
                    }
                    else if (plan?.batteryReason === "below-minimum") {
                        await this.stopChargeManager(`Charging home battery until ${minHomeBatVal}%`, iWB);
                    }
                    else {
                        await this.stopChargeManager(`Invalid battery state of charge or setpoint`, iWB);
                    }
                }
                else {
                    await this.setChargeState(iWB, `ChargeNOW and ChargeManager are both switched off`);
                    if ((0, chargeManagerUtils_1.withdrawReleaseWithModesOff)(await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`), info.ReleasedByAdapter)) {
                        this.wallboxInfoList[iWB].SetAmp = 0;
                        await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, `Deactivate go-eCharger`, iWB);
                    }
                }
                totalChargeEnergy += Number(await this.projectUtils.getStateValue(`Wallbox_${iWB}.statistics.chargedEnergy`)) || 0;
                totalChargePower += Number(await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.Charge`)) || 0;
            }
            await this.projectUtils.checkAndSetValueNumber(`statisticsGlobal.chargedEnergy`, totalChargeEnergy, `Totally charged sum of all go-e in lifetime`, "kWh", "value.energy.consumed");
            await this.projectUtils.checkAndSetValueNumber(`statisticsGlobal.chargePower`, totalChargePower, `Current charging power sum of all chargers`, "W", "value.power");
        }
        catch (error) {
            this.log.error(`Unhandled error in state machine cycle: ${error.message}`);
        }
        finally {
            this.scheduleStateMachine();
        }
    }
    async setupGridMeterInput() {
        const resolution = (0, chargeManagerUtils_1.resolveGridInputMode)(this.config.gridMode, this.config.stateGridPower);
        if (resolution.fallback === "invalid-mode") {
            this.log.warn(`Config gridMode is invalid (${JSON.stringify(this.config.gridMode)}); using PV generation and house consumption`);
        }
        else if (resolution.fallback === "missing-grid-state") {
            this.log.warn(`Grid meter mode selected, but no grid power object ID configured; using PV generation and house consumption`);
        }
        chargeManagerGridMode = resolution.mode;
        if (chargeManagerGridMode !== "gridMeter") {
            this.log.debug(`ChargeManager surplus input: PV generation and house consumption`);
            return;
        }
        gridPowerStateId = this.config.stateGridPower.trim();
        gridMeterOptions = { negate: !!this.config.gridPowerNegate, ackOnly: !!this.config.gridPowerAckOnly };
        gridPowerMaxAgeSeconds = this.validateBoundedIntConfig(this.config.gridPowerMaxAgeSeconds, 0, 0, 86400, "gridPowerMaxAgeSeconds");
        this.log.info(`ChargeManager surplus input: grid meter ${gridPowerStateId} (import positive, export negative${gridMeterOptions.negate ? ", negated" : ""}${gridMeterOptions.ackOnly ? ", ack-only" : ""}, max age ${gridPowerMaxAgeSeconds ? `${gridPowerMaxAgeSeconds} s` : "unchecked"})`);
        if (this.config.stateHomeSolarPower || this.config.stateHomePowerConsumption) {
            this.log.info(`Grid meter mode: the configured PV generation and house consumption objects are ignored`);
        }
        if (!this.config.subtractSelfConsumption) {
            this.log.debug(`Grid meter mode: the wallbox power is always added back, the option "charger consumption included" is ignored`);
        }
        try {
            if (!(await this.getForeignObjectAsync(gridPowerStateId))) {
                this.log.warn(`Grid power object ${gridPowerStateId} does not exist - ChargeManager will not charge until it delivers values`);
            }
            this.subscribeForeignStates(gridPowerStateId);
            this.updateGridMeterSample(await this.getForeignStateAsync(gridPowerStateId), "initial");
        }
        catch (error) {
            this.log.error(`Error setting up grid power object ${gridPowerStateId}: ${String(error)}`);
        }
    }
    updateGridMeterSample(state, source) {
        const update = (0, chargeManagerUtils_1.acceptGridMeterState)(state, gridMeterOptions);
        if (update.sample) {
            this.gridMeterSample = update.sample;
            return;
        }
        if (update.reason !== "not-acknowledged") {
            this.gridMeterSample = null;
        }
        this.log.debug(`Grid power ${source} from ${gridPowerStateId} not used (${update.reason}): ${JSON.stringify(state?.val)} (ack=${state?.ack})`);
    }
    readGridMeter() {
        const reading = (0, chargeManagerUtils_1.evaluateGridMeterReading)(this.gridMeterSample, Date.now(), gridPowerMaxAgeSeconds);
        if (reading.reason !== this.gridMeterReason) {
            if (reading.reason === "available") {
                if (this.gridMeterReason !== null) {
                    this.log.info(`Grid power from ${gridPowerStateId} is available again`);
                }
            }
            else {
                this.log.warn(reading.reason === "stale"
                    ? `Grid power from ${gridPowerStateId} is older than ${gridPowerMaxAgeSeconds} s - ChargeManager stops surplus charging until it is updated`
                    : `No usable grid power from ${gridPowerStateId}${gridMeterOptions.ackOnly ? " (ack-only)" : ""} - ChargeManager stops surplus charging until it delivers a numeric value`);
            }
            this.gridMeterReason = reading.reason;
        }
        this.log.debug(`Got grid power: ${reading.gridPower ?? "n/a"} W (import positive, export negative)`);
        return reading.gridPower;
    }
    applyWallboxCurrentLimits(iWB) {
        const wallBox = this.config.wallBoxList[iWB];
        const limits = (0, chargeManagerUtils_1.resolveWallboxCurrentLimits)({
            installationMaxCurrent: maxChargeCurrent,
            configuredMaxCurrent: wallBox?.maxAmp ?? 0,
            configuredMinCurrent: wallBox?.minAmp ?? 0,
            hardwareMaxCurrent: this.wallboxInfoList[iWB].HardwareMaxAmp || null,
            hardwareMinCurrent: this.wallboxInfoList[iWB].HardwareMinAmp || null,
        });
        this.wallboxInfoList[iWB].MinAmp = limits.minCurrent;
        this.wallboxInfoList[iWB].MaxAmp = limits.maxCurrent;
    }
    combineHardwareMax(absoluteMax, cableLimit) {
        const caps = [absoluteMax, cableLimit].filter(value => Number.isFinite(value) && value > 0);
        return caps.length ? Math.min(...caps) : 0;
    }
    setWallboxHardwareLimits(iWB, hardwareMaxAmp, hardwareMinAmp, basePath) {
        if (Number.isFinite(hardwareMaxAmp) && hardwareMaxAmp > 0) {
            this.wallboxInfoList[iWB].HardwareMaxAmp = Math.floor(hardwareMaxAmp);
            void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.hardwareMaxChargeCurrent`, this.wallboxInfoList[iWB].HardwareMaxAmp, `Maximum charging current the charger hardware/cable accepts`, "A", "value.current");
        }
        if (Number.isFinite(hardwareMinAmp) && hardwareMinAmp > 0) {
            this.wallboxInfoList[iWB].HardwareMinAmp = Math.floor(hardwareMinAmp);
            void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.hardwareMinChargeCurrent`, this.wallboxInfoList[iWB].HardwareMinAmp, `Minimum charging current the charger hardware accepts`, "A", "value.current");
        }
        this.applyWallboxCurrentLimits(iWB);
    }
    validateBatteryModeConfig(value) {
        if (value === undefined || value === null) {
            return "priority";
        }
        if (value !== "disabled" && value !== "minimumSoc" && value !== "priority") {
            this.log.warn(`Config batteryMode is invalid (${JSON.stringify(value)}); using priority`);
            return "priority";
        }
        return value;
    }
    validateNonNegativeConfig(value, fallback, name) {
        if (value === undefined || value === null) {
            return fallback;
        }
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
            this.log.warn(`Config ${name} is invalid (${JSON.stringify(value)}); using ${fallback}`);
            return fallback;
        }
        return value;
    }
    validateBoundedIntConfig(value, fallback, minimum, maximum, name) {
        if (value === undefined || value === null) {
            return fallback;
        }
        if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
            this.log.warn(`Config ${name} is invalid (${JSON.stringify(value)}); using ${fallback}`);
            return fallback;
        }
        return value;
    }
    syncPhaseMode(iWB) {
        const info = this.wallboxInfoList[iWB];
        void this.setState(`Wallbox_${iWB}.Settings.PhaseMode`, (0, chargeManagerUtils_1.phaseModeOf)(info.AutoPhase, info.Charge3Phase), true);
    }
    resetIdleRelease(iWB) {
        this.wallboxInfoList[iWB].IdleReleaseDelay = 0;
        this.wallboxInfoList[iWB].IdleReleaseLatched = false;
    }
    resetChargeNowSession(iWB) {
        this.wallboxInfoList[iWB].ChargeNowSawVehicle = false;
        this.wallboxInfoList[iWB].ChargeNowIdleDelay = 0;
    }
    switchOffOtherMode(iWB, mode, enabledMode) {
        if (!this.wallboxInfoList[iWB][mode]) {
            return;
        }
        this.wallboxInfoList[iWB][mode] = false;
        this.resetChargeNowSession(iWB);
        void this.setState(`Wallbox_${iWB}.Settings.${mode}`, false, true);
        this.log.info(`Charger ${this.wallboxLabel(iWB)}: ${mode} switched off because ${enabledMode} was enabled`);
    }
    async endChargeNowWhenDone(iWB) {
        const info = this.wallboxInfoList[iWB];
        const decision = (0, chargeManagerUtils_1.decideChargeNowEnd)({
            carState: info.CarState,
            stopWhenCarIdle: !!this.config.wallBoxList[iWB].stopWhenCarIdle,
            releaseActive: info.Reported.alw === 1,
            chargePower: info.ChargePower,
            delayCycles: Math.ceil(chargeManagerUtils_1.IDLE_RELEASE_DELAY_MS / this.config.cycleTime),
            state: { sawVehicle: info.ChargeNowSawVehicle, idleDelay: info.ChargeNowIdleDelay },
        });
        info.ChargeNowSawVehicle = decision.nextState.sawVehicle;
        info.ChargeNowIdleDelay = decision.nextState.idleDelay;
        if (decision.end === null) {
            return;
        }
        info.ChargeNOW = false;
        await this.setState(`Wallbox_${iWB}.Settings.ChargeNOW`, false, true);
        this.log.info(`Charger ${this.wallboxLabel(iWB)}: ChargeNOW switched off - ${decision.end === "unplugged" ? `vehicle unplugged` : `vehicle stopped drawing power, battery full or charge ended`}`);
    }
    async stopChargeManager(reason, iWB) {
        this.wallboxInfoList[iWB].SetAmp = 0;
        this.wallboxInfoList[iWB].DelayOff = 0;
        this.resetIdleRelease(iWB);
        await this.setChargeState(iWB, reason);
        if ((await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true) {
            await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, reason, iWB);
        }
    }
    async setChargeState(iWB, reason) {
        if (this.wallboxInfoList[iWB].ChargeState === reason) {
            return;
        }
        await this.projectUtils.checkAndSetValue(`Wallbox_${iWB}.info.chargeState`, reason, `Why the charger is charging or not`, "text");
        this.wallboxInfoList[iWB].ChargeState = reason;
        this.log.info(`Charger ${this.wallboxLabel(iWB)}: ${reason}`);
    }
    wallboxLabel(iWB, withIp = false) {
        const wallBox = this.config.wallBoxList[iWB];
        return (0, chargeManagerUtils_1.wallboxLabel)(iWB, wallBox?.chargerName, withIp ? wallBox?.ipAddress : undefined);
    }
    chargeManagerMinimum(iWB) {
        return Math.min(Math.max(chargeManagerMinCurrent, this.wallboxInfoList[iWB].MinAmp), this.wallboxInfoList[iWB].MaxAmp);
    }
    async Read_ChargerAPIV1(iWB) {
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/status`, { transformResponse: r => r })
            .then(async (response) => {
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger ${this.wallboxLabel(iWB)} API V1: ${response.data}`);
            await this.ParseStatusAPIV1(result, iWB);
            await this.setWallboxReachable(iWB);
        })
            .catch(async (error) => {
            this.wallboxInfoList[iWB].Reported = {};
            this.wallboxInfoList[iWB].ChargePower = Number.NaN;
            this.wallboxInfoList[iWB].RequestedAllow = null;
            this.wallboxInfoList[iWB].ReleaseRejects = 0;
            if (!(0, chargeManagerUtils_1.isConnectionError)(error)) {
                this.log.error(`Unexpected API V1 response from charger ${this.wallboxLabel(iWB, true)}: ${error} - check firmware/API version`);
                return;
            }
            if (error.message && error.message.includes("EHOSTUNREACH")) {
                this.wallboxInfoList[iWB].Firmware = `EHostUnreach`;
            }
            await this.setWallboxUnreachable(iWB, error);
        });
    }
    async setWallboxReachable(iWB) {
        const info = this.wallboxInfoList[iWB];
        if ((0, chargeManagerUtils_1.connectionTransition)(info.Online, true) === null) {
            return;
        }
        const wasOffline = info.Online === false;
        info.Online = true;
        await this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
        if (wasOffline) {
            this.log.info(`Charger ${this.wallboxLabel(iWB, true)} is reachable again`);
        }
    }
    async setWallboxUnreachable(iWB, error) {
        const info = this.wallboxInfoList[iWB];
        if ((0, chargeManagerUtils_1.connectionTransition)(info.Online, false) === null) {
            this.log.debug(`Charger ${this.wallboxLabel(iWB, true)} still unreachable: ${String(error)}`);
            return;
        }
        info.Online = false;
        this.log.error(`Charger ${this.wallboxLabel(iWB)} unreachable when calling go-eCharger API: ${String(error)}`);
        this.log.error(`Please verify IP address of charger ${this.wallboxLabel(iWB, true)} !!! Further errors are logged at debug level until it is reachable again.`);
        info.CarState = 0;
        info.MeasuredMaxChargeAmp = 0;
        info.ForceState = Number.NaN;
        await this.setState(`Wallbox_${iWB}.info.connection`, { val: false, ack: true });
        for (const state of chargeManagerUtils_1.LIVE_WALLBOX_STATES) {
            const id = `Wallbox_${iWB}.${state}`;
            if (await this.getObjectAsync(id)) {
                await this.setState(id, { val: null, ack: true });
            }
        }
    }
    async ParseStatusAPIV1(status, iWB) {
        const basePath = `Wallbox_${iWB}`;
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.statistics.rebootCounter`, Number(status.rbc), `Counter for system reboot events`, "", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.statistics.rebootTimer`, Math.floor(status.rbt / 1000 / 3600), `Time since last reboot`, "h", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.carState`, Number(status.car), `State of connected car`, "", "value");
        this.wallboxInfoList[iWB].CarState = Number(status.car) || 0;
        switch (status.car) {
            case "1":
                await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, `Wallbox ready, no car`, `State of connected car`, "text");
                break;
            case "2":
                await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, `Charging...`, `State of connected car`, "text");
                break;
            case "3":
                await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, `Wait for car`, `State of connected car`, "text");
                break;
            case "4":
                await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, `Charge finished, car still connected`, `State of connected car`, "text");
                break;
            default:
                await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, `Error`, `State of connected car`, `text`);
        }
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(status.amp), `Charge current output`, "A", "level.current");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrentVolatile`, Number(status.amx), `Charge current output volatile`, "A", "value.current");
        this.wallboxInfoList[iWB].Reported = { alw: Number(status.alw), amp: Number(status.amp), amx: Number(status.amx) };
        const rejectsBefore = this.wallboxInfoList[iWB].ReleaseRejects;
        this.wallboxInfoList[iWB].ReleaseRejects = (0, chargeManagerUtils_1.updateReleaseRejects)(Number(status.alw), this.wallboxInfoList[iWB].RequestedAllow, rejectsBefore);
        if (rejectsBefore < chargeManagerUtils_1.RELEASE_RETRY_LIMIT && this.wallboxInfoList[iWB].ReleaseRejects >= chargeManagerUtils_1.RELEASE_RETRY_LIMIT) {
            this.log.info(`Charger ${this.wallboxLabel(iWB)}: the charge release was ignored ${this.wallboxInfoList[iWB].ReleaseRejects} times in a row - still retrying, but only every ${chargeManagerUtils_1.RELEASE_RETRY_INTERVAL} cycles from now on`);
        }
        switch (status.alw) {
            case "0":
                await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, false, `Charging allowed`, "indicator");
                break;
            case "1":
                await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, true, `Charging allowed`, "indicator");
                break;
        }
        this.wallboxInfoList[iWB].GridPhases = ((32 & status.pha) >> 5) + ((16 & status.pha) >> 4) + ((8 & status.pha) >> 3);
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.GridPhases`, this.wallboxInfoList[iWB].GridPhases, `No of available grid phases`, "phase", "value");
        this.setWallboxHardwareLimits(iWB, this.combineHardwareMax(Number(status.ama), Number(status.cbl)), 0, basePath);
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.statistics.chargedEnergy`, status.eto / 10, `Totally charged in wallbox lifetime`, "kWh", "value.energy.consumed");
        this.wallboxInfoList[iWB].ChargePower = (0, chargeManagerUtils_1.chargePowerFromStatusV1)(status.nrg);
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.Charge`, this.wallboxInfoList[iWB].ChargePower, `actual charging-power`, "W", "value.power");
        const measuredMaxPhaseCurrent = Math.max(...status.nrg.slice(4, 7)) / 10;
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.MeasuredMaxPhaseCurrent`, measuredMaxPhaseCurrent, `Measured max. current of grid phases`, "A", "value.current");
        (0, chargeManagerUtils_1.phaseVoltagesFromNrg)(status.nrg, status.pha).forEach((voltage, index) => {
            if (voltage !== null) {
                void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.VoltageL${index + 1}`, voltage, `Measured voltage of grid phase L${index + 1}`, "V", "value.voltage");
            }
        });
        this.wallboxInfoList[iWB].MeasuredMaxChargeAmp = Math.round(measuredMaxPhaseCurrent);
        this.wallboxInfoList[iWB].Firmware = status.fwv;
        void this.projectUtils.checkAndSetValue(`${basePath}.info.firmwareVersion`, status.fwv, `Firmware version of charger`, `info.firmware`);
        if (status.ast !== undefined && status.ast !== null) {
            void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.accessControlState`, Number(status.ast), `Access control state`, "", "value");
        }
        if (!this.wallboxInfoList[iWB].HardwareMin3) {
            await this.parseAndSetRFIDData(status, basePath);
            if (status.uby !== undefined && status.uby !== null) {
                await this.setUnlockedByRFID(Number(status.uby), basePath);
            }
        }
        this.log.debug(`got and parsed go-e charger ${this.wallboxLabel(iWB)} data`);
    }
    async setUnlockedByRFID(cardNo, basePath) {
        await this.projectUtils.checkAndSetValueNumber(`${basePath}.info.unlockedByRFIDNo`, cardNo, `Number of current session RFID chip`);
        let cardName = "";
        if (cardNo > 0) {
            cardName = (await this.projectUtils.getStateValue(`${basePath}.statistics.RFID${cardNo}.cardName`)) || "";
        }
        await this.projectUtils.checkAndSetValue(`${basePath}.info.unlockedByRFIDName`, cardName, `Name of current session RFID chip`, "text");
    }
    async parseAndSetRFIDData(status, basePath) {
        const rfidIds = ["rca", "rcr", "rcd", "rc4", "rc5", "rc6", "rc7", "rc8", "rc9", "rc1"];
        const rfidNames = ["rna", "rnm", "rne", "rn4", "rn5", "rn6", "rn7", "rn8", "rn9", "rn1"];
        const rfidEnergy = ["eca", "ecr", "ecd", "ec4", "ec5", "ec6", "ec7", "ec8", "ec9", "ec1"];
        for (let i = 0; i < 10; i++) {
            const cardId = status[rfidIds[i]]?.toString().trim();
            const cardName = status[rfidNames[i]]?.toString().trim();
            const energyRaw = status[rfidEnergy[i]];
            if (!cardId || cardId === "0") {
                continue;
            }
            const cardNumber = i + 1;
            const channelPath = `${basePath}.statistics.RFID${cardNumber}`;
            await this.projectUtils.checkAndSetChannel(channelPath, cardName || `Card ${cardNumber}`);
            await this.projectUtils.checkAndSetValueNumber(`${channelPath}.chargedEnergy`, Number(energyRaw) / 10 || 0, `Charged energy for RFID chip ${cardNumber}`, "kWh", "value.energy.consumed");
            if (cardId !== "n/a") {
                await this.projectUtils.checkAndSetValue(`${channelPath}.cardId`, cardId, `RFID Card ID ${cardNumber}`);
            }
            if (cardName && cardName !== "n/a") {
                await this.projectUtils.checkAndSetValue(`${channelPath}.cardName`, cardName, `RFID Card Name ${cardNumber}`);
            }
        }
    }
    async Read_ChargerAPIV2(iWB) {
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/status?filter=alw,frc,modelStatus,acu,eto,amp,rbc,rbt,car,pha,fwv,nrg,psm,typ,fhz,trx,ast,ama,cbl,mca,rca,rcr,rcd,rc4,rc5,rc6,rc7,rc8,rc9,rc1,rna,rnm,rne,rn4,rn5,rn6,rn7,rn8,rn9,rn1,eca,ecr,ecd,ec4,ec5,ec6,ec7,ec8,ec9,ec1`, {
            transformResponse: r => r,
        })
            .then(async (response) => {
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger ${this.wallboxLabel(iWB)} API V2: ${response.data}`);
            this.wallboxInfoList[iWB].HardwareMin3 = true;
            try {
                await this.ParseStatusAPIV2(result, iWB);
            }
            catch (error) {
                this.log.error(`Error parsing go-e charger ${this.wallboxLabel(iWB)} API V2 response: ${error}`);
            }
        })
            .catch(error => {
            this.wallboxInfoList[iWB].ForceState = Number.NaN;
            if (!(0, chargeManagerUtils_1.isConnectionError)(error)) {
                this.log.warn(`Unexpected API V2 response from charger ${this.wallboxLabel(iWB, true)}: ${error} - check firmware/API version`);
                return;
            }
            this.log.warn(`API V2 not reachable for charger ${this.wallboxLabel(iWB, true)} - normal for hardware gen 1/2; on gen 3+ enable "HTTP API v2" for phase switching and RFID session info. (${error})`);
        });
    }
    async ParseStatusAPIV2(status, iWB) {
        const basePath = `Wallbox_${iWB}`;
        switch (status.psm) {
            case 1:
                this.wallboxInfoList[iWB].EnabledPhases = 1;
                break;
            case 2:
                this.wallboxInfoList[iWB].EnabledPhases = 3;
                break;
            default:
                this.wallboxInfoList[iWB].EnabledPhases = 0;
        }
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.EnabledPhases`, this.wallboxInfoList[iWB].EnabledPhases, `No of enabled phases in go-e wallbox`, "phase", "value");
        this.log.debug(`got enabled phases for charger ${this.wallboxLabel(iWB)}: ${this.wallboxInfoList[iWB].EnabledPhases}`);
        this.wallboxInfoList[iWB].ForceState = typeof status.frc === "number" ? status.frc : Number.NaN;
        this.wallboxInfoList[iWB].Reported.alw = (0, chargeManagerUtils_1.releaseReadback)(this.wallboxInfoList[iWB].Reported.alw, this.wallboxInfoList[iWB].ForceState);
        this.wallboxInfoList[iWB].Hardware = status.typ;
        void this.projectUtils.checkAndSetValue(`${basePath}.info.hardwareVersion`, status.typ, `Hardware version of charger`, `info.hardware`);
        const gridFrequency = (0, chargeManagerUtils_1.gridFrequencyFromStatus)(status.fhz);
        if (gridFrequency !== null) {
            void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.GridFrequency`, gridFrequency, `Grid frequency`, "Hz", "value.frequency");
        }
        this.setWallboxHardwareLimits(iWB, this.combineHardwareMax(Number(status.ama), Number(status.cbl)), Number(status.mca), basePath);
        if (status.ast !== undefined && status.ast !== null) {
            void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.accessControlState`, Number(status.ast), `Access control state`, "", "value");
        }
        await this.parseAndSetRFIDData(status, basePath);
        if (status.trx !== undefined) {
            await this.setUnlockedByRFID(status.trx === null ? 0 : Number(status.trx), basePath);
        }
        this.log.debug(`got and parsed go-e charger ${this.wallboxLabel(iWB)} data with API V2`);
    }
    async Switch_3Phases(Charge3Phase, iWB) {
        if (!this.wallboxInfoList[iWB].HardwareMin3) {
            return;
        }
        if (this.config.wallBoxList[iWB].readOnlyMode) {
            this.log.debug(`Charger ${this.wallboxLabel(iWB)} is in read-only mode - skipping phase switching`);
            return;
        }
        const psm = (0, chargeManagerUtils_1.phaseModeToSend)(Charge3Phase, this.wallboxInfoList[iWB].EnabledPhases);
        if (psm === null) {
            return;
        }
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/set?psm=${psm}`, { transformResponse: r => r })
            .then(response => {
            this.log.debug(`Sent: PSM=${psm} to charger ${this.wallboxLabel(iWB)} → Response: ${response.statusText}`);
        })
            .catch(error => {
            this.log.warn(`Error: ${error} while setting 3 phases to charger ${this.wallboxLabel(iWB, true)} = ${Charge3Phase}`);
            this.log.error(`Please verify IP address of charger ${this.wallboxLabel(iWB, true)} !!!`);
        });
    }
    async Charge_Config(Allow, Ampere, LogMessage, iWB) {
        const basePath = `Wallbox_${iWB}`;
        if (this.config.wallBoxList[iWB].readOnlyMode) {
            this.log.debug(`Charger ${this.wallboxLabel(iWB)} is in read-only mode - skipping charge config write (${LogMessage}  -  ${Ampere} Ampere)`);
            return;
        }
        if (Allow !== "0" && Allow !== "1") {
            this.log.warn(`Invalid charge release value for charger ${this.wallboxLabel(iWB)}: ${Allow}`);
            return;
        }
        const commands = (0, chargeManagerUtils_1.buildChargerCommands)(Allow === "1", Ampere, this.wallboxInfoList[iWB].Firmware);
        if (!commands) {
            this.log.warn(`Invalid charging current for charger ${this.wallboxLabel(iWB)}: ${Ampere} A`);
            return;
        }
        this.wallboxInfoList[iWB].ReleasedByAdapter = Allow === "1";
        let pending = (0, chargeManagerUtils_1.dropUnchangedChargerCommands)(commands, this.wallboxInfoList[iWB].Reported);
        if ((0, chargeManagerUtils_1.holdRejectedRelease)(this.wallboxInfoList[iWB].ReleaseRejects, this.wallboxInfoList[iWB].CarState)) {
            pending = pending.filter(command => command.parameter === "alw" && command.value === 0);
        }
        if (pending.length === 0) {
            return;
        }
        this.log.debug(`${LogMessage}  -  ${Ampere} Ampere`);
        for (const command of pending) {
            try {
                const response = await axiosInstance.get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=${command.parameter}=${command.value}`, { transformResponse: r => r });
                this.log.debug(`Sent to charger ${this.wallboxLabel(iWB)}: ${command.parameter}=${command.value}`);
                if (command.parameter === "alw") {
                    this.wallboxInfoList[iWB].RequestedAllow = command.value;
                    this.wallboxInfoList[iWB].Reported.alw = command.value;
                    await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, command.value === 1, `Charging allowed`, `indicator`);
                }
                else {
                    const result = JSON.parse(response.data);
                    await this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(result.amp), `Charge current output`, "A", "level.current");
                }
            }
            catch (error) {
                if (!(0, chargeManagerUtils_1.isConnectionError)(error)) {
                    this.log.warn(`Unexpected response from charger ${this.wallboxLabel(iWB, true)} to ${command.parameter}=${command.value}: ${String(error)} - check firmware/API version`);
                    return;
                }
                this.log.warn(`Error: ${String(error)} by writing to charger ${this.wallboxLabel(iWB, true)}: ${command.parameter}=${command.value}`);
                this.log.error(`Please verify IP address of charger ${this.wallboxLabel(iWB, true)} !!!`);
                return;
            }
        }
    }
    async planChargeManagerCycle() {
        const plans = new Array(this.config.wallBoxList.length).fill(undefined);
        const candidates = [...this.config.wallBoxList.keys()].filter(iWB => this.wallboxInfoList[iWB].ChargeManager && !this.wallboxInfoList[iWB].ChargeNOW && this.wallboxInfoList[iWB].Online !== false);
        if (!candidates.length) {
            return plans;
        }
        let subtractChargerPower = this.config.subtractSelfConsumption;
        if (chargeManagerGridMode === "gridMeter") {
            const gridPower = this.readGridMeter();
            ({ solarPower, houseConsumption, subtractChargerPower } = (0, chargeManagerUtils_1.surplusInputsFromGridMeter)(gridPower));
        }
        else {
            solarPower = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeSolarPower);
            this.log.debug(`Got external state of solar power: ${solarPower} W`);
            houseConsumption = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomePowerConsumption);
            this.log.debug(`Got external state of house power consumption: ${houseConsumption} W`);
        }
        const batteryState = chargeManagerBatteryMode === "disabled" ? null : await this.projectUtils.asyncGetForeignState(this.config.stateHomeBatSoc);
        const batterySocAgeMs = batteryState ? Date.now() - batteryState.ts : null;
        let batterySoc = null;
        const participants = [];
        const served = [];
        let fleetChargePower = 0;
        for (const iWB of candidates) {
            this.wallboxInfoList[iWB].ChargePower = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.Charge`);
            if (!this.wallboxInfoList[iWB].ChargeManagerRunning) {
                const seed = (0, chargeManagerUtils_1.seedChargeManagerState)(this.wallboxInfoList[iWB].Reported.alw, this.wallboxInfoList[iWB].Reported.amp, this.chargeManagerMinimum(iWB), this.wallboxInfoList[iWB].MaxAmp);
                this.wallboxInfoList[iWB].SetAmp = seed.currentAmp;
                this.wallboxInfoList[iWB].DelayOff = seed.shutdownDelay;
                this.wallboxInfoList[iWB].PhaseSwitchDelay = 0;
                this.wallboxInfoList[iWB].ChargeManagerRunning = true;
            }
            const batteryDecision = (0, chargeManagerUtils_1.evaluateBatteryAvailability)({
                mode: chargeManagerBatteryMode,
                batterySoc: batteryState?.val,
                minimumBatterySoc: minHomeBatVal,
                batterySocAgeMs,
                maximumAgeSeconds: chargeManagerBatterySocMaxAgeSeconds,
                hysteresis: chargeManagerBatterySocHysteresis,
                wasReady: this.wallboxInfoList[iWB].BatteryReady,
            });
            this.wallboxInfoList[iWB].BatteryReady = batteryDecision.ready;
            if (!batteryDecision.ready) {
                plans[iWB] = { decision: null, batteryReason: batteryDecision.reason };
                continue;
            }
            batterySoc = batteryDecision.batterySoc;
            const phases = this.wallboxInfoList[iWB].HardwareMin3 && this.wallboxInfoList[iWB].EnabledPhases
                ? this.wallboxInfoList[iWB].EnabledPhases
                : this.wallboxInfoList[iWB].GridPhases;
            const carState = this.wallboxInfoList[iWB].CarState;
            participants.push({
                phases,
                maximumChargeCurrent: this.wallboxInfoList[iWB].MaxAmp,
                minimumChargeCurrent: this.chargeManagerMinimum(iWB),
                state: { currentAmp: this.wallboxInfoList[iWB].SetAmp, shutdownDelay: this.wallboxInfoList[iWB].DelayOff },
                claimsPower: carState === 2 || carState === 3,
                released: this.wallboxInfoList[iWB].Reported.alw === 1,
            });
            served.push(iWB);
            fleetChargePower += this.wallboxInfoList[iWB].ChargePower;
        }
        if (batterySoc !== null) {
            this.log.debug(`Got external state of battery SoC: ${batterySoc}%`);
        }
        const decisions = (0, chargeManagerUtils_1.decideChargeManagerFleet)({
            solarPower,
            houseConsumption,
            chargerPower: fleetChargePower,
            subtractChargerPower,
            batterySoc,
            minBatterySoc: minHomeBatVal,
            batteryMode: chargeManagerBatteryMode,
            reservePower: chargeManagerReservePower,
            maximumBatteryBonus: chargeManagerMaxBatteryBonus,
        }, participants);
        served.forEach((iWB, index) => {
            plans[iWB] = { decision: decisions[index], batteryReason: "available" };
            const decision = decisions[index];
            const carState = this.wallboxInfoList[iWB].CarState;
            this.log.debug(`ChargeManager charger ${this.wallboxLabel(iWB)}: surplus ${Math.round(decision.availablePower)} W → optimal ${decision.optimalCurrent ?? 0} A, ramp ${decision.nextState.currentAmp} A, action=${decision.action} (${decision.reason}), car=${carState}`);
            if (this.wallboxInfoList[iWB].AutoPhase && this.wallboxInfoList[iWB].HardwareMin3 && !(0, chargeManagerUtils_1.isVehicleDisconnected)(this.wallboxInfoList[iWB].CarState)) {
                const participant = participants[index];
                const phaseDecision = (0, chargeManagerUtils_1.decidePhaseSwitch)({
                    currentPhases: this.wallboxInfoList[iWB].EnabledPhases,
                    availablePower: decisions[index].availablePower,
                    minimumChargeCurrent: participant.minimumChargeCurrent,
                    maximumChargeCurrent: participant.maximumChargeCurrent,
                    switchDelay: this.wallboxInfoList[iWB].PhaseSwitchDelay,
                });
                this.wallboxInfoList[iWB].PhaseSwitchDelay = phaseDecision.switchDelay;
                this.log.debug(`ChargeManager charger ${this.wallboxLabel(iWB)} phase: ${this.wallboxInfoList[iWB].EnabledPhases}p now, target ${phaseDecision.targetPhases}p, dwell ${phaseDecision.switchDelay}`);
                this.wallboxInfoList[iWB].ManagedCharge3Phase = phaseDecision.targetPhases === 3;
                if (phaseDecision.targetPhases !== this.wallboxInfoList[iWB].EnabledPhases) {
                    this.log.info(`ChargeManager: switching charger ${this.wallboxLabel(iWB)} to ${phaseDecision.targetPhases}-phase charging (surplus ${Math.round(decisions[index].availablePower)} W)`);
                    decision.nextState.currentAmp = (0, chargeManagerUtils_1.carryCurrentOverPhaseSwitch)(decision.nextState.currentAmp, this.wallboxInfoList[iWB].EnabledPhases, phaseDecision.targetPhases, participant.minimumChargeCurrent, participant.maximumChargeCurrent, decisions[index].availablePower);
                }
            }
        });
        return plans;
    }
    planTotalCurrentBudget(chargePlans) {
        const participants = this.config.wallBoxList.map((_, iWB) => {
            const info = this.wallboxInfoList[iWB];
            const hasVehicle = info.CarState === 2 || info.CarState === 3;
            if (!hasVehicle) {
                info.ReclaimDelay = 0;
                return { requestedAmp: 0, minAmp: info.MinAmp, chargeNow: !!info.ChargeNOW };
            }
            let wish = 0;
            let chargeNow = false;
            if (info.ChargeNOW) {
                wish = Math.min(Math.max(info.ChargeCurrent, info.MinAmp), info.MaxAmp);
                chargeNow = true;
            }
            else if (info.ChargeManager) {
                const decision = chargePlans[iWB]?.decision;
                wish = decision && decision.optimalCurrent !== null && decision.action !== "disable" ? decision.nextState.currentAmp : 0;
            }
            if (wish <= 0) {
                info.ReclaimDelay = 0;
                return { requestedAmp: 0, minAmp: info.MinAmp, chargeNow };
            }
            const { demand, reclaimDelay } = (0, chargeManagerUtils_1.effectiveCurrentDemand)({
                commandedAmp: info.SetAmp,
                measuredAmp: info.MeasuredMaxChargeAmp,
                wishAmp: wish,
                minAmp: info.MinAmp,
                maxAmp: info.MaxAmp,
                reclaimDelay: info.ReclaimDelay,
            });
            info.ReclaimDelay = reclaimDelay;
            return { requestedAmp: demand, minAmp: info.MinAmp, chargeNow };
        });
        const allocations = (0, chargeManagerUtils_1.limitTotalCurrent)(participants, maxAmpTotal);
        let used = 0;
        const summary = allocations.map((alloc, iWB) => {
            used += alloc.ampere;
            const req = participants[iWB].requestedAmp;
            if (req <= 0) {
                return `${this.wallboxLabel(iWB)} idle`;
            }
            const tag = participants[iWB].chargeNow ? "NOW" : "CM";
            const state = !alloc.allow ? "off" : alloc.ampere < req ? `${alloc.ampere} A throttled` : `${alloc.ampere} A`;
            return `${this.wallboxLabel(iWB)} ${tag} req ${req}->${state}`;
        });
        this.log.debug(`Total current budget ${maxAmpTotal} A: ${summary.join(" | ")} (used ${used}/${maxAmpTotal} A)`);
        return allocations;
    }
    async Charge_Manager(iWB, decision) {
        if (decision.optimalCurrent === null) {
            this.log.warn(`ChargeManager inputs are invalid for charger ${this.wallboxLabel(iWB)}; charging will be disabled`);
            await this.stopChargeManager(`Invalid ChargeManager input`, iWB);
            return;
        }
        this.wallboxInfoList[iWB].SetOptAmp = decision.optimalCurrent;
        this.log.debug(`Optimal charging current would be: ${this.wallboxInfoList[iWB].SetOptAmp} A`);
        this.wallboxInfoList[iWB].SetAmp = decision.nextState.currentAmp;
        this.wallboxInfoList[iWB].DelayOff = decision.nextState.shutdownDelay;
        this.log.debug(`ZielAmpere: ${this.wallboxInfoList[iWB].SetAmp} A; Solar: ${solarPower} W; House: ${houseConsumption} W; Charger: ${this.wallboxInfoList[iWB].ChargePower} W`);
        if (this.config.wallBoxList[iWB].stopWhenCarIdle) {
            const idle = (0, chargeManagerUtils_1.decideIdleRelease)({
                releaseActive: (await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true,
                carState: this.wallboxInfoList[iWB].CarState,
                chargePower: Number(this.wallboxInfoList[iWB].ChargePower),
                controllerAction: decision.action,
                delayCycles: Math.ceil(chargeManagerUtils_1.IDLE_RELEASE_DELAY_MS / this.config.cycleTime),
                state: { idleDelay: this.wallboxInfoList[iWB].IdleReleaseDelay, latched: this.wallboxInfoList[iWB].IdleReleaseLatched },
            });
            this.wallboxInfoList[iWB].IdleReleaseDelay = idle.nextState.idleDelay;
            this.wallboxInfoList[iWB].IdleReleaseLatched = idle.nextState.latched;
            if (idle.withdraw) {
                await this.setChargeState(iWB, `Vehicle does not draw power despite the charge release - release withdrawn until it is unplugged or the surplus ends`);
                await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, `Vehicle not charging`, iWB);
                return;
            }
            if (idle.nextState.latched) {
                return;
            }
        }
        if (decision.action === "enable") {
            await this.setChargeState(iWB, `Charging from PV surplus`);
            await this.Charge_Config("1", this.wallboxInfoList[iWB].SetAmp, `Charging current: ${this.wallboxInfoList[iWB].SetAmp} A`, iWB);
        }
        else if (decision.action === "disable") {
            await this.setChargeState(iWB, `Not enough PV surplus`);
            await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, `Insufficient surplus`, iWB);
        }
        else {
            const hold = (0, chargeManagerUtils_1.describeHold)(decision.optimalCurrent, this.chargeManagerMinimum(iWB), this.wallboxInfoList[iWB].Reported.alw === 1);
            await this.setChargeState(iWB, hold === "not-enough"
                ? `Not enough PV surplus`
                : hold === "charging"
                    ? `Charging from PV surplus`
                    : `Ramping up from PV surplus to the ${(0, chargeManagerUtils_1.resolveStartChargeCurrent)(this.chargeManagerMinimum(iWB), this.wallboxInfoList[iWB].MaxAmp)} A needed to start`);
        }
    }
    isLikeEmpty(inputVar) {
        if (inputVar === undefined || inputVar === null) {
            return true;
        }
        const sTemp = JSON.stringify(inputVar)
            .replace(/\s+/g, "")
            .replace(/"+/g, "")
            .replace(/'+/g, "")
            .replace(/\[+/g, "")
            .replace(/\]+/g, "")
            .replace(/\{+/g, "")
            .replace(/\}+/g, "");
        return sTemp === "";
    }
}
if (require.main !== module) {
    module.exports = (options) => new go_e_charger(options);
}
else {
    (() => new go_e_charger())();
}
//# sourceMappingURL=main.js.map