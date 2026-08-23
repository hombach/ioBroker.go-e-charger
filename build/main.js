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
let batSoC = 0;
let solarPower = 0;
let houseConsumption = 0;
let totalChargeEnergy = 0;
let totalChargePower = 0;
let chargeManagerReservePower = chargeManagerUtils_1.DEFAULT_RESERVE_POWER;
let chargeManagerMaxBatteryBonus = chargeManagerUtils_1.DEFAULT_MAXIMUM_BATTERY_BONUS;
let chargeManagerMinCurrent = chargeManagerUtils_1.MIN_CHARGE_CURRENT;
let maxChargeCurrent = chargeManagerUtils_1.MAX_CHARGE_CURRENT;
class go_e_charger extends utils.Adapter {
    projectUtils = new projectUtils_1.ProjectUtils(this);
    wallboxInfoList = [];
    stateMachineTimeout;
    isUnloading = false;
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
                Firmware: "0",
                Hardware: "V2",
                HardwareMin3: false,
                GridPhases: 0,
                ChargeNOW: false,
                ChargeManager: false,
                ChargeCurrent: 6,
                ChargePower: 0,
                Charge3Phase: false,
                EnabledPhases: 0,
                MeasuredMaxChargeAmp: 0,
                MinAmp: 6,
                MaxAmp: maxChargeCurrent,
                DelayOff: 0,
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
                this.log.debug(`Setting up Wallbox ${iWB} with IP ${wallBox.ipAddress} in config`);
                if (!wallBox.ipAddress) {
                    throw new Error(`Wallbox ${iWB} - IP address not set - stopping adapter`);
                }
                await this.projectUtils.checkAndSetDevice(`Wallbox_${iWB}`, wallBox.chargerName || `Wallbox ${iWB}`, `info.connection`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.info`, `Informations about go-eCharger`, `go-eCharger.png`, true);
                await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.info.connection`, false, `Device connected`, "indicator.connected");
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
                    await this.Read_ChargerAPIV2(iWB);
                    this.log.info(`IP address charger ${iWB} found in config: ${wallBox.ipAddress}`);
                    void this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
                }
                this.wallboxInfoList[iWB].ChargeNOW = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeNOW`);
                this.wallboxInfoList[iWB].ChargeManager = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeManager`);
                this.wallboxInfoList[iWB].ChargeCurrent = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeCurrent`);
                this.wallboxInfoList[iWB].Charge3Phase = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.Charge3Phase`);
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
                                    chargerNo = Number(statePath[2].replace("Wallbox_", ""));
                                    settingType = statePath[4];
                                    switch (settingType) {
                                        case "ChargeNOW":
                                            if (typeof state.val === "boolean") {
                                                this.wallboxInfoList[chargerNo].ChargeNOW = state.val;
                                                this.log.debug(`settings state changed to ChargeNOW: ${this.wallboxInfoList[chargerNo].ChargeNOW}`);
                                                void this.setState(id, state.val, true);
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
                                            }
                                            else {
                                                this.log.warn(`Wrong type for Charge3Phase: ${state.val}`);
                                            }
                                            break;
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
            this.log.debug(`Initial ReadCharger done, detected charger ${iWB} firmware ${this.wallboxInfoList[iWB].Firmware}`);
            switch (this.wallboxInfoList[iWB].Firmware) {
                case "0":
                case "EHostUnreach":
                    this.log.warn(`No charger detected on IP address ${this.config.wallBoxList[iWB].ipAddress} for charger ${iWB}`);
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
                    this.log.warn(`Not explicitly supported firmware ${this.wallboxInfoList[iWB].Firmware} for charger ${iWB} found!!!`);
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
                await this.Read_ChargerAPIV1(iWB);
                if (this.wallboxInfoList[iWB].HardwareMin3) {
                    await this.Read_ChargerAPIV2(iWB);
                }
                if (this.wallboxInfoList[iWB].ChargeNOW) {
                    const chargeNowCurrent = Math.min(this.wallboxInfoList[iWB].ChargeCurrent, maxChargeCurrent);
                    await this.Charge_Config("1", chargeNowCurrent, `activate go-eCharger for forced charging`, iWB);
                    await this.Switch_3Phases(this.wallboxInfoList[iWB].Charge3Phase, iWB);
                    if (this.wallboxInfoList[iWB].HardwareMin3) {
                        await this.Read_ChargerAPIV2(iWB);
                    }
                }
                else if (this.wallboxInfoList[iWB].ChargeManager) {
                    batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
                    this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
                    if (typeof batSoC !== "number" ||
                        !Number.isFinite(batSoC) ||
                        batSoC < 0 ||
                        batSoC > 100 ||
                        !Number.isFinite(minHomeBatVal) ||
                        minHomeBatVal < 0 ||
                        minHomeBatVal > 100) {
                        await this.stopChargeManager(`Invalid battery state of charge or setpoint`, iWB);
                    }
                    else if (batSoC >= minHomeBatVal) {
                        await this.Switch_3Phases(this.wallboxInfoList[iWB].Charge3Phase, iWB);
                        await this.Charge_Manager(iWB);
                    }
                    else {
                        await this.stopChargeManager(`Charging home battery until ${minHomeBatVal}%`, iWB);
                    }
                }
                else {
                    if ((await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true) {
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
    async stopChargeManager(reason, iWB) {
        this.wallboxInfoList[iWB].SetAmp = 0;
        this.wallboxInfoList[iWB].DelayOff = 0;
        if ((await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true) {
            await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, reason, iWB);
        }
    }
    async Read_ChargerAPIV1(iWB) {
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/status`, { transformResponse: r => r })
            .then(async (response) => {
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger ${iWB} API V1: ${response.data}`);
            await this.ParseStatusAPIV1(result, iWB);
        })
            .catch(error => {
            if (error.message && error.message.includes("EHOSTUNREACH")) {
                this.log.error(`Charger unreachable error when calling go-eCharger API: ${error}`);
                this.wallboxInfoList[iWB].Firmware = `EHostUnreach`;
            }
            else {
                this.log.error(`Error in calling go-e charger ${iWB} API: ${error}`);
            }
            this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
        });
    }
    async ParseStatusAPIV1(status, iWB) {
        const basePath = `Wallbox_${iWB}`;
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.statistics.rebootCounter`, Number(status.rbc), `Counter for system reboot events`, "", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.statistics.rebootTimer`, Math.floor(status.rbt / 1000 / 3600), `Time since last reboot`, "h", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.carState`, Number(status.car), `State of connected car`, "", "value");
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
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.statistics.chargedEnergy`, status.eto / 10, `Totally charged in wallbox lifetime`, "kWh", "value.energy.consumed");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.Charge`, status.nrg[11] * 10, `actual charging-power`, "W", "value.power");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.MeasuredMaxPhaseCurrent`, Math.max(...status.nrg.slice(4, 7)) / 10, `Measured max. current of grid phases`, "A", "value.current");
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
        this.log.debug(`got and parsed go-e charger ${iWB} data`);
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
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/status?filter=alw,acu,eto,amp,rbc,rbt,car,pha,fwv,nrg,psm,typ,trx,ast,rca,rcr,rcd,rc4,rc5,rc6,rc7,rc8,rc9,rc1,rna,rnm,rne,rn4,rn5,rn6,rn7,rn8,rn9,rn1,eca,ecr,ecd,ec4,ec5,ec6,ec7,ec8,ec9,ec1`, {
            transformResponse: r => r,
        })
            .then(async (response) => {
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger ${iWB} API V2: ${response.data}`);
            this.wallboxInfoList[iWB].HardwareMin3 = true;
            try {
                await this.ParseStatusAPIV2(result, iWB);
            }
            catch (error) {
                this.log.error(`Error parsing go-e charger ${iWB} API V2 response: ${error}`);
            }
        })
            .catch(error => {
            this.log.warn(`API V2 not reachable for charger ${iWB} (${this.config.wallBoxList[iWB].ipAddress}) - normal for hardware gen 1/2; on gen 3+ enable "HTTP API v2" for phase switching and RFID session info. (${error})`);
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
        this.log.debug(`got enabled phases for charger ${iWB}: ${this.wallboxInfoList[iWB].EnabledPhases}`);
        this.wallboxInfoList[iWB].Hardware = status.typ;
        void this.projectUtils.checkAndSetValue(`${basePath}.info.hardwareVersion`, status.typ, `Hardware version of charger`, `info.hardware`);
        if (status.ast !== undefined && status.ast !== null) {
            void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.accessControlState`, Number(status.ast), `Access control state`, "", "value");
        }
        await this.parseAndSetRFIDData(status, basePath);
        if (status.trx !== undefined) {
            await this.setUnlockedByRFID(status.trx === null ? 0 : Number(status.trx), basePath);
        }
        this.log.debug(`got and parsed go-e charger ${iWB} data with API V2`);
    }
    async Switch_3Phases(Charge3Phase, iWB) {
        if (!this.wallboxInfoList[iWB].HardwareMin3) {
            return;
        }
        if (this.config.wallBoxList[iWB].readOnlyMode) {
            this.log.debug(`Charger ${iWB} is in read-only mode - skipping phase switching`);
            return;
        }
        const psm = Charge3Phase ? 2 : 1;
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/set?psm=${psm}`, { transformResponse: r => r })
            .then(response => {
            this.log.debug(`Sent: PSM=${psm} to charger ${iWB} → Response: ${response.statusText}`);
        })
            .catch(error => {
            this.log.warn(`Error: ${error} while setting 3 phases to charger ${iWB} = ${Charge3Phase} @ ${this.config.wallBoxList[iWB].ipAddress}`);
            this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
        });
    }
    async Charge_Config(Allow, Ampere, LogMessage, iWB) {
        this.log.debug(`${LogMessage}  -  ${Ampere} Ampere`);
        const basePath = `Wallbox_${iWB}`;
        if (this.config.wallBoxList[iWB].readOnlyMode) {
            this.log.debug(`Charger ${iWB} is in read-only mode - skipping charge config write`);
            return;
        }
        if (Allow !== "0" && Allow !== "1") {
            this.log.warn(`Invalid charge release value for charger ${iWB}: ${Allow}`);
            return;
        }
        const commands = (0, chargeManagerUtils_1.buildChargerCommands)(Allow === "1", Ampere, this.wallboxInfoList[iWB].Firmware);
        if (!commands) {
            this.log.warn(`Invalid charging current for charger ${iWB}: ${Ampere} A`);
            return;
        }
        for (const command of commands) {
            try {
                const response = await axiosInstance.get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=${command.parameter}=${command.value}`, { transformResponse: r => r });
                this.log.debug(`Sent to charger ${iWB}: ${command.parameter}=${command.value}`);
                if (command.parameter === "alw") {
                    await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, command.value === 1, `Charging allowed`, `indicator`);
                }
                else {
                    const result = JSON.parse(response.data);
                    await this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(result.amp), `Charge current output`, "A", "level.current");
                }
            }
            catch (error) {
                this.log.warn(`Error: ${String(error)} by writing to charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} ${command.parameter}=${command.value}`);
                this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
                return;
            }
        }
    }
    async Charge_Manager(iWB) {
        solarPower = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeSolarPower);
        this.log.debug(`Got external state of solar power: ${solarPower} W`);
        houseConsumption = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomePowerConsumption);
        this.log.debug(`Got external state of house power consumption: ${houseConsumption} W`);
        batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
        this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
        this.wallboxInfoList[iWB].ChargePower = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.Charge`);
        const Phases = this.wallboxInfoList[iWB].HardwareMin3 && this.wallboxInfoList[iWB].EnabledPhases
            ? this.wallboxInfoList[iWB].EnabledPhases
            : this.wallboxInfoList[iWB].GridPhases;
        const decision = (0, chargeManagerUtils_1.decideChargeManager)({
            solarPower,
            houseConsumption,
            chargerPower: this.wallboxInfoList[iWB].ChargePower,
            subtractChargerPower: this.config.subtractSelfConsumption,
            batterySoc: batSoC,
            minBatterySoc: minHomeBatVal,
            reservePower: chargeManagerReservePower,
            maximumBatteryBonus: chargeManagerMaxBatteryBonus,
            maximumChargeCurrent: maxChargeCurrent,
            minimumChargeCurrent: chargeManagerMinCurrent,
            phases: Phases,
            state: {
                currentAmp: this.wallboxInfoList[iWB].SetAmp,
                shutdownDelay: this.wallboxInfoList[iWB].DelayOff,
            },
        });
        if (decision.optimalCurrent === null) {
            this.log.warn(`ChargeManager inputs are invalid for charger ${iWB}; charging will be disabled`);
            await this.stopChargeManager(`Invalid ChargeManager input`, iWB);
            return;
        }
        this.wallboxInfoList[iWB].SetOptAmp = decision.optimalCurrent;
        this.log.debug(`Optimal charging current would be: ${this.wallboxInfoList[iWB].SetOptAmp} A`);
        this.wallboxInfoList[iWB].SetAmp = decision.nextState.currentAmp;
        this.wallboxInfoList[iWB].DelayOff = decision.nextState.shutdownDelay;
        this.log.debug(`ZielAmpere: ${this.wallboxInfoList[iWB].SetAmp} A; Solar: ${solarPower} W; House: ${houseConsumption} W; Charger: ${this.wallboxInfoList[iWB].ChargePower} W`);
        if (decision.action === "enable") {
            await this.Charge_Config("1", this.wallboxInfoList[iWB].SetAmp, `Charging current: ${this.wallboxInfoList[iWB].SetAmp} A`, iWB);
        }
        else if (decision.action === "disable") {
            await this.Charge_Config("0", this.wallboxInfoList[iWB].MinAmp, `Insufficient surplus`, iWB);
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