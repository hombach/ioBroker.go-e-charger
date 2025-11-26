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
// Variablen
let FirstStart = true;
let ZielAmpere = 5;
let EnabledPhases = 0;
let OptAmpere = 6;
let MinHomeBatVal = 87;
let OffVerzoegerung = 0;
let ChargeNOW = false;
let ChargeManager = false;
let ChargeCurrent = 0;
let Charge3Phase = true;
let ChargePower = 0;
let GridPhases = 0;
let SolarPower = 0;
let HouseConsumption = 0;
let BatSoC = 0;
let Firmware = "0";
let Hardware = "V2";
let HardwareMin3 = false;
class go_e_charger extends utils.Adapter {
    ProjectUtils = new projectUtils_1.ProjectUtils(this);
    timeoutList;
    /****************************************************************************************
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options = {}) {
        super({
            ...options,
            name: "go-e-charger",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        // this.on("objectChange", this.onObjectChange.bind(this));
        // this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));
        this.timeoutList = []; //WIP
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        if (!this.config.ipaddress) {
            this.log.warn("go-eCharger IP address not set");
        }
        this.subscribeStates(`Settings.*`); // all states changes inside the adapters settings namespace are subscribed
        if (this.config.ipaddress) {
            await this.Read_Charger();
            await this.Read_ChargerAPIV2();
            this.log.info(`IP address found in config: ${this.config.ipaddress}`);
            if (!this.config.polltimelive) {
                this.log.warn("Polltime not configured or zero - will be set to 10 seconds");
                this.config.polltimelive = 10000;
            }
            this.log.info(`Polltime set to: ${this.config.polltimelive / 1000} seconds`);
            // sentry.io ping
            if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
                const sentryInstance = this.getPluginInstance("sentry");
                if (sentryInstance) {
                    const Sentry = sentryInstance.getSentryObject();
                    Sentry &&
                        Sentry.withScope(scope => {
                            scope.setLevel("info");
                            scope.setTag("Charger", this.config.ipaddress);
                            scope.setTag("Firmware", Firmware);
                            scope.setTag("Hardware", Hardware);
                            Sentry.captureMessage("Adapter go-e-Charger started", "info"); // Level "info"
                        });
                }
            }
            MinHomeBatVal = await this.ProjectUtils.getStateValue("Settings.Setpoint_HomeBatSoC"); // Get desired battery SoC
            ChargeNOW = await this.ProjectUtils.getStateValue("Settings.ChargeNOW"); // Get charging override trigger
            ChargeManager = await this.ProjectUtils.getStateValue("Settings.ChargeManager"); // Get enable for charge manager
            ChargeCurrent = await this.ProjectUtils.getStateValue("Settings.ChargeCurrent"); // Get current for charging override
            this.log.debug(`Pre-init done, launching state machine interval`);
            const stateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.polltimelive));
            this.timeoutList.push(stateMachine);
        }
        else {
            this.log.error(`No IP address configured!! - shutting down adapter.`);
            await this.setState("info.connection", { val: false, ack: true });
            this.stop;
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
                // The state was changed  -  this.subscribeStates(`Settings.*`);
                if (!state.ack) {
                    this.log.debug(`state change detected and parsing for id: ${id} - state: ${state.val}`);
                    if (id.includes(`.Settings.`)) {
                        const statePath = id.split(".");
                        const settingType = statePath[3];
                        if (settingType !== undefined) {
                            switch (settingType) {
                                case "Setpoint_HomeBatSoC":
                                    // Get desired battery SoC
                                    if (typeof state.val === "number") {
                                        MinHomeBatVal = state.val;
                                        this.log.debug(`settings state changed to Setpoint_HomeBatSoC: ${MinHomeBatVal}`);
                                        void this.setState(id, state.val, true);
                                    }
                                    else {
                                        this.log.warn(`Wrong type for Setpoint_HomeBatSoC: ${state.val}`);
                                    }
                                    break;
                                case "ChargeNOW":
                                    // Get charging override trigger
                                    if (typeof state.val === "boolean") {
                                        ChargeNOW = state.val;
                                        this.log.debug(`settings state changed to ChargeNOW: ${ChargeNOW}`);
                                        void this.setState(id, state.val, true);
                                    }
                                    else {
                                        this.log.warn(`Wrong type for ChargeNOW: ${state.val}`);
                                    }
                                    break;
                                case "ChargeManager":
                                    // Get enable for charge manager
                                    if (typeof state.val === "boolean") {
                                        ChargeManager = state.val;
                                        this.log.debug(`settings state changed to ChargeManager: ${ChargeManager}`);
                                        void this.setState(id, state.val, true);
                                    }
                                    else {
                                        this.log.warn(`Wrong type for ChargeManager: ${state.val}`);
                                    }
                                    break;
                                case "ChargeCurrent":
                                    // Get current for charging override
                                    if (typeof state.val === "number") {
                                        ChargeCurrent = state.val;
                                        this.log.debug(`settings state changed to ChargeCurrent: ${ChargeCurrent}`);
                                        void this.setState(id, state.val, true);
                                    }
                                    else {
                                        this.log.warn(`Wrong type for ChargeCurrent: ${state.val}`);
                                    }
                                    break;
                                case "Charge3Phase":
                                    // Get enable of 3 phases for charging override
                                    if (typeof state.val === "boolean") {
                                        Charge3Phase = state.val;
                                        this.log.debug(`settings state changed to Charge3Phase: ${Charge3Phase}`);
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
            for (const timeoutJob of this.timeoutList) {
                this.clearTimeout(timeoutJob);
            }
            this.log.info(`Adapter go-eCharger cleaned up everything...`);
            void this.setState("info.connection", false, true);
            callback();
        }
        catch (e) {
            this.log.warn(e.message);
            callback();
        }
    }
    /*****************************************************************************************/
    async StateMachine() {
        if (FirstStart) {
            // First run of state machine after adapter start-up
            this.log.debug(`Initial ReadCharger done, detected firmware ${Firmware}`);
            switch (Firmware) {
                case "0":
                case "EHostUnreach":
                    // no charger found - stop adapter - only on first run
                    this.log.error(`No charger detected on given IP address - shutting down adapter.`);
                    await this.setState("info.connection", { val: false, ack: true });
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
                    this.log.debug(`Init done, launching state machine`);
                    await this.setState("info.connection", { val: true, ack: true });
                    break;
                default:
                    this.log.warn(`Not explicitly supported firmware ${Firmware} found!!!`);
                    await this.setState("info.connection", { val: true, ack: true });
                    // sentry.io send firmware version
                    if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
                        const sentryInstance = this.getPluginInstance("sentry");
                        if (sentryInstance) {
                            const Sentry = sentryInstance.getSentryObject();
                            Sentry &&
                                Sentry.withScope(scope => {
                                    scope.setLevel("warning");
                                    scope.setTag("Firmware", Firmware);
                                    Sentry.captureMessage("Adapter go-e-Charger found unknown firmware", "warning"); // Level "warning"
                                });
                        }
                    }
            }
            FirstStart = false;
        }
        this.log.debug(`StateMachine cycle start`);
        if (ChargeNOW || ChargeManager) {
            // Charge-NOW or Charge-Manager is enabled
            await this.Read_Charger();
            if (HardwareMin3) {
                await this.Read_ChargerAPIV2();
            }
        }
        if (ChargeNOW) {
            // Charge-NOW is enabled
            await this.Charge_Config("1", ChargeCurrent, "go-eCharger für erzwungene Schnellladung aktivieren"); // keep active charging current!!
            await this.Switch_3Phases(Charge3Phase);
            if (HardwareMin3) {
                await this.Read_ChargerAPIV2();
            }
        }
        else if (ChargeManager) {
            // Charge-Manager is enabled
            BatSoC = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
            // BatSoC = await this.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
            this.log.debug(`Got external state of battery SoC: ${BatSoC}%`);
            if (BatSoC >= MinHomeBatVal) {
                // SoC of home battery is sufficient
                await this.Switch_3Phases(Charge3Phase);
                await this.Charge_Manager();
            }
            else {
                // FUTURE: time of day forces emptying of home battery
                if ((await this.ProjectUtils.getStateValue("Power.ChargingAllowed")) == true) {
                    // Set to false only if still true
                    ZielAmpere = 6;
                    await this.Charge_Config("0", ZielAmpere, `Hausbatterie laden bis ${MinHomeBatVal}%`);
                }
            }
        }
        else {
            // only if Power.ChargingAllowed is still set: switch OFF; set to min. current;
            if ((await this.ProjectUtils.getStateValue("Power.ChargingAllowed")) == true) {
                // Set to false only if still true
                await this.Read_Charger();
                if (HardwareMin3) {
                    await this.Read_ChargerAPIV2();
                }
                ZielAmpere = 6;
                await this.Charge_Config("0", ZielAmpere, `go-eCharger abschalten`);
            }
            else if (Number(await this.ProjectUtils.getStateValue("Power.Charge")) > 0) {
                await this.Read_Charger();
                if (HardwareMin3) {
                    await this.Read_ChargerAPIV2();
                }
            }
        }
        const stateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.polltimelive));
        this.timeoutList.push(stateMachine);
    }
    /*****************************************************************************************/
    async Read_Charger() {
        await axiosInstance
            .get(`http://${this.config.ipaddress}/status`, { transformResponse: r => r })
            .then(response => {
            //.status == 200
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger: ${response.data}`);
            void this.ParseStatus(result);
        })
            .catch(error => {
            if (error.message && error.message.includes("EHOSTUNREACH")) {
                this.log.error(`Host unreachable error when calling go-eCharger API: ${error}`);
                Firmware = `EHostUnreach`;
            }
            else {
                this.log.error(`Error in calling go-eCharger API: ${error}`);
            }
            this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
        });
    }
    /*****************************************************************************************/
    async ParseStatus(status) {
        await this.setState("Info.RebootCounter", Number(status.rbc), true);
        await this.setState("Info.RebootTimer", Math.floor(status.rbt / 1000 / 3600), true); // trim to hours
        await this.setState("Info.CarState", Number(status.car), true);
        switch (status.car) {
            case "1":
                await this.setState("Info.CarStateString", "Wallbox ready, no car", true);
                break;
            case "2":
                await this.setState("Info.CarStateString", "Charging...", true);
                break;
            case "3":
                await this.setState("Info.CarStateString", "Wait for car", true);
                break;
            case "4":
                await this.setState("Info.CarStateString", "Charge finished, car still connected", true);
                break;
            default:
                await this.setState("Info.CarStateString", "Error", true);
        }
        await this.setState("Power.ChargeCurrent", Number(status.amp), true);
        await this.setState("Power.ChargeCurrentVolatile", Number(status.amx), true);
        switch (status.alw) {
            case "0":
                await this.setState("Power.ChargingAllowed", false, true);
                break;
            case "1":
                await this.setState("Power.ChargingAllowed", true, true);
                break;
        }
        GridPhases = ((32 & status.pha) >> 5) + ((16 & status.pha) >> 4) + ((8 & status.pha) >> 3);
        await this.setState("Power.GridPhases", GridPhases, true);
        await this.setState("Statistics_Total.Charged", status.eto / 10, true);
        await this.setState("Power.Charge", status.nrg[11] * 10, true); // trim to Watt
        await this.setState("Power.MeasuredMaxPhaseCurrent", Math.max(status.nrg[4], status.nrg[5], status.nrg[6]) / 10, true);
        Firmware = status.fwv;
        await this.setState("Info.FirmwareVersion", Firmware, true);
        // WiP 634
        // uby - uint8_t - unlocked_by: Nummer der RFID Karte, die den jetzigen Ladevorgang freigeschalten hat
        await this.setState("Info.UnlockedByRFIDNo", Number(status.uby), true);
        // WiP 634
        this.log.debug("got and parsed go-eCharger data");
    }
    /*****************************************************************************************/
    async Read_ChargerAPIV2() {
        await axiosInstance
            .get(`http://${this.config.ipaddress}/api/status?filter=alw,acu,eto,amp,rbc,rbt,car,pha,fwv,nrg,psm,typ,uby`, { transformResponse: r => r })
            .then(response => {
            //.status == 200
            const result = JSON.parse(response.data);
            this.log.debug(`Read charger API V2: ${response.data}`);
            HardwareMin3 = true;
            void this.ParseStatusAPIV2(result);
        })
            .catch(error => {
            this.log.error(`Error in calling go-eCharger API V2: ${error}`);
            this.log.warn(`If you have a charger minimum hardware version 3: please enable API V2 for IP: ${this.config.ipaddress}`);
        });
    }
    /**
     * Parses and processes status information from the go-eCharger API V2.
     *
     * @async
     * @param status - The API V2 status object returned by the charger.
     * @param status.psm - Phase switching mode (1 = single-phase, 2 = three-phase).
     * @param status.typ - Hardware version or type identifier.
     * @returns Resolves once the parsed values are written to states.
     * @description
     * The `ParseStatusAPIV2` function interprets the charger’s API V2 status data and updates internal states accordingly:
     * - Maps the numeric phase switching mode (`psm`) to the number of enabled phases.
     * - Updates `Power.EnabledPhases` and `Info.HardwareVersion` states.
     * - Logs the parsed data for debugging and traceability.
     */
    async ParseStatusAPIV2(status) {
        switch (status.psm) {
            case 1:
                EnabledPhases = 1;
                break;
            case 2:
                EnabledPhases = 3;
                break;
            default:
                EnabledPhases = 0;
        }
        await this.setState("Power.EnabledPhases", EnabledPhases, true);
        this.log.debug(`got enabled phases ${EnabledPhases}`);
        Hardware = status.typ;
        await this.setState("Info.HardwareVersion", Hardware, true);
        this.log.debug(`got and parsed go-eCharger data with API V2`);
    }
    /**
     * Switches between 1-phase and 3-phase charging mode via HTTP API.
     *
     * @async
     * @param Charge3Phase - Defines whether to enable (true) or disable (false) 3-phase charging.
     * @returns Resolves when the request has completed.
     */
    async Switch_3Phases(Charge3Phase) {
        if (!HardwareMin3) {
            return;
        }
        const psm = Charge3Phase ? 2 : 1;
        await axiosInstance
            .get(`http://${this.config.ipaddress}/api/set?psm=${psm}`, { transformResponse: r => r })
            .then(response => {
            //.status == 200
            this.log.debug(`Sent: PSM=${psm} → Response: ${response.statusText}`);
        })
            .catch(error => {
            this.log.warn(`Error: ${error} while setting 3 phases = ${Charge3Phase} @ ${this.config.ipaddress}`);
            this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
        });
    }
    /*****************************************************************************************/
    async Charge_Config(Allow, Ampere, LogMessage) {
        this.log.debug(`${LogMessage}  -  ${Ampere} Ampere`);
        if (!this.config.ReadOnlyMode) {
            await axiosInstance
                .get(`http://${this.config.ipaddress}/mqtt?payload=alw=${Allow}`, { transformResponse: r => r }) // activate charging
                .then(response => {
                //.status == 200
                this.log.debug(`Sent: ${response.data}`);
            })
                .catch(error => {
                this.log.warn(`Error: ${error} by writing @ ${this.config.ipaddress} alw=${Allow}`);
                this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
            });
        }
        switch (Firmware) {
            case "033":
                await axiosInstance
                    .get(`http://${this.config.ipaddress}/mqtt?payload=amp=${Ampere}`, { transformResponse: r => r }) // set charging current
                    .then(response => {
                    //.status == 200
                    this.log.debug(`Sent to firmware 033: ${response.data}`);
                    const result = JSON.parse(response.data);
                    void this.setState("Power.ChargeCurrent", Number(result.amp), true); // in readcharger integriert
                    switch (result.alw) {
                        case "0":
                            void this.setState("Power.ChargingAllowed", false, true);
                            break;
                        case "1":
                            void this.setState("Power.ChargingAllowed", true, true);
                            break;
                    }
                })
                    .catch(error => {
                    this.log.warn(`Error: ${error} by writing @ ${this.config.ipaddress} amp=${Ampere}`);
                    this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
                });
                break;
            default:
                // case '040', '040.0', '041.0':
                // case '054.7', '054.11', '055.5', '055.7', '055.8':
                // case '56.1', '56.2', '56.8', '56.9', '56.11', '57.0', '57.1', '59.4':
                // case '60.0', '60.1':
                await axiosInstance
                    .get(`http://${this.config.ipaddress}/mqtt?payload=amx=${Ampere}`, { transformResponse: r => r }) // set charging current
                    .then(response => {
                    //.status == 200
                    this.log.debug(`Sent to firmware > 033: ${response.data}`);
                    const result = JSON.parse(response.data);
                    void this.setState("Power.ChargeCurrent", Number(result.amp), true); // in readcharger integriert
                    switch (result.alw) {
                        case "0":
                            void this.setState("Power.ChargingAllowed", false, true);
                            break;
                        case "1":
                            void this.setState("Power.ChargingAllowed", true, true);
                            break;
                    }
                })
                    .catch(error => {
                    this.log.warn(`Error: ${error} by writing @ ${this.config.ipaddress} amx=${Ampere}`);
                    this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
                });
        }
    } // END Charge_Config
    /**
     * Manages the dynamic charging process based on solar power availability,
     * household consumption, and battery state of charge (SoC).
     *
     * @async
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
     * - Disables charging if below 6 A after multiple cycles (`OffVerzoegerung` > 12).
     */
    async Charge_Manager() {
        SolarPower = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomeSolarPower);
        this.log.debug(`Got external state of solar power: ${SolarPower} W`);
        HouseConsumption = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomePowerConsumption);
        this.log.debug(`Got external state of house power consumption: ${HouseConsumption} W`);
        BatSoC = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
        this.log.debug(`Got external state of battery SoC: ${BatSoC}%`);
        ChargePower = await this.ProjectUtils.getStateValue("Power.Charge");
        const Phases = HardwareMin3 && EnabledPhases ? EnabledPhases : GridPhases;
        OptAmpere = Math.floor((SolarPower -
            HouseConsumption +
            (this.config.SubtractSelfConsumption ? ChargePower : 0) - // optional inclusion of charger power
            100 + // reserve offset
            (2000 / (100 - MinHomeBatVal)) * (BatSoC - MinHomeBatVal)) / // discharge offset
            230 /
            Phases);
        if (OptAmpere > 16) {
            OptAmpere = 16;
        }
        this.log.debug(`Optimal charging current would be: ${OptAmpere} A`);
        if (ZielAmpere < OptAmpere) {
            ZielAmpere++;
        }
        else if (ZielAmpere > OptAmpere) {
            ZielAmpere--;
        }
        this.log.debug(`ZielAmpere: ${ZielAmpere} A; Solar: ${SolarPower} W; House: ${HouseConsumption} W; Charger: ${ChargePower} W`);
        if (ZielAmpere > 5 + 4) {
            await this.Charge_Config("1", ZielAmpere, `Charging current: ${ZielAmpere} A`);
        }
        else if (ZielAmpere < 6) {
            OffVerzoegerung++;
            if (OffVerzoegerung > 12) {
                await this.Charge_Config("0", ZielAmpere, `Insufficient surplus`);
                OffVerzoegerung = 0;
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