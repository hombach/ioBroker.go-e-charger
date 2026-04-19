// The adapter-core module gives you access to the core ioBroker functions you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import axios from "axios";
import { ProjectUtils, type IWallboxInfo } from "./lib/projectUtils";
const axiosInstance = axios.create({
	//timeout: 5000, //by default
});

// Variablen
let firstStart = true;
let minHomeBatVal = 85;
let batSoC = 0;
let solarPower = 0;
let houseConsumption = 0;
let totalChargePower = 0;
let totalMeasuredChargeCurrent = 0;


let ZielAmpere = 5;
let OptAmpere = 6;
let OffVerzoegerung = 0;

class go_e_charger extends utils.Adapter {
	private projectUtils = new ProjectUtils(this);
	
	timeoutList: ioBroker.Timeout[];
	//WiP
	wallboxInfoList: IWallboxInfo[] = [];
	//WIP NEW adapterIntervals: NodeJS.Timeout[];

	/****************************************************************************************
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
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
	private async onReady(): Promise<void> {
		if (!this.config.cycleTime) {
			this.log.warn(`Cycletime not configured or zero - will be set to 10 seconds`);
			this.config.cycleTime = 10000;
		}
		this.log.info(`Cycletime set to: ${this.config.cycleTime / 1000} seconds`);

		this.subscribeStates(`Settings.*`); // all states changes inside the adapters settings namespace are subscribed


		for (let i = 0; i < this.config.wallBoxList.length; i++) {
			try {
				if (!this.config.wallBoxList[i].ipAddress) {
					throw new Error(`Charger ${i} - IP address not set - stopping adapter`);
				} 



				if (this.config.wallBoxList[i].ipAddress) {
					await this.Read_ChargerAPIV1(i);
					await this.Read_ChargerAPIV2(i);
					this.log.info(`IP address charger ${i} found in config: ${this.config.wallBoxList[i].ipAddress}`);



			// sentry.io ping
			if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
				const sentryInstance = this.getPluginInstance("sentry");
				if (sentryInstance) {
					const Sentry = sentryInstance.getSentryObject();
					Sentry &&
						Sentry?.withScope((scope: any) => {
							scope.setLevel("info");
							scope.setTag("Charger", this.config.ipaddress);
							scope.setTag("Firmware", Firmware);
							scope.setTag("Hardware", Hardware);
							Sentry.captureMessage("Adapter go-e-Charger started", "info"); // Level "info"
						});
				}
			}

			minHomeBatVal = await this.projectUtils.getStateValue("Settings.Setpoint_HomeBatSoC"); // Get desired battery SoC
			ChargeNOW = await this.projectUtils.getStateValue("Settings.ChargeNOW"); // Get charging override trigger
			ChargeManager = await this.projectUtils.getStateValue("Settings.ChargeManager"); // Get enable for charge manager
			ChargeCurrent = await this.projectUtils.getStateValue("Settings.ChargeCurrent"); // Get current for charging override

			this.log.debug(`Pre-init done, launching state machine interval`);
			const stateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.cycleTime));
			if (stateMachine != null) {
				this.timeoutList.push(stateMachine);
			}
		} else {
			this.log.error(`No IP address configured!! - shutting down adapter.`);
			await this.setState("info.connection", { val: false, ack: true });
			this.stop;
		}


			} catch (e) {
				this.log.error((e as Error).message);
				void this.setState(`info.connection`, false, true);
				await this.stop?.({ exitCode: 11, reason: `invalid config` });
				return;
			}	




	}

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param id - The id of the state that changed.
	 * @param state - The changed state object, null if it was deleted.
	 */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
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
										minHomeBatVal = state.val;
										this.log.debug(`settings state changed to Setpoint_HomeBatSoC: ${minHomeBatVal}`);
										void this.setState(id, state.val, true);
									} else {
										this.log.warn(`Wrong type for Setpoint_HomeBatSoC: ${state.val}`);
									}
									break;
								case "ChargeNOW":
									// Get charging override trigger
									if (typeof state.val === "boolean") {
										ChargeNOW = state.val;
										this.log.debug(`settings state changed to ChargeNOW: ${ChargeNOW}`);
										void this.setState(id, state.val, true);
									} else {
										this.log.warn(`Wrong type for ChargeNOW: ${state.val}`);
									}
									break;
								case "ChargeManager":
									// Get enable for charge manager
									if (typeof state.val === "boolean") {
										ChargeManager = state.val;
										this.log.debug(`settings state changed to ChargeManager: ${ChargeManager}`);
										void this.setState(id, state.val, true);
									} else {
										this.log.warn(`Wrong type for ChargeManager: ${state.val}`);
									}
									break;
								case "ChargeCurrent":
									// Get current for charging override
									if (typeof state.val === "number") {
										ChargeCurrent = state.val;
										this.log.debug(`settings state changed to ChargeCurrent: ${ChargeCurrent}`);
										void this.setState(id, state.val, true);
									} else {
										this.log.warn(`Wrong type for ChargeCurrent: ${state.val}`);
									}
									break;
								case "Charge3Phase":
									// Get enable of 3 phases for charging override
									if (typeof state.val === "boolean") {
										this.wallboxInfoList[ERR0].Charge3Phase = state.val;
										this.log.debug(`settings state changed to Charge3Phase: ${this.wallboxInfoList[0].Charge3Phase}`);
										void this.setState(id, state.val, true);
									} else {
										this.log.warn(`Wrong type for Charge3Phase: ${state.val}`);
									}
									break;
								default:
									this.log.debug(`unknown value for setting type: ${settingType}`);
							}
						}
					}
				}
			} else {
				// The state was deleted
				this.log.warn(`state ${id} deleted`);
			}
		} catch (e) {
			this.log.error(`Unhandled exception processing onStateChange: ${e}`);
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param callback - callback
	 */
	private onUnload(callback: () => void): void {
		try {
			this.timeoutList.forEach(timeoutJob => this.clearTimeout(timeoutJob));
			this.log.info(`Adapter go-eCharger cleaned up everything...`);
			void this.setState("info.connection", false, true);
			callback();
		} catch (e) {
			this.log.warn((e as Error).message);
			callback();
		}
	}

	/*****************************************************************************************/
	async StateMachine(): Promise<void> {
		if (firstStart) {
			for (let i = 0; i < this.config.wallBoxList.length; i++) {
				// First run of state machine after adapter start-up
				this.log.debug(`Initial ReadCharger done, detected charger ${i} firmware ${this.wallboxInfoList[i].Firmware}`);
				switch (this.wallboxInfoList[i].Firmware) {
					case "0":
					case "EHostUnreach":
						// no charger found - stop adapter - only on first run
						this.log.error(`No charger detected on given IP address for charger ${i} - shutting down adapter.`);
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
					case "60.2":
						this.log.debug(`Init done, launching state machine`);
						await this.1setState("info.connection", { val: true, ack: true });
						break;
					default:
						this.log.warn(`Not explicitly supported firmware ${this.wallboxInfoList[i].Firmware} for charger ${i} found!!!`);
						await this.1setState("info.connection", { val: true, ack: true });
						// sentry.io send firmware version
						if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
							const sentryInstance = this.getPluginInstance("sentry");
							if (sentryInstance) {
								const Sentry = sentryInstance.getSentryObject();
								Sentry &&
									Sentry?.withScope((scope: any) => {
										scope.setLevel("warning");
										scope.setTag("Firmware", this.wallboxInfoList[i].Firmware);
										Sentry.captureMessage("Adapter go-e-Charger found unknown firmware", "warning"); // Level "warning"
									});
							}
						}
				}
			} // next charger
			firstStart = false;
		}

		this.log.debug(`StateMachine cycle start`);
		if (ChargeNOW || ChargeManager) {
			// Charge-NOW or Charge-Manager is enabled
			await this.Read_ChargerAPIV1();
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
		} else if (ChargeManager) {
			// Charge-Manager is enabled
			batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
			// BatSoC = await this.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
			this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
			if (batSoC >= minHomeBatVal) {
				// SoC of home battery is sufficient
				await this.Switch_3Phases(Charge3Phase);
				await this.Charge_Manager();
			} else {
				// FUTURE: time of day forces emptying of home battery
				if ((await this.projectUtils.1getStateValue("Power.ChargingAllowed")) == true) {
					// Set to false only if still true
					ZielAmpere = 6;
					await this.Charge_Config("0", ZielAmpere, `Hausbatterie laden bis ${minHomeBatVal}%`);
				}
			}
		} else {
			// only if Power.ChargingAllowed is still set: switch OFF; set to min. current;
			if ((await this.projectUtils.1getStateValue("Power.ChargingAllowed")) == true) {
				// Set to false only if still true
				await this.Read_ChargerAPIV1();
				if (HardwareMin3) {
					await this.Read_ChargerAPIV2();
				}
				ZielAmpere = 6;
				await this.Charge_Config("0", ZielAmpere, `go-eCharger abschalten`);
			} else if (Number(await this.projectUtils.1getStateValue("Power.Charge")) > 0) {
				await this.Read_ChargerAPIV1();
				if (HardwareMin3) {
					await this.Read_ChargerAPIV2();
				}
			}
		}

		const stateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.cycleTime));
		if (stateMachine != null) {
			this.timeoutList.push(stateMachine);
		}
	}

	/*****************************************************************************************/
	async Read_ChargerAPIV1(iWB: number): Promise<void> {
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
				} else {
					this.log.error(`Error in calling go-e charger ${iWB} API: ${error}`);
				}
				this.log.error(`Please verify IP address of charger ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
			});
	}

	/*****************************************************************************************/
	async ParseStatusAPIV1(status: {
		rbc: any;
		rbt: number;
		car: any;
		amp: any;
		amx: any;
		alw: any;
		pha: number;
		eto: number;
		nrg: number[];
		fwv: string;
		uby: any;
	}, iWB: number): Promise<void> {
		
		const basePath = `Charger.${iWB}`;

		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.RebootCounter`, Number(status.rbc), "Counter for system reboot events", "", "value");
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.RebootTimer`, Math.floor(status.rbt / 1000 / 3600), "Time since last reboot", "h", "value");
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
				await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, "Charge finished, car still connected", "State of connected car", "value");
				break;
			default:
				await this.projectUtils.checkAndSetValue(`${basePath}.Info.CarStateString`, "Error", "State of connected car", "value");
		}

		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(status.amp), "Charge current output", "A", "value.current");
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrentVolatile`, Number(status.amx), "Charge current output volatile", "A", "value.current");
		switch (status.alw) {
			case "0":
				await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, false, "Charging allowed", "switch.mode.manual");
				break;
			case "1":
				await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, true, "Charging allowed", "switch.mode.manual");
				break;
		}
		this.wallboxInfoList[iWB].GridPhases = ((32 & status.pha) >> 5) + ((16 & status.pha) >> 4) + ((8 & status.pha) >> 3);
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.GridPhases`, this.wallboxInfoList[iWB].GridPhases, "No of available grid phases", "phase", "value");
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Statistics_Total.Charged`, status.eto / 10, "Totally charged in go-e lifetime", "kWh", "value");
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.Charge`, status.nrg[11] * 10, "actual charging-power", "W", "value.power");
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.MeasuredMaxPhaseCurrent`, Math.max(...status.nrg.slice(4, 7)) / 10, "Measured max. current of grid phases", "A", "value.current");
		this.wallboxInfoList[iWB].Firmware = status.fwv;
		void this.projectUtils.checkAndSetValue(`${basePath}.Info.FirmwareVersion`, status.fwv, "Firmware version of charger");
		// WiP 634
		// uby - uint8_t - unlocked_by: Nummer der RFID Karte, die den jetzigen Ladevorgang freigeschalten hat
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Info.UnlockedByRFIDNo`, Number(status.uby), "Number of current session RFID chip");
		// WiP 634
		this.log.debug(`got and parsed go-e charger ${iWB} data`);
	}

	/*****************************************************************************************/
	async Read_ChargerAPIV2(iWB: number): Promise<void> {
		await axiosInstance
			.get(`http://${this.config.wallBoxList[iWB].ipAddress}/api/status?filter=alw,acu,eto,amp,rbc,rbt,car,pha,fwv,nrg,psm,typ,uby`, { transformResponse: r => r })
			.then(response => {
				//.status == 200
				const result = JSON.parse(response.data);
				this.log.debug(`Read charger ${iWB} API V2: ${response.data}`);
				this.wallboxInfoList[iWB].HardwareMin3 = true;
				void this.ParseStatusAPIV2(result, iWB);
			})
			.catch(error => {
				this.log.error(`Error in calling go-e charger ${iWB} API V2: ${error}`);
				this.log.warn(`If you have a charger minimum hardware version 3: please enable API V2 for charger ${iWB}, IP: ${this.config.wallBoxList[iWB].ipAddress}`);
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
	async ParseStatusAPIV2(status: { psm: number; typ: string }, iWB: number): Promise<void> {
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
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.EnabledPhases`, this.wallboxInfoList[iWB].EnabledPhases, "No of enabled phases in go-e wallbox", "phase", "value");
		this.log.debug(`got enabled phases for charger ${iWB}: ${this.wallboxInfoList[iWB].EnabledPhases}`);
		this.wallboxInfoList[iWB].Hardware = status.typ;
		void this.projectUtils.checkAndSetValue(`${basePath}.Info.HardwareVersion`, status.typ, "Counter for system reboot events", "value");
		this.log.debug(`got and parsed go-e charger ${iWB} data with API V2`);
	}

	/**
	 * Switches between 1-phase and 3-phase charging mode via HTTP API.
	 *
	 * @async
	 * @param Charge3Phase - Defines whether to enable (true) or disable (false) 3-phase charging.
	 * @returns Resolves when the request has completed.
	 */
	async Switch_3Phases(Charge3Phase: boolean, iWB: number): Promise<void> {
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
	async Charge_Config(Allow: string, Ampere: number, LogMessage: string, iWB: number): Promise<void> {
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
					.then(response => {
						//.status == 200
						this.log.debug(`Sent to charger ${iWB} with firmware 033: ${response.data}`);
						const result = JSON.parse(response.data);
						void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(result.amp), "Charge current output", "A", "value.current");
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
					.then(response => {
						//.status == 200
						this.log.debug(`Sent to charger ${iWB} with firmware > 033: ${response.data}`);
						const result = JSON.parse(response.data);
						void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(result.amp), "Charge current output", "A", "value.current");
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
	async Charge_Manager(iWB: number): Promise<void> {
		solarPower = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeSolarPower);
		this.log.debug(`Got external state of solar power: ${solarPower} W`);
		houseConsumption = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomePowerConsumption);
		this.log.debug(`Got external state of house power consumption: ${houseConsumption} W`);
		batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
		this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
		this.wallboxInfoList[iWB].ChargePower = await this.projectUtils.getStateValue(`Charger.${iWB}Power.Charge`);

		const Phases = this.wallboxInfoList[iWB].HardwareMin3 && this.wallboxInfoList[iWB].EnabledPhases ? this.wallboxInfoList[iWB].EnabledPhases : this.wallboxInfoList[iWB].GridPhases;

		OptAmpere = Math.floor(
			(solarPower -
				houseConsumption +
				(this.config.subtractSelfConsumption ? this.wallboxInfoList[iWB].ChargePower : 0) - // optional inclusion of charger power
				100 + // reserve offset
				(2000 / (100 - minHomeBatVal)) * (batSoC - minHomeBatVal)) / // discharge offset
				230 /
				Phases,
		);
		if (OptAmpere > 16) {
			OptAmpere = 16;
		}
		this.log.debug(`Optimal charging current would be: ${OptAmpere} A`);

		if (ZielAmpere < OptAmpere) {
			ZielAmpere++;
		} else if (ZielAmpere > OptAmpere) {
			ZielAmpere--;
		}

		this.log.debug(`ZielAmpere: ${ZielAmpere} A; Solar: ${solarPower} W; House: ${houseConsumption} W; Charger: ${this.wallboxInfoList[iWB].ChargePower} W`);

		if (ZielAmpere > 5 + 4) {
			await this.Charge_Config("1", ZielAmpere, `Charging current: ${ZielAmpere} A`, iWB);
		} else if (ZielAmpere < 6) {
			OffVerzoegerung++;
			if (OffVerzoegerung > 12) {
				await this.Charge_Config("0", ZielAmpere, `Insufficient surplus`, iWB);
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
	isLikeEmpty(inputVar: unknown): boolean {
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
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new go_e_charger(options);
} else {
	// otherwise start the instance directly
	(() => new go_e_charger())();
}
