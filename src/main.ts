// The adapter-core module gives you access to the core ioBroker functions you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import axios from "axios";
import { ProjectUtils, type IWallboxInfo } from "./lib/projectUtils";
const axiosInstance = axios.create({
	//timeout: 5000, //by default
});

// variables
let minHomeBatVal = 87;
let batSoC = 0;
let solarPower = 0;
let houseConsumption = 0;
let totalChargeEnergy = 0;
//ToDo let totalChargePower = 0;
//ToDo let totalMeasuredChargeCurrent = 0;

class go_e_charger extends utils.Adapter {
	private projectUtils = new ProjectUtils(this);

	//WIP NEW adapterIntervals: NodeJS.Timeout[];
	timeoutList: ioBroker.Timeout[];
	private pendingStateMachine: ioBroker.Timeout | null = null;
	private stateMachineRunning = false;
	private immediateRetrigger = false;
	//WiP
	wallboxInfoList: IWallboxInfo[] = [];

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

		minHomeBatVal = await this.projectUtils.getStateValue("Settings.Setpoint_HomeBatSoC"); // Get desired battery SoC
		this.log.debug(`Initial value for Setpoint HomeBatSoC: ${minHomeBatVal}%`);

		const wallBoxList = Array.isArray(this.config.wallBoxList) ? this.config.wallBoxList : [];
		if (!wallBoxList.length) {
			this.log.warn("No wallBoxList configured or wallBoxList is not an array. Charger setup will be skipped.");
		} else {
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
				MaxAmp: 16,
				DelayOff: 0,
				CurrentHysteresis: 0,
				SetOptAmp: 5,
				SetOptAllow: false,
				SetAmp: 0,
				SetAllow: false,
			}));
			this.log.info(`WallboxInfoList initialised with ${this.wallboxInfoList.length} entries`);
		}

		this.subscribeStates(`Settings.*`); //all states changes inside the adapters settings namespace are subscribed
		this.subscribeStates(`Wallbox_*.Settings.*`); //all states changes inside the adapters settings namespace are subscribed

		try {
			for (const [iWB, wallBox] of this.config.wallBoxList.entries()) {
				this.log.debug(`Setting up Wallbox ${iWB} with IP ${wallBox.ipAddress} in config`);
				if (!wallBox.ipAddress) {
					//if (!this.config.wallBoxList[iWB].ipAddress) {
					throw new Error(`Wallbox ${iWB} - IP address not set - stopping adapter`);
				}

				// init device
				await this.projectUtils.checkAndSetDevice(
					`Wallbox_${iWB}`,
					wallBox.chargerName || `Wallbox ${iWB}`,
					`info.connection`,
					`go-eCharger.png`,
					true,
				);

				// init channel for settings and info states for each charger
				await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.info`, `Informations about go-eCharger`, `go-eCharger.png`, true);
				await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.info.connection`, false, `Device connected`, "indicator.connected");
				await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.Power`, `current wallbox power data`, `go-eCharger.png`, true);
				await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.Settings`, `states to dynamically adjust wallbox settings`, `go-eCharger.png`, true);
				await this.projectUtils.checkAndSetChannel(`Wallbox_${iWB}.statistics`, `wallbox statistics data`, `go-eCharger.png`, true);

				// init settings values for each charger in wallboxInfoList
				await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.Settings.ChargeNOW`, false, `ChargeNOW enabled`, "switch", true, true);
				await this.projectUtils.checkAndSetValueBoolean(`Wallbox_${iWB}.Settings.ChargeManager`, false, `Charge Manager enabled`, "switch", true, true);
				await this.projectUtils.checkAndSetValueNumber(
					`Wallbox_${iWB}.Settings.ChargeCurrent`,
					this.wallboxInfoList[iWB].MinAmp,
					`charge current output`,
					"A",
					"value.current",
					true,
					false,
					true,
					this.wallboxInfoList[iWB].MinAmp,
					this.wallboxInfoList[iWB].MaxAmp,
					1,
				);
				this.wallboxInfoList[iWB].Charge3Phase = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.Charge3Phase`); // Get enable of 3 phases for charging override
				await this.projectUtils.checkAndSetValueBoolean(
					`Wallbox_${iWB}.Settings.Charge3Phase`,
					false,
					`Setting 3-phase charging`,
					"switch",
					true,
					true,
				);

				if (wallBox.ipAddress) {
					await this.Read_ChargerAPIV1(iWB);
					await this.Read_ChargerAPIV2(iWB);
					this.log.info(`IP address charger ${iWB} found in config: ${wallBox.ipAddress}`);
					void this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
				}

				this.wallboxInfoList[iWB].ChargeNOW = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeNOW`); // Get charging override trigger
				this.wallboxInfoList[iWB].ChargeManager = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeManager`); // Get enable for charge manager
				this.wallboxInfoList[iWB].ChargeCurrent = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.ChargeCurrent`); // Get current for charging override
				this.wallboxInfoList[iWB].Charge3Phase = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Settings.Charge3Phase`); // Get enable of 3 phases for charging override
			} // next wallbox
		} catch (e) {
			this.log.error((e as Error).message);
			void this.setState(`info.connection`, { val: false, ack: true });
			await this.stop?.({ exitCode: 11, reason: `invalid config` });
			return;
		}

		// init global statistics channel and states
		await this.projectUtils.checkAndSetChannel(`statisticsGlobal`, `statistical data sum of all chargers`, `go-eCharger.png`, true);
		await this.projectUtils.checkAndSetValueNumber(
			`statisticsGlobal.charged`,
			totalChargeEnergy,
			`Totally charged sum of all go-e in lifetime`,
			"kWh",
			"value",
			false,
			true,
		);

		// sentry.io ping
		if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
			const sentryInstance = this.getPluginInstance("sentry");
			if (sentryInstance) {
				const Sentry = sentryInstance.getSentryObject();
				Sentry &&
					Sentry?.withScope((scope: any) => {
						scope.setLevel("info");
						scope.setTag("Charger", this.config.wallBoxList.map(wb => wb.ipAddress).join(", "));
						scope.setTag("Firmware", this.wallboxInfoList.map(wb => wb.Firmware).join(", "));
						scope.setTag("Hardware", this.wallboxInfoList.map(wb => wb.Hardware).join(", "));
						Sentry.captureMessage("Adapter go-e-Charger started", "info"); // Level "info"
					});
			}
		}

		await this.firstStart();
		this.log.debug(`Start init done, launching state machine interval`);
		void this.setState(`info.connection`, { val: true, ack: true });

		this.pendingStateMachine = this.setTimeout(this.StateMachine.bind(this), Number(this.config.cycleTime)) ?? null;
		if (this.pendingStateMachine != null) {
			this.timeoutList.push(this.pendingStateMachine);
		}
	}

	/**
	 * Cancels the pending StateMachine timer and schedules an immediate run.
	 * If StateMachine is currently executing, sets a flag so it re-runs as soon as it finishes.
	 */
	private triggerStateMachineNow(): void {
		if (this.stateMachineRunning) {
			this.immediateRetrigger = true;
			return;
		}
		if (this.pendingStateMachine != null) {
			this.clearTimeout(this.pendingStateMachine);
			this.timeoutList = this.timeoutList.filter(t => t !== this.pendingStateMachine);
			this.pendingStateMachine = null;
		}
		this.pendingStateMachine = this.setTimeout(this.StateMachine.bind(this), 500) ?? null;
		if (this.pendingStateMachine != null) {
			this.timeoutList.push(this.pendingStateMachine);
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
				// The state was changed - this.subscribeStates(`Settings.*`);  -  "go-e-charger.0.Settings.Setpoint_HomeBatSoC"
				// The state was changed - this.subscribeStates(`Wallbox*.`);  -  "go-e-charger.0.Wallbox_0.Settings.ChargeNOW"
				if (!state.ack) {
					this.log.debug(`state change detected and parsing for id: ${id} - state: ${state.val}`);

					if (id.includes(`.Settings.`)) {
						const statePath = id.split(".");
						let settingType = "";
						let chargerNo = -1;
						// Example:
						// go-e-charger.0.Settings.Setpoint_HomeBatSoC
						// go-e-charger.0.Wallbox_0.Settings.ChargeNOW

						switch (statePath[2]) {
							case "Settings":
								settingType = statePath[3];
								switch (settingType) {
									case "Setpoint_HomeBatSoC":
										if (typeof state.val === "number") {
											minHomeBatVal = state.val;
											this.log.debug(`settings state changed to Setpoint_HomeBatSoC: ${minHomeBatVal}`);
											void this.setState(id, state.val, true);
										} else {
											this.log.warn(`Wrong type for Setpoint_HomeBatSoC: ${state.val}`);
										}
										break;
									default:
										this.log.debug(`unknown value for setting type: ${settingType}`);
								}
								break;
							default:
								// Match Wallbox_0, Wallbox_1, ...
								// go-e-charger.0.Wallbox_2.Settings.ChargeNOW
								if (statePath[2].startsWith("Wallbox_") && statePath[3] === "Settings") {
									chargerNo = Number(statePath[2].replace("Wallbox_", ""));
									settingType = statePath[4];

									switch (settingType) {
										case "ChargeNOW":
											if (typeof state.val === "boolean") {
												this.wallboxInfoList[chargerNo].ChargeNOW = state.val;
												this.log.debug(`settings state changed to ChargeNOW: ${this.wallboxInfoList[chargerNo].ChargeNOW}`);
												void this.setState(id, state.val, true);
												this.triggerStateMachineNow();
											} else {
												this.log.warn(`Wrong type for ChargeNOW: ${state.val}`);
											}
											break;
										case "ChargeManager":
											if (typeof state.val === "boolean") {
												this.wallboxInfoList[chargerNo].ChargeManager = state.val;
												this.log.debug(`settings state changed to ChargeManager: ${this.wallboxInfoList[chargerNo].ChargeManager}`);
												void this.setState(id, state.val, true);
												this.triggerStateMachineNow();
											} else {
												this.log.warn(`Wrong type for ChargeManager: ${state.val}`);
											}
											break;
										case "ChargeCurrent":
											if (typeof state.val === "number") {
												this.wallboxInfoList[chargerNo].ChargeCurrent = state.val;
												this.log.debug(`settings state changed to ChargeCurrent: ${this.wallboxInfoList[chargerNo].ChargeCurrent}`);
												void this.setState(id, state.val, true);
												this.triggerStateMachineNow();
											} else {
												this.log.warn(`Wrong type for ChargeCurrent: ${state.val}`);
											}
											break;
										case "Charge3Phase":
											if (typeof state.val === "boolean") {
												this.wallboxInfoList[chargerNo].Charge3Phase = state.val;
												this.log.debug(`settings state changed to Charge3Phase: ${this.wallboxInfoList[chargerNo].Charge3Phase}`);
												void this.setState(id, state.val, true);
												this.triggerStateMachineNow();
											} else {
												this.log.warn(`Wrong type for Charge3Phase: ${state.val}`);
											}
											break;
										default:
											this.log.debug(`unknown value for setting type: ${settingType}`);
									}
								} else {
									this.log.debug(`unknown settings value`);
								}
						}
					}
				}
			} else {
				this.log.warn(`state ${id} deleted`);
			}
		} catch (error) {
			this.log.error(`Unhandled exception processing onStateChange: ${error as Error}`);
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
			for (const [iWB] of this.config.wallBoxList.entries()) {
				void this.setState(`Wallbox_${iWB}.info.connection`, { val: false, ack: true });
			}
			void this.setState(`info.connection`, false, true);
			callback();
		} catch (error) {
			this.log.warn((error as Error).message);
			callback();
		}
	}

	/**
	 * Handles the initial startup check for all configured go-e Chargers.
	 *
	 * Checks the detected firmware version of each wallbox and performs the following:
	 * - Logs an error and stops the adapter if no charger is reachable.
	 * - Sets the connection state accordingly.
	 * - Logs a warning and reports unknown firmware versions via Sentry (if available).
	 *
	 */
	private async firstStart(): Promise<void> {
		for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
			this.log.debug(`Initial ReadCharger done, detected charger ${iWB} firmware ${this.wallboxInfoList[iWB].Firmware}`);
			switch (this.wallboxInfoList[iWB].Firmware) {
				case "0":
				case "EHostUnreach":
					this.log.warn(
						`Charger ${iWB} not reachable at startup (${this.config.wallBoxList[iWB].ipAddress}) - marked disconnected, will retry in StateMachine.`,
					);
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
					this.log.debug(`Init done, launching state machine`);
					await this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
					break;
				default:
					this.log.warn(`Not explicitly supported firmware ${this.wallboxInfoList[iWB].Firmware} for charger ${iWB} found!!!`);
					await this.setState(`Wallbox_${iWB}.info.connection`, { val: true, ack: true });
					// sentry.io send firmware version
					if (this.supportsFeature && this.supportsFeature("PLUGINS")) {
						const sentryInstance = this.getPluginInstance("sentry");
						if (sentryInstance) {
							const Sentry = sentryInstance.getSentryObject();
							Sentry &&
								Sentry?.withScope((scope: any) => {
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
	async StateMachine(): Promise<void> {
		this.stateMachineRunning = true;
		this.immediateRetrigger = false;
		this.log.debug(`StateMachine cycle start`);
		try {
			totalChargeEnergy = 0; // reset total charge energy at the beginning of each cycle, will be accumulated from all chargers in the loop below
			for (let iWB = 0; iWB < this.config.wallBoxList.length; iWB++) {
				if (this.wallboxInfoList[iWB].ChargeNOW || this.wallboxInfoList[iWB].ChargeManager) {
					// Charge-NOW or Charge-Manager is enabled
					await this.Read_ChargerAPIV1(iWB);
					if (this.wallboxInfoList[iWB].Firmware === `EHostUnreach`) {
						void this.setState(`Wallbox_${iWB}.info.connection`, { val: false, ack: true });
						this.log.debug(`Charger ${iWB} unreachable, skipping control actions this cycle`);
						continue;
					}
					if (this.wallboxInfoList[iWB].HardwareMin3) {
						await this.Read_ChargerAPIV2(iWB);
					}
				}

				if (this.wallboxInfoList[iWB].ChargeNOW) {
					// Charge-NOW is enabled
					await this.Charge_Config("1", this.wallboxInfoList[iWB].ChargeCurrent, `activate go-eCharger for forced charging`, iWB); // keep active charging current!!
					await this.Switch_3Phases(this.wallboxInfoList[iWB].Charge3Phase, iWB);
					if (this.wallboxInfoList[iWB].HardwareMin3) {
						await this.Read_ChargerAPIV2(iWB);
					}
				} else if (this.wallboxInfoList[iWB].ChargeManager) {
					// Charge-Manager is enabled
					batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
					// WiP batSoC = await this.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
					this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
					if (batSoC >= minHomeBatVal) {
						// SoC of home battery is sufficient
						await this.Switch_3Phases(this.wallboxInfoList[iWB].Charge3Phase, iWB);
						await this.Charge_Manager(iWB);
					} else {
						// FUTURE: time of day forces emptying of home battery
						if ((await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true) {
							// Set to false only if still true
							this.wallboxInfoList[iWB].SetAmp = 6;
							await this.Charge_Config("0", this.wallboxInfoList[iWB].SetAmp, `Charging home battery until ${minHomeBatVal}%`, iWB);
						}
					}
				} else {
					// only if Power.ChargingAllowed is still set: switch OFF; set to min. current;
					if ((await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.ChargingAllowed`)) == true) {
						// Set to false only if still true
						await this.Read_ChargerAPIV1(iWB);
						if (this.wallboxInfoList[iWB].Firmware === `EHostUnreach`) {
							void this.setState(`Wallbox_${iWB}.info.connection`, { val: false, ack: true });
							this.log.debug(`Charger ${iWB} unreachable, skipping deactivation this cycle`);
							continue;
						}
						if (this.wallboxInfoList[iWB].HardwareMin3) {
							await this.Read_ChargerAPIV2(iWB);
						}
						this.wallboxInfoList[iWB].SetAmp = 6;
						await this.Charge_Config("0", this.wallboxInfoList[iWB].SetAmp, `Deactivate go-eCharger`, iWB);
					} else if (Number(await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.Charge`)) > 0) {
						await this.Read_ChargerAPIV1(iWB);
						if (this.wallboxInfoList[iWB].Firmware !== `EHostUnreach` && this.wallboxInfoList[iWB].HardwareMin3) {
							await this.Read_ChargerAPIV2(iWB);
						}
					}
				}
				totalChargeEnergy += Number(await this.projectUtils.getStateValue(`Wallbox_${iWB}.statistics.chargedEnergy`)) || 0; // accumulate total charged energy of all chargers
			} // next wallbox

			// global statistics
			await this.projectUtils.checkAndSetValueNumber(
				`statisticsGlobal.chargedEnergy`,
				totalChargeEnergy,
				`Totally charged sum of all go-e in lifetime`,
				"kWh",
				"value.energy.consumed",
			);
		} catch (error) {
			this.log.error(`Unhandled exception in StateMachine: ${String(error)}`);
		} finally {
			this.stateMachineRunning = false;
			const delay = this.immediateRetrigger ? 0 : Number(this.config.cycleTime);
			this.pendingStateMachine = this.setTimeout(this.StateMachine.bind(this), delay) ?? null;
			if (this.pendingStateMachine != null) {
				this.timeoutList.push(this.pendingStateMachine);
			}
		}
	} // END StateMachine

	/**
	 * Reads the status of a go-e Charger using API V1.
	 *
	 * Performs an HTTP GET request to the `/status` endpoint of the wallbox,
	 * parses the JSON response and passes it to `ParseStatusAPIV1`.
	 *
	 * @param iWB - Index of the wallbox in the configuration list (`wallBoxList`)
	 */
	async Read_ChargerAPIV1(iWB: number): Promise<void> {
		await axiosInstance
			.get(`http://${this.config.wallBoxList[iWB].ipAddress}/status`, { transformResponse: r => r })
			.then(response => {
				//.status == 200
				const result = JSON.parse(response.data);
				this.log.debug(`Read charger ${iWB} API V1: ${response.data}`);
				void this.ParseStatusAPIV1(result, iWB);
			})
			.catch(error => {
				this.log.error(`Error reading charger ${iWB} API V1 (${this.config.wallBoxList[iWB].ipAddress}): ${error}`);
				this.wallboxInfoList[iWB].Firmware = `EHostUnreach`;
			});
	}

	/**
	 * Parses the status response from a go-e Charger API V1 and updates all relevant states.
	 *
	 * Processes the received JSON data (car state, currents, power, energy, firmware, etc.)
	 * and writes the values into the corresponding objects in the adapter.
	 *
	 * @param status - Status object returned by the go-e Charger API V1
	 * @param status.rbc - reboot counter
	 * @param status.rbt - reboot timer
	 * @param status.car - Car state
	 * @param status.amp - Current amperage persistent
	 * @param status.amx - Current amperage volatile
	 * @param status.alw - Allow charging
	 * @param status.pha - Phases config
	 * @param status.eto - Energy charged total
	 * @param status.nrg - Energy states array
	 * @param status.fwv - Firmware version
	 * @param status.uby - Unlocked by RFID number
	 * @param iWB - Index of the wallbox in the configuration list (`wallBoxList`)
	 */

	async ParseStatusAPIV1(
		status: {
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

			// === RFID Felder hinzufügen ===
			rca?: string;
			rcr?: string;
			rcd?: string;
			rc4?: string;
			rc5?: string;
			rc6?: string;
			rc7?: string;
			rc8?: string;
			rc9?: string;
			rc1?: string;

			rna?: string;
			rnm?: string;
			rne?: string;
			rn4?: string;
			rn5?: string;
			rn6?: string;
			rn7?: string;
			rn8?: string;
			rn9?: string;
			rn1?: string;

			eca?: number;
			ecr?: number;
			ecd?: number;
			ec4?: number;
			ec5?: number;
			ec6?: number;
			ec7?: number;
			ec8?: number;
			ec9?: number;
			ec1?: number;
		},
		iWB: number,
	): Promise<void> {
		const basePath = `Wallbox_${iWB}`;

		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.statistics.rebootCounter`,
			Number(status.rbc),
			`Counter for system reboot events`,
			"",
			"value",
		);
		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.statistics.rebootTimer`,
			Math.floor(status.rbt / 1000 / 3600),
			`Time since last reboot`,
			"h",
			"value",
		);
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.carState`, Number(status.car), "State of connected car", "", "value");
		switch (status.car) {
			case "1":
				await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, "Wallbox ready, no car", "State of connected car", "value");
				break;
			case "2":
				await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, "Charging...", "State of connected car", "value");
				break;
			case "3":
				await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, "Wait for car", "State of connected car", "value");
				break;
			case "4":
				await this.projectUtils.checkAndSetValue(
					`${basePath}.info.carStateString`,
					`Charge finished, car still connected`,
					"State of connected car",
					"value",
				);
				break;
			default:
				await this.projectUtils.checkAndSetValue(`${basePath}.info.carStateString`, "Error", `State of connected car`, "value");
		}

		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.ChargeCurrent`, Number(status.amp), `Charge current output`, "A", "value.current");
		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.Power.ChargeCurrentVolatile`,
			Number(status.amx),
			`Charge current output volatile`,
			"A",
			"value.current",
		);
		switch (status.alw) {
			case "0":
				await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, false, `Charging allowed`, "switch.mode.manual");
				break;
			case "1":
				await this.projectUtils.checkAndSetValueBoolean(`${basePath}.Power.ChargingAllowed`, true, `Charging allowed`, "switch.mode.manual");
				break;
		}
		this.wallboxInfoList[iWB].GridPhases = ((32 & status.pha) >> 5) + ((16 & status.pha) >> 4) + ((8 & status.pha) >> 3);
		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.Power.GridPhases`,
			this.wallboxInfoList[iWB].GridPhases,
			`No of available grid phases`,
			"phase",
			"value",
		);
		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.statistics.chargedEnergy`,
			status.eto / 10,
			`Totally charged in wallbox lifetime`,
			"kWh",
			"value.energy.consumed",
		);
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.Power.Charge`, status.nrg[11] * 10, `actual charging-power`, "W", "value.power");
		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.Power.MeasuredMaxPhaseCurrent`,
			Math.max(...status.nrg.slice(4, 7)) / 10,
			`Measured max. current of grid phases`,
			"A",
			"value.current",
		);
		this.wallboxInfoList[iWB].Firmware = status.fwv;
		void this.projectUtils.checkAndSetValue(`${basePath}.info.firmwareVersion`, status.fwv, `Firmware version of charger`);
		// WiP 634
		// uby - uint8_t - unlocked_by: Nummer der RFID Karte, die den jetzigen Ladevorgang freigeschalten hat
		void this.projectUtils.checkAndSetValueNumber(`${basePath}.info.unlockedByRFIDNo`, Number(status.uby), `Number of current session RFID chip`);
		// WiP 634

		// WiP 802 - RFID Karten (nur bei gefüllten Daten anlegen)
		const rfidIds = ["rca", "rcr", "rcd", "rc4", "rc5", "rc6", "rc7", "rc8", "rc9", "rc1"];
		const rfidNames = ["rna", "rnm", "rne", "rn4", "rn5", "rn6", "rn7", "rn8", "rn9", "rn1"];
		const rfidEnergy = ["eca", "ecr", "ecd", "ec4", "ec5", "ec6", "ec7", "ec8", "ec9", "ec1"];

		for (let i = 0; i < 10; i++) {
			const idKey = rfidIds[i];
			const nameKey = rfidNames[i];
			const energyKey = rfidEnergy[i];
			const cardId = (status[idKey as keyof typeof status] as string | undefined)?.toString().trim();
			const cardName = (status[nameKey as keyof typeof status] as string | undefined)?.toString().trim();
			const energyRaw = status[energyKey as keyof typeof status] as number | undefined;

			if (!cardId || cardId === "0") {
				// await this.projectUtils.deleteChannel(`${basePath}.statistics.RFID${i + 1}`);
				continue;
			}

			const cardNumber = i + 1;
			const channelPath = `${basePath}.statistics.RFID${cardNumber}`;
			await this.projectUtils.checkAndSetChannel(channelPath, cardName || `Karte ${cardNumber}`);
			await this.projectUtils.checkAndSetValueNumber(
				`${channelPath}.chargedEnergy`,
				Number(energyRaw) / 10 || 0,
				`Charged energy for RFID chip ${cardNumber}`,
				"kWh",
				"value.energy.consumed",
			);
			if (cardId && cardId !== "n/a") {
				await this.projectUtils.checkAndSetValue(`${channelPath}.cardId`, cardId, `RFID Card ID ${cardNumber}`);
			}
			if (cardName && cardName !== "n/a") {
				await this.projectUtils.checkAndSetValue(`${channelPath}.cardName`, cardName, `RFID Card Name ${cardNumber}`);
			}
		}
		// WiP 802

		this.log.debug(`got and parsed go-e charger ${iWB} data`);
	}

	/**
	 * Reads the status of a go-e Charger using API V2.
	 *
	 * Performs an HTTP GET request to the `/status` endpoint of the wallbox,
	 * parses the JSON response and passes it to `ParseStatusAPIV2`.
	 *
	 * @param iWB - Index of the wallbox in the configuration list (`wallBoxList`)
	 */
	async Read_ChargerAPIV2(iWB: number): Promise<void> {
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
				this.log.warn(
					`Error reading charger ${iWB} API V2 (${this.config.wallBoxList[iWB].ipAddress}): ${error} - if hardware gen 3+, ensure API V2 is enabled in go-e app`,
				);
			});
	}

	/**
	 * Parses and processes status information from the go-eCharger API V2.
	 *
	 * @param status - The API V2 status object returned by the wallbox.
	 * @param status.psm - Phase switching mode (1 = single-phase, 2 = three-phase).
	 * @param status.typ - Hardware version or type identifier.
	 * @param iWB - Index of the charger in the configuration list.
	 * @description
	 * The `ParseStatusAPIV2` function interprets the charger’s API V2 status data and updates internal states accordingly:
	 * - Maps the numeric phase switching mode (`psm`) to the number of enabled phases.
	 * - Updates `Power.EnabledPhases` and `info.hardwareVersion` states.
	 * - Logs the parsed data for debugging and traceability.
	 */
	private ParseStatusAPIV2(status: { psm: number; typ: string }, iWB: number): void {
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
		void this.projectUtils.checkAndSetValueNumber(
			`${basePath}.Power.EnabledPhases`,
			this.wallboxInfoList[iWB].EnabledPhases,
			`No of enabled phases in go-e wallbox`,
			"phase",
			"value",
		);
		this.log.debug(`got enabled phases for charger ${iWB}: ${this.wallboxInfoList[iWB].EnabledPhases}`);
		this.wallboxInfoList[iWB].Hardware = status.typ;
		void this.projectUtils.checkAndSetValue(`${basePath}.info.hardwareVersion`, status.typ, `Hardware version of charger`, "value");
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
		const basePath = `Wallbox_${iWB}`;
		if (!this.config.wallBoxList[iWB].readOnlyMode) {
			await axiosInstance
				.get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=alw=${Allow}`, { transformResponse: r => r }) // activate charging
				.then(response => {
					//.status == 200
					this.log.debug(`Sent to charger ${iWB}: ${response.data}`);
				})
				.catch(error => {
					this.log.warn(`Error: ${error} by writing to wallbox ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} alw=${Allow}`);
					this.log.error(`Please verify IP address of wallbox ${iWB}: ${this.config.wallBoxList[iWB].ipAddress} !!!`);
				});
		}

		switch (this.wallboxInfoList[iWB].Firmware) {
			case "033":
				await axiosInstance
					.get(`http://${this.config.wallBoxList[iWB].ipAddress}/mqtt?payload=amp=${Ampere}`, { transformResponse: r => r }) // set charging current
					.then(async response => {
						//.status == 200
						this.log.debug(`Sent to charger ${iWB} with firmware 033: ${response.data}`);
						const result = JSON.parse(response.data);
						void this.projectUtils.checkAndSetValueNumber(
							`${basePath}.Power.ChargeCurrent`,
							Number(result.amp),
							`Charge current output`,
							"A",
							"value.current",
						);
						switch (result.alw) {
							case "0":
								await this.projectUtils.checkAndSetValueBoolean(
									`${basePath}.Power.ChargingAllowed`,
									false,
									`Charging allowed`,
									"switch.mode.manual",
								);
								break;
							case "1":
								await this.projectUtils.checkAndSetValueBoolean(
									`${basePath}.Power.ChargingAllowed`,
									true,
									`Charging allowed`,
									"switch.mode.manual",
								);
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
					.then(async response => {
						//.status == 200
						this.log.debug(`Sent to charger ${iWB} with firmware > 033: ${response.data}`);
						const result = JSON.parse(response.data);
						void this.projectUtils.checkAndSetValueNumber(
							`${basePath}.Power.ChargeCurrent`,
							Number(result.amp),
							`Charge current output`,
							"A",
							"value.current",
						);
						switch (result.alw) {
							case "0":
								await this.projectUtils.checkAndSetValueBoolean(
									`${basePath}.Power.ChargingAllowed`,
									false,
									`Charging allowed`,
									"switch.mode.manual",
								);
								break;
							case "1":
								await this.projectUtils.checkAndSetValueBoolean(
									`${basePath}.Power.ChargingAllowed`,
									true,
									`Charging allowed`,
									"switch.mode.manual",
								);
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
	async Charge_Manager(iWB: number): Promise<void> {
		solarPower = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeSolarPower);
		this.log.debug(`Got external state of solar power: ${solarPower} W`);
		houseConsumption = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomePowerConsumption);
		this.log.debug(`Got external state of house power consumption: ${houseConsumption} W`);
		batSoC = await this.projectUtils.asyncGetForeignStateVal(this.config.stateHomeBatSoc);
		this.log.debug(`Got external state of battery SoC: ${batSoC}%`);
		this.wallboxInfoList[iWB].ChargePower = await this.projectUtils.getStateValue(`Wallbox_${iWB}.Power.Charge`);

		const Phases =
			this.wallboxInfoList[iWB].HardwareMin3 && this.wallboxInfoList[iWB].EnabledPhases
				? this.wallboxInfoList[iWB].EnabledPhases
				: this.wallboxInfoList[iWB].GridPhases;

		this.wallboxInfoList[iWB].SetOptAmp = Math.floor(
			(solarPower -
				houseConsumption +
				(this.config.subtractSelfConsumption ? this.wallboxInfoList[iWB].ChargePower : 0) - // optional inclusion of charger power
				100 + // reserve offset
				(2000 / (100 - minHomeBatVal)) * (batSoC - minHomeBatVal)) / // discharge offset
				230 /
				Phases,
		);

		this.wallboxInfoList[iWB].SetOptAmp = Math.min(this.wallboxInfoList[iWB].SetOptAmp, 16);
		// TODO : make max. current configurable -> this.wallboxInfoList[iWB].MaxAmp
		this.log.debug(`Optimal charging current would be: ${this.wallboxInfoList[iWB].SetOptAmp} A`);

		if (this.wallboxInfoList[iWB].SetAmp < this.wallboxInfoList[iWB].SetOptAmp) {
			this.wallboxInfoList[iWB].SetAmp++;
		} else if (this.wallboxInfoList[iWB].SetAmp > this.wallboxInfoList[iWB].SetOptAmp) {
			this.wallboxInfoList[iWB].SetAmp--;
		}

		this.log.debug(
			`ZielAmpere: ${this.wallboxInfoList[iWB].SetAmp} A; Solar: ${solarPower} W; House: ${houseConsumption} W; Charger: ${this.wallboxInfoList[iWB].ChargePower} W`,
		);

		if (this.wallboxInfoList[iWB].SetAmp > 5 + 4) {
			await this.Charge_Config("1", this.wallboxInfoList[iWB].SetAmp, `Charging current: ${this.wallboxInfoList[iWB].SetAmp} A`, iWB);
		} else if (this.wallboxInfoList[iWB].SetAmp < 6) {
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
