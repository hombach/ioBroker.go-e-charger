﻿// The adapter-core module gives you access to the core ioBroker functions you need to create an adapter
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
	private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
		try {
			if (state) {
				// The state was changed
				if (!state.ack) {
					this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
					MinHomeBatVal = await this.ProjectUtils.getStateValue("Settings.Setpoint_HomeBatSoC"); // Get desired battery SoC
					await this.setState("Settings.Setpoint_HomeBatSoC", MinHomeBatVal, true);
					ChargeNOW = await this.ProjectUtils.getStateValue("Settings.ChargeNOW"); // Get charging override trigger
					await this.setState("Settings.ChargeNOW", ChargeNOW, true);
					ChargeManager = await this.ProjectUtils.getStateValue("Settings.ChargeManager"); // Get enable for charge manager
					await this.setState("Settings.ChargeManager", ChargeManager, true);
					ChargeCurrent = await this.ProjectUtils.getStateValue("Settings.ChargeCurrent"); // Get current for charging override
					await this.setState("Settings.ChargeCurrent", ChargeCurrent, true);
					Charge3Phase = await this.ProjectUtils.getStateValue("Settings.Charge3Phase"); // Get enable of 3 phases for charging override
					await this.setState("Settings.Charge3Phase", Charge3Phase, true);
				}
			} else {
				// The state was deleted
				this.log.warn(`state ${id} deleted`);
			}
		} catch (error) {
			this.log.error(`Unhandled exception processing stateChange: ${error}`);
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

/*
Erklärung Format: alle Parameter werden im JSON Objekt als String gesendet (in Anführungszeichen). Die meisten dieser
Parameter können in ein integer Format konvertiert werden. Der bei Format angegebene Datentyp zeigt die zu erwartende
Größe. Sollte der String nicht in den angegebenen Datentyp konvertiert werden, soll ein Kommunikationsfehler angezeigt
werden.

Parameter - Format - Erklärung
version - String(1) - JSON Format; "B": Normalfall; "C": Wenn Ende-zu-Ende Verschlüsselung aktiviert
rbc     - uint32_t  - reboot_counter; Zählt die Anzahl der Bootvorgänge.
rbt     - uint32_t  - reboot_timer; Zählt die Millisekunden seit dem letzten Bootvorgang.
car     - uint8_t   - Status PWM Signalisierung
                      1: Ladestation bereit, kein Fahrzeug   2: Fahrzeug lädt
                      3: Warte auf Fahrzeug                  4: Ladung beendet, Fahrzeug noch verbunden
amp     - uint8_t   - Ampere Wert für die PWM Signalisierung in ganzen Ampere von 6-32A
amx     - uint8_t   - Ampere Wert für die PWM Signalisierung in ganzen Ampere von 6-32A.
                      Wird nicht auf dem Flash persistiert, verhält sich sonst aber gleich wie amp.
                      Nach dem reboot wird amp auf den letzten Wert zurückgesetzt, der mit amp gesetzt wurde.
                      Für PV Regelung empfohlen.
err     - uint8_t   - error
                      1: RCCB (Fehlerstromschutzschalter)    3: PHASE (Phasenstörung)
                      8: NO_GROUND (Erdungserkennung)        10, default: INTERNAL (sonstiges)
ast     - uint8_t   - access_state: Zugangskontrolle
                      0: Offen                               1: RFID / App benötigt
                      2: Strompreis / automatisch
alw     - uint8_t   - allow_charging: PWM Signal darf anliegen; 0: nein; 1: ja
stp     - uint8_t   - stop_state: Automatische Abschaltung; 0: deaktiviert; 2: nach kWh abschalten
cbl     - uint8_t   - Typ2 Kabel Ampere codierung; 13-32: Ampere Codierung; 0: kein Kabel
pha     - uint8_t   - Phasen vor und nach dem Schütz; binary flags: 0b00ABCDEF
                      A... phase 3 vor dem Schütz            B... phase 2 vor dem Schütz
                      C... phase 1 vor dem Schütz            D... phase 3 nach dem Schütz
                      E... phase 2 nach dem Schütz           F... phase 1 nach dem Schütz
tmp     - uint8_t   - Temperatur des Controllers in °C
tma     -           - internal temperature sensor 0-3
amt     -           - max ampere limited through temperature sensors (32 = no limit)
dws     - uint32_t  - Geladene Energiemenge in Deka-Watt-Sekunden
dwo     - uint16_t  - Abschaltwert in 0.1kWh wenn stp==2, für dws Parameter
adi     - uint8_t   - adapter_in: Ladebox ist mit Adapter angesteckt; 0: NO_ADAPTER; 1: 16A_ADAPTER
uby     - uint8_t   - unlocked_by: Nummer der RFID Karte, die den jetzigen Ladevorgang freigeschalten hat
eto     - uint32_t  - energy_total: Gesamt geladene Energiemenge in 0.1kWh
wst     - uint8_t   - wifi_state: WLAN Verbindungsstatus; 3: verbunden; default: nicht verbunden
nrg     - array[15] - Array mit Werten des Strom- und Spannungssensors
                      nrg[0]: Spannung auf L1 in Volt            nrg[1]: Spannung auf L2 in Volt
                      nrg[2]: Spannung auf L3 in Volt            nrg[3]: Spannung auf N in Volt
                      nrg[4]: Ampere auf L1 in 0.1A              nrg[5]: Ampere auf L2 in 0.1A
                      nrg[6]: Ampere auf L3 in 0.1A              nrg[7]: Leistung auf L1 in 0.1kW
                      nrg[8]: Leistung auf L2 in 0.1kW           nrg[9]: Leistung auf L3 in 0.1kW
                      nrg[10]: Leistung auf N in 0.1kW           nrg[11]: Leistung gesamt in 0.01kW
                      nrg[12]: Leistungsfaktor auf L1 in %       nrg[13]: Leistungsfaktor auf L2 in %
                      nrg[14]: Leistungsfaktor auf L3 in %       nrg[15]: Leistungsfaktor auf N in %
fwv     - String    - Firmware Version
sse     - String    - Seriennummer als %06d formatierte Zahl
wss     - String    - WLAN SSID
wke     - String    - WLAN Key
wen     - uint8_t   - wifi_enabled: WLAN aktiviert; 0: deaktiviert; 1: aktiviert
tof     - uint8_t   - time_offset: Zeitzone in Stunden für interne batteriegestützte Uhr +100; Beispiel: 101 entspricht GMT+1
tds     - uint8_t   - Daylight saving time offset (Sommerzeit) in Stunden
lbr     - uint8_t   - LED Helligkeit von 0-255; 0: LED aus; 255: LED Helligkeit maximal
aho     - uint8_t   - Minimale Anzahl von Stunden in der mit "Strompreis-automatisch" geladen werden muss
afi     - uint8_t   - Stunde (Uhrzeit) in der mit "Strompreis - automatisch" die Ladung mindestens aho Stunden gedauert haben muss.
azo     - uint8_t   - Awattar Preiszone; 0: Österreich; 1: Deutschland
ama     - uint8_t   - Absolute max. Ampere: Maximalwert für Ampere Einstellung
al1     - uint8_t   - Ampere Level 1 für Druckknopf am Gerät.
                      6-32: Ampere Stufe aktiviert           0: Stufe deaktivert (wird übersprungen)
al2     - uint8_t   - Ampere Level 2 für Druckknopf am Gerät; muss entweder 0 oder > al1 sein
al3     - uint8_t   - Ampere Level 3 für Druckknopf am Gerät; muss entweder 0 oder > al2 sein
al4     - uint8_t   - Ampere Level 4 für Druckknopf am Gerät; muss entweder 0 oder > al3 sein
al5     - uint8_t   - Ampere Level 5 für Druckknopf am Gerät; muss entweder 0 oder > al4 sein
cid     - uint24_t  - Color idle: Farbwert für Standby (kein Auto angesteckt) als Zahl
cch     - uint24_t  - Color charging: Farbwert für Ladevorgang aktiv, als Zahl
cfi     - uint24_t  - Color idle: Farbwert für Ladevorgang abgeschlossen, als Zahl
lse     - uint8_t   - led_save_energy: LED automatisch nach 10 Sekunden abschalten
                      0: Energiesparfunktion deaktiviert     1: Energiesparfunktion aktiviert
ust     - uint8_t   - unlock_state: Kabelverriegelung Einstellung
                      0: Verriegeln solange Auto angesteckt  1: Nach Ladevorgang automatisch entriegeln
                      2: Kabel immer verriegelt lassen
wak     - String    - WLAN Hotspot Password; Beispiel: "abdef0123456"
r1x     - uint8_t   - Flags
                      0b1: HTTP Api im WLAN Netzwerk aktiviert (0: nein, 1:ja)
                      0b10: Ende-zu-Ende Verschlüsselung aktiviert (0: nein, 1:ja)
dto     - uint8_t   - Restzeit in Millisekunden verbleibend auf Aktivierung durch Strompreise
nmo     - uint8_t   - Norwegen-Modus aktiviert
                      0: deaktiviert (Erdungserkennung aktiviert)
                      1: aktiviert (keine Erdungserkennung, nur für IT-Netze gedacht)
eca; ecr; ecd; ec4; ec5; ec6; ec7; ec8; ec9; ec1
        - uint32_t  - Geladene Energiemenge pro RFID Karte von 1-10
rca; rcr; rcd; rc4; rc5; rc6; rc7; rc8; rc9; rc1
        - String    - RFID Karte ID von 1-10 als String Format und Länge: variabel, je nach Version
rna; rnm; rne; rn4; rn5; rn6; rn7; rn8; rn9; rn1
        - String    - RFID Karte Name von 1-10; Maximallänge: 10 Zeichen
tme     - String    - Aktuelle Uhrzeit, formatiert als ddmmyyhhmm
sch     - String    - Scheduler einstellungen (base64 encodiert)
sdp     - uint8_t   - Scheduler double press: Aktiviert Ladung nach doppeltem Drücken des Button, wenn die Ladung gerade durch den Scheduler unterbrochen wurde
                      0: Funktion deaktiviert                1: Ladung sofort erlauben
upd     - uint8_t   - Update available (nur verfügbar bei Verbindung über go-e Server)
                      0: kein Update verfügbar               1: Update verfügbar
cdi     - uint8_t   - Cloud disabled
                      0: cloud enabled                       1: cloud disabled
loe     - uint8_t   - Lastmanagement enabled
                      0: Lastmanagement deaktiviert          1: Lastmanagement über Cloud aktiviert
lot     - uint8_t   - Lastmanagement Gruppe Total Ampere
lom     - uint8_t   - Lastmanagement minimale Amperezahl
lop     - uint8_t   - Lastmanagement Priorität
log     - String    - Lastmanagement Gruppen ID
lon     - uint8_t   - Lastmanagement erwartete Anzahl von Ladestationen (derzeit nicht unterstützt)
lof     - uint8_t   - Lastmanagement Fallback Amperezahl
loa     - uint8_t   - Lastmanagement Ampere (derzeitiger erlaubter Ladestrom); wird vom Lastmanagement automatisch gesteuert
lch     - uint32_t  - Lastmanagement Sekunden seit letzten Stromfluss bei noch angestecktem Auto
mce     - uint8_t   - MQTT custom enabled; Verbindung mit eigenen MQTT Server herstellen
                      0: Funktion deaktiviert                1: Funktion aktiviert
mcs     - String(63) -MQTT custom Server; Hostname ohne Protokollangabe (z.B. test.mosquitto.org)
mcp     - uint16_t  - MQTT custom Port; z.B. 1883
mcu     - String(16) -MQTT custom Username
mck     - String(16) -MQTT custom key
mcc     - uint8_t   - MQTT custom connected
                      0: nicht verbunden                     1: verbunden


https://github.com/goecharger/go-eCharger-API-v2/blob/main/apikeys-de.md

Ab HW3 Phasenumschaltung - per API2
Auf 1. Phase schalten: http://192.168.xx.xx/api/set?psm=1
Auf 3. Phasen schalten: http://192.168.xx.xx/api/set?psm=2

# Get settings (all or some, see https://github.com/goecharger/go-eCharg ... keys-de.md ):
curl "http://1.2.3.4/api/status"
curl "http://1.2.3.4/api/status?filter=amp,psm"
*/
