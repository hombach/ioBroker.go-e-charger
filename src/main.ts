// The adapter-core module gives you access to the core ioBroker functions you need to create an adapter
import * as utils from "@iobroker/adapter-core";
import axios from "axios";
import { ProjectUtils } from "./lib/projectUtils";

const axiosInstance = axios.create({
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
	ProjectUtils = new ProjectUtils(this);
	timeoutList: ioBroker.Timeout[];

	/****************************************************************************************
	 * @param {Partial<utils.AdapterOptions>} [options={}]
	 */
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
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
	private async onReady(): Promise<void> {
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
		} else {
			this.log.error(`No IP address configured!! - shutting down adapter.`);
			await this.setState("info.connection", { val: false, ack: true });
			this.stop;
		}
	}

	/****************************************************************************************
	 * Is called if a subscribed state changes
	 * @param { string } id
	 * @param { ioBroker.State | null | undefined } state */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		try {
			if (state) {
				// The state was changed
				// this.subscribeStates(`Settings.*`);
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
										Charge3Phase = state.val;
										this.log.debug(`settings state changed to Charge3Phase: ${Charge3Phase}`);
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
				// state go-e-charger.1.Settings.ChargeManager deleted
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
			for (const timeoutJob of this.timeoutList) {
				this.clearTimeout(timeoutJob);
			}
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
		} else if (ChargeManager) {
			// Charge-Manager is enabled
			BatSoC = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
			// BatSoC = await this.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
			this.log.debug(`Got external state of battery SoC: ${BatSoC}%`);
			if (BatSoC >= MinHomeBatVal) {
				// SoC of home battery sufficient?
				await this.Charge_Manager();
			} else {
				// FUTURE: time of day forces emptying of home battery
				if ((await this.ProjectUtils.getStateValue("Power.ChargingAllowed")) == true) {
					// Set to false only if still true
					ZielAmpere = 6;
					await this.Charge_Config("0", ZielAmpere, `Hausbatterie laden bis ${MinHomeBatVal}%`);
				}
			}
		} else {
			// only if Power.ChargingAllowed is still set: switch OFF; set to min. current;
			if ((await this.ProjectUtils.getStateValue("Power.ChargingAllowed")) == true) {
				// Set to false only if still true
				await this.Read_Charger();
				if (HardwareMin3) {
					await this.Read_ChargerAPIV2();
				}
				ZielAmpere = 6;
				await this.Charge_Config("0", ZielAmpere, `go-eCharger abschalten`);
			} else if (Number(await this.ProjectUtils.getStateValue("Power.Charge")) > 0) {
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
	async Read_Charger(): Promise<void> {
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
				} else {
					this.log.error(`Error in calling go-eCharger API: ${error}`);
				}
				this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
			});
	} // END Read_Charger

	/*****************************************************************************************/
	async ParseStatus(status): Promise<void> {
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
		this.log.debug("got and parsed go-eCharger data");
	}

	/*****************************************************************************************/
	async Read_ChargerAPIV2(): Promise<void> {
		await axiosInstance
			.get(`http://${this.config.ipaddress}/api/status?filter=alw,acu,eto,amp,rbc,rbt,car,pha,fwv,nrg,psm,typ`, { transformResponse: r => r })
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

	/*****************************************************************************************/
	async ParseStatusAPIV2(status): Promise<void> {
		switch (status.psm) {
			case 1:
				await this.setState("Power.EnabledPhases", 1, true);
				EnabledPhases = 1;
				break;
			case 2:
				await this.setState("Power.EnabledPhases", 3, true);
				EnabledPhases = 3;
				break;
			default:
				await this.setState("Power.EnabledPhases", 0, true);
				EnabledPhases = 0;
		}
		this.log.debug(`got enabled phases ${EnabledPhases}`);
		Hardware = status.typ;
		await this.setState("Info.HardwareVersion", Hardware, true);
		this.log.debug(`got and parsed go-eCharger data with API V2`);
	}

	/*****************************************************************************************/
	async Switch_3Phases(Charge3Phase: boolean): Promise<void> {
		if (HardwareMin3) {
			let psm = 1;
			if (Charge3Phase) {
				psm = 2;
			}
			await axiosInstance
				.get(`http://${this.config.ipaddress}/api/set?psm=${psm}`, { transformResponse: r => r })
				.then(response => {
					//.status == 200
					this.log.debug(`Sent: PSM=${psm} with response ${response.statusText}`);
				})
				.catch(error => {
					this.log.warn(`Error: ${error} by writing @ ${this.config.ipaddress} 3 phases = ${Charge3Phase}`);
					this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
				});
		}
	}

	/*****************************************************************************************/
	async Charge_Config(Allow, Ampere, LogMessage): Promise<void> {
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
				// case '56.1', '56.2', '56.8', '56.9', '56.11', '57.0', '57.1':
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

	/*****************************************************************************************/
	async Charge_Manager(): Promise<void> {
		SolarPower = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomeSolarPower);
		this.log.debug(`Got external state of solar power: ${SolarPower} W`);
		HouseConsumption = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomePowerConsumption);
		this.log.debug(`Got external state of house power consumption: ${HouseConsumption} W`);
		BatSoC = await this.ProjectUtils.asyncGetForeignStateVal(this.config.StateHomeBatSoc);
		this.log.debug(`Got external state of battery SoC: ${BatSoC}%`);
		ChargePower = await this.ProjectUtils.getStateValue("Power.Charge");
		let Phases = 3;
		if (HardwareMin3 && EnabledPhases) {
			Phases = EnabledPhases;
		} else {
			Phases = GridPhases;
		}
		OptAmpere = Math.floor(
			(SolarPower -
				HouseConsumption +
				(this.config.SubtractSelfConsumption ? ChargePower : 0) - // Bedingte Einbeziehung von ChargePower
				100 + // Reserve
				(2000 / (100 - MinHomeBatVal)) * (BatSoC - MinHomeBatVal)) / // Batterieleerung
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

		this.log.debug(
			`ZielAmpere: ${ZielAmpere} Ampere; Leistung DC: ${SolarPower} W; ` +
				`Hausverbrauch: ${HouseConsumption} W; Gesamtleistung Charger: ${ChargePower} W`,
		);

		if (ZielAmpere > 5 + 4) {
			await this.Charge_Config("1", ZielAmpere, `Charging current: ${ZielAmpere} A`); // An und Zielstrom da größer 5 + Hysterese
		} else if (ZielAmpere < 6) {
			OffVerzoegerung++;
			if (OffVerzoegerung > 12) {
				await this.Charge_Config("0", ZielAmpere, `zu wenig Überschuss`); // Aus und Zielstrom
				OffVerzoegerung = 0;
			}
		}
	} // END Charge_Manager

	isLikeEmpty(inputVar): boolean {
		if (typeof inputVar !== "undefined" && inputVar !== null) {
			let sTemp = JSON.stringify(inputVar);
			sTemp = sTemp.replace(/\s+/g, ""); // remove all white spaces
			sTemp = sTemp.replace(/"+/g, ""); // remove all >"<
			sTemp = sTemp.replace(/'+/g, ""); // remove all >'<
			sTemp = sTemp.replace(/\[+/g, ""); // remove all >[<
			sTemp = sTemp.replace(/\]+/g, ""); // remove all >]<
			sTemp = sTemp.replace(/\{+/g, ""); // remove all >{<
			sTemp = sTemp.replace(/\}+/g, ""); // remove all >}<
			if (sTemp !== "") {
				return false;
			}
		}
		return true;
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
