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
// The adapter-core module gives you access to the core ioBroker functions you need to create an adapter
const utils = __importStar(require("@iobroker/adapter-core"));
const axios_1 = __importDefault(require("axios"));
const projectUtils_1 = require("./lib/projectUtils");
const axiosInstance = axios_1.default.create({
//timeout: 5000, //by default
});
// variables
let minHomeBatVal = 85;
let batSoC = 0;
let solarPower = 0;
let houseConsumption = 0;
//ToDo let totalChargePower = 0;
//ToDo let totalMeasuredChargeCurrent = 0;
//let ZielAmpere = 5;
//let OptAmpere = 6;
class go_e_charger extends utils.Adapter {
    projectUtils = new projectUtils_1.ProjectUtils(this);
    timeoutList;
    //WiP
    wallboxInfoList = [];
    //WIP NEW adapterIntervals: NodeJS.Timeout[];
    /****************************************************************************************
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options = {}) {
        super({
            ...options,
            name: "go-e-charger",
        });
        this.on("ready", this.onReady.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.timeoutList = []; //WIP
        // WIP NEW this.adapterIntervals = [];
        this.wallboxInfoList = [];
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        if (!this.config.cycleTime) {
            this.log.warn(`Cycletime not configured or zero - will be set to 10 seconds`);
            this.config.cycleTime = 10000;
        }
        this.log.info(`Cycletime set to: ${this.config.cycleTime / 1000} seconds`);
        this.subscribeStates(`Settings.*`); // all states changes inside the adapters settings namespace are subscribed
        this.subscribeStates(`Charger.*`); // all states changes inside the adapters settings namespace are subscribed
        minHomeBatVal = await this.projectUtils.getStateValue("Settings.Setpoint_HomeBatSoC"); // Get desired battery SoC
        try {
            for (const [iWB, wallBox] of this.config.wallBoxList.entries()) {
                //for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
                if (!wallBox.ipAddress) {
                    //if (!this.config.wallBoxList[iWB].ipAddress) {
                    throw new Error(`Charger ${iWB} - IP address not set - stopping adapter`);
                }
                // init settings and info states for each charger
                await this.projectUtils.checkAndSetValue(`Charger.${iWB}.Info`, "", `Informations about go-eCharger`, "channel");
                await this.projectUtils.checkAndSetValue(`Charger.${iWB}.Power`, "", `current charger power data`, "channel");
                await this.projectUtils.checkAndSetValue(`Charger.${iWB}.Settings`, "", `states to dynamically adjust go-eCharger settings`, "channel");
                // init settings values for each charger in wallboxInfoList
                await this.projectUtils.checkAndSetValueBoolean(`Charger.${iWB}.Settings.ChargeNOW`, false, `ChargeNOW enabled`, "switch", true, true);
                await this.projectUtils.checkAndSetValueBoolean(`Charger.${iWB}.Settings.ChargeManager`, false, `Charge Manager enabled`, "switch", true, true);
                await this.projectUtils.checkAndSetValueNumber(`Charger.${iWB}.Settings.ChargeCurrent`, 6, `Setting charge current output`, "A", "value.current", true, true);
                await this.projectUtils.checkAndSetValueBoolean(`Charger.${iWB}.Info.Connection`, false, `Device connected`, "indicator.connected");
                if (wallBox.ipAddress) {
                    //if (this.config.wallBoxList[iWB].ipAddress) {
                    await this.Read_ChargerAPIV1(iWB);
                    await this.Read_ChargerAPIV2(iWB);
                    this.log.info(`IP address charger ${iWB} found in config: ${wallBox.ipAddress}`);
                    //this.log.info(`IP address charger ${iWB} found in config: ${this.config.wallBoxList[iWB].ipAddress}`);
                }
                this.wallboxInfoList[iWB].ChargeNOW = await this.projectUtils.getStateValue(`Charger.${iWB}.Settings.ChargeNOW`); // Get charging override trigger
                this.wallboxInfoList[iWB].ChargeManager = await this.projectUtils.getStateValue(`Charger.${iWB}.Settings.ChargeManager`); // Get enable for charge manager
                this.wallboxInfoList[iWB].ChargeCurrent = await this.projectUtils.getStateValue(`Charger.${iWB}.Settings.ChargeCurrent`); // Get current for charging override
                this.wallboxInfoList[iWB].Charge3Phase = await this.projectUtils.getStateValue(`Charger.${iWB}.Settings.Charge3Phase`); // Get enable of 3 phases for charging override
            }
        }
        catch (e) {
            this.log.error(e.message);
            void this.setState(`info.connection`, { val: false, ack: true });
            await this.stop?.({ exitCode: 11, reason: `invalid config` });
            return;
        }
        // sentry.io ping
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
                        Sentry.captureMessage("Adapter go-e-Charger started", "info"); // Level "info"
                    });
            }
        }
        await this.firstStart();
        this.log.debug(`Pre-init done, launching state machine interval`);
        const stateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.cycleTime));
        if (stateMachine != null) {
            this.timeoutList.push(stateMachine);
        }
    }
    /**
     * Is called if a subscribed state changes
     *
     * @param id - The id of the state that changed.
     * @param state - The changed state object, null if it was deleted.
     */
    onStateChange(id, state) {
        try {
            if (state) {
                // The state was changed  -  this.subscribeStates(`Settings.*`);  -  "go-e-charger.0.Settings.Setpoint_HomeBatSoC"
                // The state was changed  -  this.subscribeStates(`Charger.*`);  -  "go-e-charger.0.Charger.0.Settings.ChargeNOW"
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
                                        // Get desired battery SoC
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
                            case "Charger":
                                settingType = statePath[5];
                                chargerNo = Number(statePath[4]);
                                switch (settingType) {
                                    case "ChargeNOW":
                                        // Get charging override trigger
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
                                        // Get enable for charge manager
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
                                        // Get current for charging override
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
                                        // Get enable of 3 phases for charging override
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
                                break;
                            default:
                                this.log.debug(`unknown settings value`);
                        }
                    }
                }
            }
            else {
                // The state was deleted
                this.log.warn(`state ${id} deleted`);
            }
        }
        catch (e) {
            this.log.error(`Unhandled exception processing onStateChange: ${e}`);
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - callback
     */
    onUnload(callback) {
        try {
            this.timeoutList.forEach(timeoutJob => this.clearTimeout(timeoutJob));
            this.log.info(`Adapter go-eCharger cleaned up everything...`);
            void this.setState(`info.connection`, false, true);
            callback();
        }
        catch (e) {
            this.log.warn(e.message);
            callback();
        }
    }
    /*****************************************************************************************/
    async firstStart() {
        for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
            this.log.debug(`Initial ReadCharger done, detected charger ${iWB} firmware ${this.wallboxInfoList[iWB].Firmware}`);
            switch (this.wallboxInfoList[iWB].Firmware) {
                case "0":
                case "EHostUnreach":
                    // no charger found - stop adapter - only on first run
                    this.log.error(`No charger detected on given IP address for charger ${iWB} - shutting down adapter.`);
                    await this.setState(`Charger.${iWB}.Info.connection`, { val: false, ack: true });
                    this.stop;
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
                    this.log.debug(`Init done, launching state machine`);
                    await this.setState(`Charger.${iWB}.Info.connection`, { val: true, ack: true });
                    break;
                default:
                    this.log.warn(`Not explicitly supported firmware ${this.wallboxInfoList[iWB].Firmware} for charger ${iWB} found!!!`);
                    await this.setState(`Charger.${iWB}.Info.connection`, { val: true, ack: true });
                    // sentry.io send firmware version
                    if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
                        const sentryInstance = this.getPluginInstance("sentry");
                        if (sentryInstance) {
                            const Sentry = sentryInstance.getSentryObject();
                            Sentry &&
                                Sentry?.withScope((scope) => {
                                    scope.setLevel("warning");
                                    scope.setTag("Firmware", this.wallboxInfoList[iWB].Firmware);
                                    Sentry.captureMessage("Adapter go-e-Charger found unknown firmware", "warning"); // Level "warning"
                                });
                        }
                    }
            }
        } // next charger
    }
    /*****************************************************************************************/
    async StateMachine() {
        this.log.debug(`StateMachine cycle start`);
        for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
            if (this.wallboxInfoList[iWB].ChargeNOW || this.wallboxInfoList[iWB].ChargeManager) {
                // Charge-NOW or Charge-Manager is enabled
                await this.Read_ChargerAPIV1(iWB);
                if (this.wallboxInfoList[iWB].HardwareMin3) {
                    await this.Read_ChargerAPIV2(iWB);
                }
            }
            if (this.wallboxInfoList[iWB].ChargeNOW) {
                // Charge-NOW is enabled
                await this.Charge_Config("1", this.wallboxInfoList[iWB].ChargeCurrent, `go-eCharger für erzwungene Schnellladung aktivieren`, iWB); // keep active charging current!!
                await this.Switch_3Phases(this.wallboxInfoList[iWB].Charge3Phase, iWB);
                if (this.wallboxInfoList[iWB].HardwareMin3) {
                    await this.Read_ChargerAPIV2(iWB);
                }
            }
            else if (this.wallboxInfoList[iWB].ChargeManager) {
                // Charge-Manager is enabled
                batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
                // BatSoC = await this.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
                this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
                if (batSoC >= minHomeBatVal) {
                    // SoC of home battery is sufficient
                    await this.Switch_3Phases(this.wallboxInfoList[iWB].Charge3Phase, iWB);
                    await this.Charge_Manager(iWB);
                }
                else {
                    // FUTURE: time of day forces emptying of home battery
                    if ((await this.projectUtils.getStateValue(`Charger.${iWB}.Power.ChargingAllowed`)) == true) {
                        // Set to false only if still true
                        this.wallboxInfoList[iWB].SetAmp = 6;
                        await this.Charge_Config("0", this.wallboxInfoList[iWB].SetAmp, `Hausbatterie laden bis ${minHomeBatVal}%`, iWB);
                    }
                }
            }
            else {
                // only if Power.ChargingAllowed is still set: switch OFF; set to min. current;
                if ((await this.projectUtils.getStateValue(`Charger.${iWB}.Power.ChargingAllowed`)) == true) {
                    // Set to false only if still true
                    await this.Read_ChargerAPIV1(iWB);
                    if (this.wallboxInfoList[iWB].HardwareMin3) {
                        await this.Read_ChargerAPIV2(iWB);
                    }
                    this.wallboxInfoList[iWB].SetAmp = 6;
                    await this.Charge_Config("0", this.wallboxInfoList[iWB].SetAmp, `go-eCharger abschalten`, iWB);
                }
                else if (Number(await this.projectUtils.getStateValue(`Charger.${iWB}.Power.Charge`)) > 0) {
                    await this.Read_ChargerAPIV1(iWB);
                    if (this.wallboxInfoList[iWB].HardwareMin3) {
                        await this.Read_ChargerAPIV2(iWB);
                    }
                }
            }
            const stateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.cycleTime));
            if (stateMachine != null) {
                this.timeoutList.push(stateMachine);
            }
        } // next charger
    } // END StateMachine
    /*****************************************************************************************/
    async Read_ChargerAPIV1(iWB) {
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/status`, { transformResponse: r => r })
            .then(response => {
            //.status == 200
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger ${iWB}: ${response.data}`);
            void this.ParseStatusAPIV1(result, iWB);
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
    /*****************************************************************************************/
    async ParseStatusAPIV1(status, iWB) {
        const basePath = `Charger.${iWB}`;
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.RebootCounter`, Number(status.rbc), "Counter for system reboot events", "", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.RebootTimer`, Math.floor(status.rbt / 1000 / 3600), `Time since last reboot`, "h", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.CarState`, Number(status.car), "State of connected car", "", "value");
        switch (status.car) {
            case "1":
                await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, "Wallbox ready, no car", "State of connected car", "value");
                break;
            case "2":
                await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, "Charging...", "State of connected car", "value");
                break;
            case "3":
                await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, "Wait for car", "State of connected car", "value");
                break;
            case "4":
                await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, `Charge finished, car still connected`, "State of connected car", "value");
                break;
            default:
                await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, "Error", "State of connected car", "value");
        }
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(status.amp), "Charge current output", "A", "value.current");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrentVolatile`, Number(status.amx), `Charge current output volatile`, "A", "value.current");
        switch (status.alw) {
            case "0":
                await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, false, "Charging allowed", "switch.mode.manual");
                break;
            case "1":
                await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, true, "Charging allowed", "switch.mode.manual");
                break;
        }
        this.wallboxInfoList[iWB].GridPhases = ((32 & status.pha) >> 5) + ((16 & status.pha) >> 4) + ((8 & status.pha) >> 3);
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.GridPhases`, this.wallboxInfoList[iWB].GridPhases, `No of available grid phases`, "phase", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Statistics_Total.Charged`, status.eto / 10, `Totally charged in go-e lifetime`, "kWh", "value");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.Charge`, status.nrg[11] * 10, "actual charging-power", "W", "value.power");
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.MeasuredMaxPhaseCurrent`, Math.max(...status.nrg.slice(4, 7)) / 10, `Measured max. current of grid phases`, "A", "value.current");
        this.wallboxInfoList[iWB].Firmware = status.fwv;
        void this.projectUtils.checkAndSetValue(`${basePath}.Info.FirmwareVersion`, status.fwv, "Firmware version of charger");
        // WiP 634
        // uby - uint8_t - unlocked_by: Nummer der RFID Karte, die den jetzigen Ladevorgang freigeschalten hat
        void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.UnlockedByRFIDNo`, Number(status.uby), "Number of current session RFID chip");
        // WiP 634
        this.log.debug(`got and parsed go-e charger ${iWB} data`);
    }
    /*****************************************************************************************/
    async Read_ChargerAPIV2(iWB) {
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/status?filter=alw,acu,eto,amp,rbc,rbt,car,pha,fwv,nrg,psm,typ,uby`, {
            transformResponse: r => r,
        })
            .then(response => {
            //.status == 200
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger ${iWB} API V2: ${response.data}`);
            this.wallboxInfoList[iWB].HardwareMin3 = true;
            void this.ParseStatusAPIV2(result, iWB);
        })
            .catch(error => {
            this.log.error(`Error in calling go-e charger ${iWB} API V2: ${error}`);
            this.log.warn(`If you have a charger minimum hardware version 3: please enable API V2 for charger ${iWB},
						IP: ${this.config.wallBoxList[iWB].ipAddress}`);
        });
    }
    /**
     * Parses and processes status information from the go-eCharger API V2.
     *
     * @param status - The API V2 status object returned by the charger.
     * @param status.psm - Phase switching mode (1 = single-phase, 2 = three-phase).
     * @param status.typ - Hardware version or type identifier.
     * @param iWB - Index of the charger in the configuration list.
     * @description
     * The `ParseStatusAPIV2` function interprets the charger’s API V2 status data and updates internal states accordingly:
     * - Maps the numeric phase switching mode (`psm`) to the number of enabled phases.
     * - Updates `Power.EnabledPhases` and `Info.HardwareVersion` states.
     * - Logs the parsed data for debugging and traceability.
     */
    ParseStatusAPIV2(status, iWB) {
        const basePath = `Charger.${iWB}`;
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
        void this.projectUtils.checkAndSetValue(`${basePath}.Info.HardwareVersion`, status.typ, "Hardware version of charger", "value");
        this.log.debug(`got and parsed go-e charger ${iWB} data with API V2`);
    }
    /**
     * Switches between 1-phase and 3-phase charging mode via HTTP API.
     *
     * @async
     * @param Charge3Phase - Defines whether to enable (true) or disable (false) 3-phase charging.
     * @param iWB - Index of the charger in the configuration list for which to switch the phase mode.
     * @returns Resolves when the request has completed.
     */
    async Switch_3Phases(Charge3Phase, iWB) {
        if (!this.wallboxInfoList[iWB].HardwareMin3) {
            return;
        }
        const psm = Charge3Phase ? 2 : 1;
        await axiosInstance
            .get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/set?psm=${psm}`, { transformResponse: r => r })
            .then(response => {
            //.status == 200
            this.log.debug(`Sent: PSM=${psm} to charger ${iWB} → Response: ${response.statusText}`);
        })
            .catch(error => {
            this.log.warn(`Error: ${error} while setting 3 phases to charger ${iWB} = ${Charge3Phase} @ ${this.config.wallBoxList[iWB].ipAddress}`);
            this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
        });
    }
    /*****************************************************************************************/
    async Charge_Config(Allow, Ampere, LogMessage, iWB) {
        this.log.debug(`${LogMessage}  -  ${Ampere} Ampere`);
        const basePath = `Charger.${iWB}`;
        if (!this.config.wallBoxList[iWB].readOnlyMode) {
            await axiosInstance
                .get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=alw=${Allow}`, { transformResponse: r => r }) // activate charging
                .then(response => {
                //.status == 200
                this.log.debug(`Sent to charger ${iWB}: ${response.data}`);
            })
                .catch(error => {
                this.log.warn(`Error: ${error} by writing to charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} alw=${Allow}`);
                this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
            });
        }
        switch (this.wallboxInfoList[iWB].Firmware) {
            case "033":
                await axiosInstance
                    .get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=amp=${Ampere}`, { transformResponse: r => r }) // set charging current
                    .then(async (response) => {
                    //.status == 200
                    this.log.debug(`Sent to charger ${iWB} with firmware 033: ${response.data}`);
                    const result = JSON.parse(response.data);
                    void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(result.amp), `Charge current output`, "A", "value.current");
                    switch (result.alw) {
                        case "0":
                            await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, false, "Charging allowed", "switch.mode.manual");
                            break;
                        case "1":
                            await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, true, "Charging allowed", "switch.mode.manual");
                            break;
                    }
                })
                    .catch(error => {
                    this.log.warn(`Error: ${error} by writing to charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} amp=${Ampere}`);
                    this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
                });
                break;
            default:
                // case '040', '040.0', '041.0':
                // case '054.7', '054.11', '055.5', '055.7', '055.8':
                // case '56.1', '56.2', '56.8', '56.9', '56.11', '57.0', '57.1', '59.4':
                // case '60.0', '60.1', '60.2':
                await axiosInstance
                    .get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=amx=${Ampere}`, { transformResponse: r => r }) // set charging current
                    .then(async (response) => {
                    //.status == 200
                    this.log.debug(`Sent to charger ${iWB} with firmware > 033: ${response.data}`);
                    const result = JSON.parse(response.data);
                    void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(result.amp), `Charge current output`, "A", "value.current");
                    switch (result.alw) {
                        case "0":
                            await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, false, "Charging allowed", "switch.mode.manual");
                            break;
                        case "1":
                            await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, true, "Charging allowed", "switch.mode.manual");
                            break;
                    }
                })
                    .catch(error => {
                    this.log.warn(`Error: ${error} by writing to charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} amx=${Ampere}`);
                    this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
                });
        }
    } // END Charge_Config
    /**
     * Manages the dynamic charging process based on solar power availability,
     * household consumption, and battery state of charge (SoC).
     *
     * @async
     * @param iWB - Index of the charger in the configuration list for which to manage charging.
     * @returns Resolves when all state values are retrieved and charging logic is applied.
     * @description
     * The `Charge_Manager` function continuously evaluates the energy situation and adjusts
     * the charging current (`ZielAmpere`) to optimize self-consumption of solar energy.
     * Data sources include:
     * - `StateHomeSolarPower`: current solar generation (W)
     * - `StateHomePowerConsumption`: total household power demand (W)
     * - `StateHomeBatSoc`: battery state of charge (%)
     *
     * The resulting charging current (`OptAmpere`) is computed based on:
     * - Available surplus energy
     * - Configured self-consumption setting
     * - Number of active phases
     * - Battery SoC offset for reserve management
     *
     * **Behavior:**
     * - Limits `OptAmpere` to 16 A.
     * - Adjusts `ZielAmpere` incrementally to avoid abrupt current changes.
     * - Enables charging if current exceeds 9 A (5 A base + 4 A hysteresis).
     * - Disables charging if below 6 A after multiple cycles (`DelayOff` > 12).
     */
    async Charge_Manager(iWB) {
        solarPower = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeSolarPower);
        this.log.debug(`Got external state of solar power: ${solarPower} W`);
        houseConsumption = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomePowerConsumption);
        this.log.debug(`Got external state of house power consumption: ${houseConsumption} W`);
        batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
        this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
        this.wallboxInfoList[iWB].ChargePower = await this.projectUtils.getStateValue(`Charger.${iWB}Power.Charge`);
        const Phases = this.wallboxInfoList[iWB].HardwareMin3 && this.wallboxInfoList[iWB].EnabledPhases
            ? this.wallboxInfoList[iWB].EnabledPhases
            : this.wallboxInfoList[iWB].GridPhases;
        this.wallboxInfoList[iWB].SetOptAmp = Math.floor((solarPower -
            houseConsumption +
            (this.config.subtractSelfConsumption ? this.wallboxInfoList[iWB].ChargePower : 0) - // optional inclusion of charger power
            100 + // reserve offset
            (2000 / (100 - minHomeBatVal)) * (batSoC - minHomeBatVal)) / // discharge offset
            230 /
            Phases);
        this.wallboxInfoList[iWB].SetOptAmp = Math.min(this.wallboxInfoList[iWB].SetOptAmp, 16);
        // TODO : make max. current configurable -> this.wallboxInfoList[iWB].MaxAmp
        this.log.debug(`Optimal charging current would be: ${this.wallboxInfoList[iWB].SetOptAmp} A`);
        if (this.wallboxInfoList[iWB].SetAmp < this.wallboxInfoList[iWB].SetOptAmp) {
            this.wallboxInfoList[iWB].SetAmp++;
        }
        else if (this.wallboxInfoList[iWB].SetAmp > this.wallboxInfoList[iWB].SetOptAmp) {
            this.wallboxInfoList[iWB].SetAmp--;
        }
        this.log.debug(`ZielAmpere: ${this.wallboxInfoList[iWB].SetAmp} A; Solar: ${solarPower} W; House: ${houseConsumption} W; Charger: ${this.wallboxInfoList[iWB].ChargePower} W`);
        if (this.wallboxInfoList[iWB].SetAmp > 5 + 4) {
            await this.Charge_Config("1", this.wallboxInfoList[iWB].SetAmp, `Charging current: ${this.wallboxInfoList[iWB].SetAmp} A`, iWB);
        }
        else if (this.wallboxInfoList[iWB].SetAmp < 6) {
            // TODO : make min. current configurable -> this.wallboxInfoList[iWB].MinAmp
            this.wallboxInfoList[iWB].DelayOff++;
            if (this.wallboxInfoList[iWB].DelayOff > 12) {
                await this.Charge_Config("0", this.wallboxInfoList[iWB].SetAmp, `Insufficient surplus`, iWB);
                this.wallboxInfoList[iWB].DelayOff = 0;
            }
        }
    } // END Charge_Manager
    /**
     * Checks whether a given input value is considered "empty-like".
     *
     * @param inputVar - The variable to check for emptiness.
     * @returns `true` if the input is undefined, null, or contains only
     *                    whitespace, quotes, or empty structural characters (`[]`, `{}`), otherwise `false`.
     * @description
     * This function evaluates whether an input is effectively empty by:
     * - Ignoring whitespace, quotes (`"` and `'`), and empty object/array brackets.
     * - Returning `true` if the cleaned string representation is empty.
     * @example
     * isLikeEmpty(null);               // → true
     * isLikeEmpty("   ");              // → true
     * isLikeEmpty("{}");               // → true
     * isLikeEmpty("[  ]");             // → true
     * isLikeEmpty("non-empty text");   // → false
     */
    isLikeEmpty(inputVar) {
        if (inputVar === undefined || inputVar === null) {
            return true;
        }
        const sTemp = JSON.stringify(inputVar)
            .replace(/\s+/g, "") // remove all white spaces
            .replace(/"+/g, "") // remove all double quotes
            .replace(/'+/g, "") // remove all single quotes
            .replace(/\[+/g, "") // remove all [
            .replace(/\]+/g, "") // remove all ]
            .replace(/\{+/g, "") // remove all {
            .replace(/\}+/g, ""); // remove all }
        return sTemp === "";
    }
} // END Class
/*****************************************************************************************/
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new go_e_charger(options);
}
else {
    // otherwise start the instance directly
    (() => new go_e_charger())();
}
//# sourceMappingURL=main.js.map