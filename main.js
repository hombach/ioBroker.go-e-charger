﻿'use strict';

// The adapter-core module gives you access to the core ioBroker functions, you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
// const schedule = require('node-schedule');
const adapterIntervals = {};


// Adapter for EV-Charger go-E with firmware >V033

//Konstanten
    const readlink  = 'http://192.168.100.139/status';        // IP of charger
    const writelink = 'http://192.168.100.139/mqtt?payload='; // IP of charger

//Variablen
//    var request         = require('request');
var ZielAmpere      = 5;
var OptAmpere       = 6;
var MinHomeBatVal   = 87;
var OffVerzoegerung = 0;
var ChargeNOW = false;
var ChargeManager = false;
var ChargeCurrent = 0;
var SolarPower = 0;
var HouseConsumption = 0;
var BatSoC = 0;

/*
    "createState('EVCharger.Messwerte.Momentan.Ampere'","0);", // "amp" in A - Ampere Wert Vorgabe
    "createState('EVCharger.Messwerte.Momentan.Phasen'","0);", // "pha" binary flags - Phasen vor und nach dem Schütz
    "createState('EVCharger.Messwerte.Gesamt.Energy'","0);", // "eto" in 0.1kWh - Gesamt geladene Energiemenge 
    "createState('EVCharger.Messwerte.Momentan.Allow'","0);", // "alw" - allow charging
    "createState('EVCharger.Messwerte.Momentan.GesamtLeistung'","0);", // "nrg[11]" in 0.01kW - Gesamtleistung
*/

//schedule("*/10 * 0-23 * * *", Main);


var ChargerRequest = '';     // IP request-string for go-eCharger complete data

class go_e_charger extends utils.Adapter {

    /****************************************************************************************
    * @param {Partial<utils.AdapterOptions>} [options={}]
    */
    constructor(options) {
        super({
            ...options,
            name: 'go-e-charger'
        });
        this.on('ready', this.onReady.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }
    
    /****************************************************************************************
    * Is called when databases are connected and adapter received configuration.
    */
    async onReady() {
        if (!this.config.ipaddress) {
            this.log.warn('go-eCharger IP address not set');
        } else {
            this.log.info('IP address found in config: ' + this.config.ipaddress);
        }

        if (!this.config.polltimelive) {
            this.log.warn('Polltime not set or zero - will be set to 10 seconds');
            this.config.polltimelive = 10000;
        } 
        this.log.info('Polltime set to: ' + (this.config.polltimelive / 1000) + ' seconds');
 
        // this.subscribeStates('*'); // all states changes inside the adapters namespace are subscribed

        /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        try {
            await this.setStateAsync('state', { val: 10 })
            await this.setStateAsync('state', true); // the variable state is set to true as command (ack=false)
            await this.setStateAsync('state', { val: true, ack: true }); // ack should be always set to true if the value is received from or acknowledged from the target system
        } catch (e) {
            this.log.error("Unhandled exception processing setStateAsync: " + e);
        }
        */

        if (this.config.ipaddress) {

 /*           ChargerRequest = 'http://' + this.config.ipaddress + '/api/dxs.json' +
                '?dxsEntries=' + ID_Power_SolarDC + '&dxsEntries=' + ID_Power_GridAC +
                '&dxsEntries=' + ID_Power_SelfConsumption + '&dxsEntries=' + ID_StatDay_SelfConsumption +
                '&dxsEntries=' + ID_BatCurrentDir + '&dxsEntries=' + ID_GridLimitation;
                */
            this.log.debug("OnReady done");
            await this.Read_Charger();
            this.log.debug("Initial ReadCharger done, launching state machine");
            this.StateMachine();
        } else {
            this.stop;
        }
    }


    /****************************************************************************************
    * Is called if a subscribed state changes
    * @param { string } id
    * @param { ioBroker.State | null | undefined } state */
    onStateChange(id, state) {
        try {
            if (state) { // The state was changed
                this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            } else {     // The state was deleted
                this.log.warn(`state ${id} deleted`);
            }
        } catch (e) {
            this.log.error("Unhandled exception processing stateChange: " + e);
        }
    }

/*    if(adapter.config.publicHolidays === true) {
    if (id === adapter.config.publicHolInstance + '.heute.boolean') {
        publicHolidayStr = state.val;
        shutterDriveCalc();

adapter.getForeignState(result[i].name, (err, state) => {
                            adapter.log.debug('Shutter state changed: ' + result[i].shutterName + ' old value = ' + result[i].oldHeight + ' new value = ' + state.val);
                            //shutterState();

adapter.getState('shutters.autoUp.' + nameDevice, (err, state) => {
                    if (state && state === true || state && state.val === true) {
                        let currentValue = '';
                        /**
                         * @param {any} err
                         * @param {{ val: string; }} state


adapter.getState('myState', function (err, state) {
  adapter.log.info(
      'State ' + adapter.namespace + '.myState -' +
      '  Value: '    + state.val +
      ', ack: '      + state.ack +
      ', time stamp: '   + state.ts  +
      ', last changed: ' + state.lc
  );
});

        */

    /****************************************************************************************
    * Is called when adapter shuts down - callback has to be called under any circumstances!
    * @param {() => void} callback */
    onUnload(callback) {
        try {
            clearTimeout(adapterIntervals.stateMachine);
            clearTimeout(adapterIntervals.total);
            Object.keys(adapterIntervals).forEach(interval => clearInterval(adapterIntervals[interval]));
            this.log.info('Adaptor go-eCharger cleaned up everything...');
            callback();
        } catch (e) {
            callback();
        }
    }

    
    /****************************************************************************************
    */
    StateMachine() {
        this.getState('Settings.Setpoint_HomeBatSoC', (_err, state) => { MinHomeBatVal = state.val }); // Get Desired Battery SoC
        this.getState('Settings.ChargeNOW', (_err, state) => { ChargeNOW = state.val });
        this.getState('Settings.ChargeManager', (_err, state) => { ChargeManager = state.val });
        this.Read_Charger();
        this.getState('Power.ChargeCurrent', (_err, state) => { ChargeCurrent = state.val });

        if (ChargeNOW) { // Charge-NOW is enabled
            this.Charge_Config('1', ChargeCurrent, 'go-eCharger für Schnellladung aktivieren');  // keep active charging current!!
        }

        else if (ChargeManager) { // Charge-Manager is enabled
            this.getForeignState('kostal-piko-ba.0.Battery.SoC', (_err, BattSoC) => {
                if (BattSoC.val >= MinHomeBatVal) { // SoC of homebatterie sufficient?

                    this.Charge_Manager();

                }
                else { // FUTURE: time of day forces emptying of housebattery
                    ZielAmpere = 6;
                    this.Charge_Config('0', ZielAmpere, `Hausbatterie laden bis ${MinHomeBatVal} %`);
                }
            });
        }

        else { // OFF -> min. current  Power.ChargingAllowed
            this.getState('Power.ChargingAllowed', (_err, ChargingAllowed) => {
                if (ChargingAllowed.val == true) { // Set to false only if still true
                    ZielAmpere = 6;
                    this.Charge_Config('0', ZielAmpere, 'go-eCharger abschalten');
                }
            });
        }

        adapterIntervals.stateMachine = setTimeout(this.StateMachine.bind(this), this.config.polltimelive);
    }


    /****************************************************************************************
    */
    Read_Charger() {
        var got = require('got');
 //       (async () => {
            try {
                // @ts-ignore got is valid
                var response = await got(readlink);
                if (!response.error && response.statusCode == 200) {
 //                   var result = await JSON.parse(response.body);
                    var result = JSON.parse(response.body);
                    this.setStateAsync('Power.ChargeCurrent', result.amp, true);
                    this.setStateAsync('Power.ChargingAllowed', result.alw, true);
                    this.setStateAsync('Power.Charge', (result.nrg[11] * 10), true); // trim to Watt
                    this.log.debug('got go-eCharger data');
                }
                else {
                    this.log.error(`Error: ${response.error} by polling go-eCharger ${readlink}`);
                }
            } catch (e) {
                this.log.error(`Error in calling go-eCharger API: ${e}`);
                this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
            } // END catch
//        })();
    } // END Read_Charger

    /****************************************************************************************
    */
    Charge_Config(Allow, Ampere, LogMessage) {
        var got = require('got');
        this.log.debug(`${LogMessage}  -  ${Ampere} Ampere`);
//        (async () => {
            try {
                // @ts-ignore got is valid
                var response = await got(`${writelink}alw=${Allow}`); // activate charging
                if (!response.error && response.statusCode == 200) {
                    this.log.debug(response.body);
                }
                else if (response.error) {
                    this.log.warn(`Error: ${response.error} by writing ${writelink}alw=${Allow}`);
                }
            } catch (e) {
                this.log.error(`Error in calling go-eCharger API: ${e}`);
                this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
            } // END catch
//        })();

//        (async () => {
        try {
            // @ts-ignore got is valid
            var response = await got(`${writelink}amp=${Ampere}`); // set charging current
            if (!response.error && response.statusCode == 200) {
                this.log.debug(response.body);
                var result = JSON.parse(response.body);
                this.setStateAsync('Power.ChargeCurrent', result.amp, true); // in readcharger integriert
                this.setStateAsync('Power.GridPhases', result.pha, true);
                this.setStateAsync('Statistics_Total.Charged', (result.eto / 10), true);
                this.setStateAsync('Power.ChargingAllowed', result.alw, true); // in readcharger integriert
            }
            else if (response.error) {
                this.log.warn(`Error: ${response.error} by writing ${writelink}amp=${Allow}`);
            }
        } catch (e) {
            this.log.error(`Error in calling go-eCharger API: ${e}`);
            this.log.error(`Please verify IP address: ${this.config.ipaddress} !!!`);
        } // END catch
//        })();
    } // END Charge_Config

//ORIGINAL Charge_Config
/*
    Charge_Config(Allow, Ampere, LogMessage) {
        this.log.debug(`${LogMessage}  -  ${Ampere} Ampere`);
//        request(writelink + 'alw=' + Allow, // activate charging
//            function (error, response, body) {
//                if (!error) this.log.debug(body);
//                else if (error) this.log.error("ERROR: " + error + " bei Setzen von: " + writelink + "alw=" + Allow, "warn");
//            });
//        request(writelink + 'amp=' + Ampere, // set charging current
//            function (error, response, body) {
//                if (!error) {
//                    this.log.debug(body);
//                    var result = JSON.parse(body);
//                    this.setStateAsync('EVCharger.Messwerte.Momentan.Ampere', result.amp, true); // in readcharger integriert
//                    this.setStateAsync('EVCharger.Messwerte.Momentan.Phasen', result.pha, true);
//                    this.setStateAsync('EVCharger.Messwerte.Gesamt.Energy', (result.eto / 10), true);
//                    this.setStateAsync('EVCharger.Messwerte.Momentan.Allow', result.alw, true); // in readcharger integriert
//                }
//                else this.log.error("ERROR: " + error + " bei Setzen von: " + writelink + "amp=" + Ampere, "warn");
//            });
    } // END Charge_Config

*/

    /****************************************************************************************
    */
    Charge_Manager() {
        this.Read_Charger_Power();

        this.getForeignState('kostal-piko-ba.0.Power.SolarDC', (_err, state) => { SolarPower = state.val });
        this.getForeignState('kostal-piko-ba.0.Power.HouseConsumption', (_err, state) => { HouseConsumption = state.val });
        this.getForeignState('kostal-piko-ba.0.Battery.SoC', (_err, state) => { BatSoC = state.val });

        OptAmpere = (Math.floor(
            (SolarPower - HouseConsumption + ChargeCurrent - 100
                + ((2000 / (100 - MinHomeBatVal)) * (BatSoC - MinHomeBatVal))) / 230)); // -100 W Reserve + max. 2000 fÜr Batterieleerung

        this.log.debug(`OptAmpere: ${OptAmpere} Ampere`);
        if (OptAmpere > 16) OptAmpere = 16;

        if (ZielAmpere < OptAmpere) {
            ZielAmpere++;
        } else if (ZielAmpere > OptAmpere) ZielAmpere--;

        this.log.debug(`ZielAmpere: ${ZielAmpere} Ampere; Leistung DC: ${SolarPower} W; `
                     + `Hausverbrauch: ${HouseConsumption} W; Gesamtleistung Charger: ${ChargeCurrent} W`);
        
        if (ZielAmpere > (5 + 4)) {
            this.Charge_Config('1', ZielAmpere, `Ladestrom: ${ZielAmpere} Ampere`); // An und Zielstrom da größer 5 + Hysterese
        } else if (ZielAmpere < 6) {
            OffVerzoegerung++;
            if (OffVerzoegerung > 12) {
                this.Charge_Config('0', ZielAmpere, 'zu wenig Überschuss'); // Aus und Zielstrom
                OffVerzoegerung = 0;
            }
        }
    } // END Charge_Manager
       
} // END Class


/****************************************************************************************
*/
// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
    * @param {Partial<utils.AdapterOptions>} [options={}]
    */
    module.exports = (options) => new go_e_charger(options);
} else { // otherwise start the instance directly
    new go_e_charger();
}


/*
Erklärung Format​: alle Parameter werden im JSON Objekt als String gesendet (in Anführungszeichen). Die meisten dieser
Parameter können in ein integer Format konvertiert werden. Der bei Format angegebene Datentyp zeigt die zu erwartende
Größe. Sollte der String nicht in den angegebenen Datentyp konvertiert werden, soll ein Kommunikationsfehler angezeigt
werden.

Parameter  -  Format  -  Erklärung
version -  String(1)  -  JSON Format; "B": Normalfall; "C": Wenn Ende-zu-Ende Verschlüsselung aktiviert
rbc     -  uint32_t  -  reboot_counter​; Zählt die Anzahl der Bootvorgänge.
rbt     -  uint32_t  -  reboot_timer​; Zählt die Millisekunden seit dem letzten Bootvorgang.
car     -  uint8_t   -  Status PWM Signalisierung
            1: Ladestation bereit, kein Fahrzeug        2: Fahrzeug lädt
            3: Warte auf Fahrzeug                       4: Ladung beendet, Fahrzeug noch verbunden
amp     -  uint8_t   -  Ampere Wert für die PWM Signalisierung in ganzen Ampere von 6-32A
err     -  uint8_t   -  error
            1: RCCB (Fehlerstromschutzschalter)         3: PHASE (Phasenstörung)
            8: NO_GROUND (Erdungserkennung)             10, default: INTERNAL (sonstiges)
ast     -  uint8_t   -  access_state​: Zugangskontrolle
            0: Offen                                    1: RFID / App benötigt
            2: Strompreis / automatisch
alw     -  uint8_t   -  allow_charging: ​PWM Signal darf anliegen; 0: nein; 1: ja
stp     -  uint8_t   -  stop_state: ​Automatische Abschaltung; 0: deaktiviert; 2: nach kWh abschalten
cbl     -  uint8_t   -  Typ2 ​Kabel Ampere codierung; 13-32: Ampere Codierung; 0: kein Kabel
pha     -  uint8_t   -  Phasen ​vor und nach dem Schütz; binary flags: ​0b00ABCDEF
            A... phase 3, vor dem Schütz                B... phase 2 vor dem Schütz
            C... phase 1 vor dem Schütz                 D... phase 3 nach dem Schütz
            E... phase 2 nach dem Schütz                F... phase 1 nach dem Schütz
tmp     -  uint8_t   -  Temperatur​ des Controllers in °C
dws     -  uint32_t  -  Geladene Energiemenge​ in Deka-Watt-Sekunden
dwo     -  uint16_t  -  Abschaltwert ​in 0.1kWh wenn ​stp==2​, für dws Parameter
adi     -  uint8_t   -  adapter_in​: Ladebox ist mit Adapter angesteckt; 0: NO_ADAPTER; 1: 16A_ADAPTER
uby     -  uint8_t   -  unlocked_by​: Nummer der RFID Karte, die den jetzigen Ladevorgang freigeschalten hat
eto     -  uint32_t  -  energy_total​: Gesamt geladene Energiemenge in 0.1kWh
wst     -  uint8_t   -  wifi_state​: WLAN Verbindungsstatus; 3: verbunden; default: nicht verbunden
nrg     -  array[15] -  Array mit Werten des Strom- und Spannungssensors
            nrg[0]​: Spannung auf L1 in Volt            nrg[1]​: Spannung auf L2 in Volt
            nrg[2]​: Spannung auf L3 in Volt            nrg[3]​: Spannung auf N in Volt
            nrg[4]​: Ampere auf L1 in 0.1A              nrg[5]​: Ampere auf L2 in 0.1A
            nrg[6]​: Ampere auf L3 in 0.1A              nrg[7]​: Leistung auf L1 in 0.1kW
            nrg[8]​: Leistung auf L2 in 0.1kW           nrg[9]​: Leistung auf L3 in 0.1kW
            nrg[10]​: Leistung auf N in 0.1kW           nrg[11]​: Leistung gesamt in 0.01kW
            nrg[12]​: Leistungsfaktor auf L1 in %       nrg[13]​: Leistungsfaktor auf L2 in %
            nrg[14]​: Leistungsfaktor auf L3 in %       nrg[15]​: Leistungsfaktor auf N in %
fwv     -  String   -  Firmware Version
sse     -  String   -  Seriennummer ​als %06d formatierte Zahl
wss     -  String   -  WLAN ​SSID
wke     -  String   -  WLAN ​Key
wen     -  uint8_t  -  wifi_enabled​: WLAN aktiviert; 0: deaktiviert; 1: aktiviert
tof     -  uint8_t  -  time_offset​: Zeitzone in Stunden für interne batteriegestützte Uhr +100; Beispiel: 101 entspricht GMT+1
tds     -  uint8_t  -  Daylight saving time offset​ (Sommerzeit) in Stunden
lbr     -  uint8_t  -  LED Helligkeit​ von 0-255; 0: LED aus; 255: LED Helligkeit maximal
aho     -  uint8_t  -  Minimale ​Anzahl ​von Stunden in der mit "Strompreis-automatisch" geladen werden muss
afi     -  uint8_t  -  Stunde (​Uhrzeit​) in der mit "Strompreis - automatisch" die Ladung mindestens ​aho ​Stunden gedauert haben muss.
azo     -  uint8_t  -  Awattar Preiszone; 0: Österreich; 1: Deutschland
ama     -  uint8_t  -  Absolute max. Ampere: Maximalwert für Ampere Einstellung
al1     -  uint8_t  -  Ampere Level 1 für Druckknopf am Gerät.
            6-32: Ampere Stufe aktiviert                0: Stufe deaktivert (wird übersprungen)
al2     -  uint8_t  -  Ampere Level 2 für Druckknopf am Gerät; muss entweder 0 oder ​> al1​ sein
al3     -  uint8_t  -  Ampere Level 3 für Druckknopf am Gerät; muss entweder 0 oder ​> al2​ sein
al4     -  uint8_t  -  Ampere Level 4 für Druckknopf am Gerät; muss entweder 0 oder ​> al3​ sein
al5     -  uint8_t  -  Ampere Level 5 für Druckknopf am Gerät; muss entweder 0 oder ​> al4​ sein
cid     -  uint24_t -  Color idle:​ Farbwert für Standby​ (kein Auto angesteckt) als Zahl
cch     -  uint24_t -  Color charging:​ Farbwert für Ladevorgang aktiv​, als Zahl
cfi     -  uint24_t -  Color idle:​ Farbwert für Ladevorgang abgeschlossen​, als Zahl
lse     -  uint8_t  -  led_save_energy​: LED automatisch nach 10 Sekunden abschalten
            0: Energiesparfunktion deaktiviert          1: Energiesparfunktion aktiviert
ust     -  uint8_t  -  unlock_state​: Kabelverriegelung Einstellung
            0: Verriegeln solange Auto angesteckt       1: Nach Ladevorgang automatisch entriegeln
            2: Kabel immer verriegelt lassen
wak     -  String   -  WLAN ​Hotspot Password; Beispiel: "abdef0123456"
r1x     -  uint8_t  -  Flags
            0b1: HTTP Api im WLAN Netzwerk aktiviert (0: nein, 1:ja)
            0b10: Ende-zu-Ende Verschlüsselung aktiviert (0: nein, 1:ja)
dto     -  uint8_t  -  Restzeit​ in Millisekunden verbleibend auf Aktivierung durch Strompreise
nmo     -  uint8_t  -  Norwegen-Modus​ aktiviert
            0: deaktiviert (Erdungserkennung aktiviert); 1: aktiviert (keine Erdungserkennung, nur für IT-Netze gedacht)
eca; ecr; ecd; ec4; ec5; ec6; ec7; ec8; ec9; ec1
        -  uint32_t -  Geladene ​Energiemenge pro RFID Karte​ von 1-10
rca; rcr; rcd; rc4; rc5; rc6; rc7; rc8; rc9; rc1
        -  String   -  RFID Karte ID​ von 1-10 als String Format und Länge: variabel, je nach Version
rna; rnm; rne; rn4; rn5; rn6; rn7; rn8; rn9; rn1
        -  String   -  RFID Karte Name​ von 1-10; Maximallänge: 10 Zeichen
tme     -  String   -  Aktuelle Uhrzeit​, formatiert als ddmmyyhhmm
sch     -  String   -  Scheduler einstellungen ​(base64 encodiert)
sdp     -  uint8_t  -  Scheduler double press: ​Aktiviert Ladung nach doppeltem Drücken des Button, wenn die Ladung gerade durch den Scheduler unterbrochen wurde
            0: Funktion deaktiviert                     1: Ladung sofort erlauben
upd     -  uint8_t  -  Update available​ (nur verfügbar bei Verbindung über go-e Server)
            0: kein Update verfügbar                    1: Update verfügbar
cdi     -  uint8_t  -  Cloud disabled; 0: cloud enabled; 1: cloud disabled
loe     -  uint8_t  -  Lastmanagement enabled; 0: Lastmanagement deaktiviert; 1: Lastmanagement über Cloud aktiviert
lot     -  uint8_t  -  Lastmanagement Gruppe Total Ampere
lom     -  uint8_t  -  Lastmanagement minimale Amperezahl
lop     -  uint8_t  -  Lastmanagement Priorität
log     -  String   -  Lastmanagement Gruppen ID
lon     -  uint8_t  -  Lastmanagement erwartete Anzahl von Ladestationen ​(derzeit nicht unterstützt)
lof     -  uint8_t  -  Lastmanagement Fallback Amperezahl
loa     -  uint8_t  -  Lastmanagement Ampere​ (derzeitiger erlaubter Ladestrom); wird vom Lastmanagement automatisch gesteuert
lch     -  uint32_t -  Lastmanagement Sekunden seit letzten Stromfluss bei noch angestecktem Auto
mce     -  uint8_t  -  MQTT custom enabled; Verbindung mit eigenen MQTT Server herstellen
            0: Funktion deaktiviert                     1: Funktion aktiviert
mcs     -  String(63) -MQTT custom Server; Hostname ohne Protokollangabe (z.B. test.mosquitto.org)
mcp     -  uint16_t -  MQTT custom Port; z.B. 1883
mcu     -  String(16) -MQTT custom Username
mck     -  String(16) -MQTT custom key
mcc     -  uint8_t  -  MQTT custom connected; 0: nicht verbunden; 1: verbunden
*/